/**
 * The hostile target application: a legacy-style credit union back office.
 *
 * It is local on purpose. A public demo site gives no control over the fault
 * injectors the brief asks the replay engine to survive, and it carries
 * terms-of-service and rate-limit risk that adds nothing to the design.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { findAccount, findMember } from './data.js';
import { loginPage } from './pages/login.js';
import { navFrame, searchFrame, searchFrameset } from './pages/search.js';
import { memberPage } from './pages/member.js';
import { accountPage, holdConfirmedPage } from './pages/account.js';
import { confirmPage, errorPage } from './pages/confirm.js';

export const FAULTS = [
  'notFound',
  'validation',
  'interstitial',
  'slow',
  'sessionExpired',
  'serverError',
] as const;
export type Fault = (typeof FAULTS)[number];

const SESSION_COOKIE = 'cuas_sid';
const FAULT_COOKIE = 'cuas_fault';
const SLOW_MS = 4_000;
/** Members that force a behaviour with no fault flag, so a demo can show it. */
const QUIRK_FAULT: Record<string, Fault> = { '100002': 'validation', '100003': 'interstitial' };

/** Live sessions. In memory, because the brief rewards no infrastructure. */
const sessions = new Map<string, { valid: boolean }>();

function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Express 5 types a route parameter loosely; the routes below need a string. */
function param(req: Request, name: string): string {
  const v = (req.params as Record<string, string | string[] | undefined>)[name];
  return typeof v === 'string' ? v : '';
}

function isFault(v: unknown): v is Fault {
  return typeof v === 'string' && (FAULTS as readonly string[]).includes(v);
}

function currentFault(req: Request): Fault | undefined {
  const v = cookies(req)[FAULT_COOKIE];
  return isFault(v) ? v : undefined;
}

/** A fault survives the next navigation, so it must live in a cookie. A query
 * parameter alone dies on the first redirect and the injector proves nothing. */
function setFault(res: Response, fault: Fault | undefined): void {
  if (fault === undefined) res.cookie(FAULT_COOKIE, '', { maxAge: 0, path: '/' });
  else res.cookie(FAULT_COOKIE, fault, { path: '/' });
}

function loggedIn(req: Request): boolean {
  const sid = cookies(req)[SESSION_COOKIE];
  return sid !== undefined && sessions.get(sid)?.valid === true;
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false }));

  // Any request may arm an injector. The value then persists until POST /_reset.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const q = req.query['fault'];
    if (isFault(q)) setFault(res, q);
    next();
  });

  app.post('/_reset', (req: Request, res: Response) => {
    setFault(res, undefined);
    const sid = cookies(req)[SESSION_COOKIE];
    if (sid !== undefined) sessions.set(sid, { valid: true });
    res.type('text/plain').send('reset');
  });

  // Guard every screen behind the session, and let the sessionExpired injector
  // fire here. It is consumed on the first hit, so a human who signs back in
  // during a handoff can finish the run.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/' || req.path === '/_reset') return next();
    const fault = currentFault(req);
    if (fault === 'sessionExpired') {
      const sid = cookies(req)[SESSION_COOKIE];
      if (sid !== undefined) sessions.set(sid, { valid: false });
      setFault(res, undefined);
      return res.status(200).send(loginPage('Your session has expired. Please sign in again.'));
    }
    if (!loggedIn(req)) {
      return res.status(200).send(loginPage('Your session has expired. Please sign in again.'));
    }
    return next();
  });

  app.get('/', (_req: Request, res: Response) => {
    res.send(loginPage());
  });

  app.post('/', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    if (body['password'] !== 'demo') {
      return res.send(loginPage('Sign in failed. Check the user name and password.'));
    }
    const sid = randomBytes(8).toString('hex');
    sessions.set(sid, { valid: true });
    res.cookie(SESSION_COOKIE, sid, { path: '/' });
    return res.redirect(303, '/search');
  });

  app.get('/search', (_req: Request, res: Response) => {
    res.send(searchFrameset());
  });

  app.get('/frame/nav', (_req: Request, res: Response) => {
    res.send(navFrame());
  });

  app.get('/frame/search', (_req: Request, res: Response) => {
    res.send(searchFrame());
  });

  app.post('/frame/search', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const q = typeof body['q'] === 'string' ? body['q'].trim() : '';
    const member = findMember(q);
    if (currentFault(req) === 'notFound' || member === undefined) {
      return res.send(searchFrame('No member matches that number.'));
    }
    return res.redirect(303, `/member/${member.id}`);
  });

  app.get('/member/:id', async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const fault = currentFault(req);
    if (fault === 'serverError') return res.status(500).send(errorPage());

    const quirk = QUIRK_FAULT[id];
    if (fault === 'interstitial' || quirk === 'interstitial') {
      // The interstitial is noise between the action and the postcondition, so
      // it must appear once and then stay gone.
      if (fault === 'interstitial') setFault(res, undefined);
      return res.redirect(303, `/confirm?next=${encodeURIComponent(`/member/${id}`)}`);
    }
    if (fault === 'slow') await new Promise((r) => setTimeout(r, SLOW_MS));

    const member = findMember(id);
    if (member === undefined) return res.send(searchFrame('No member matches that number.'));
    return res.send(memberPage(member));
  });

  app.get('/member/:id/account/:acct', (req: Request, res: Response) => {
    if (currentFault(req) === 'serverError') return res.status(500).send(errorPage());
    const member = findMember(param(req, 'id'));
    const account = member === undefined ? undefined : findAccount(member, param(req, 'acct'));
    if (member === undefined || account === undefined) {
      return res.status(404).send(errorPage());
    }
    return res.send(accountPage(member, account));
  });

  app.post('/member/:id/account/:acct/hold', (req: Request, res: Response) => {
    const member = findMember(param(req, 'id'));
    const account = member === undefined ? undefined : findAccount(member, param(req, 'acct'));
    if (member === undefined || account === undefined) return res.status(404).send(errorPage());

    const body = req.body as Record<string, unknown>;
    const reason = typeof body['reason'] === 'string' ? body['reason'].trim() : '';
    const forced = currentFault(req) === 'validation' || QUIRK_FAULT[member.id] === 'validation';
    if (forced || reason === '') {
      return res.send(accountPage(member, account, 'Hold Reason is required for this member.'));
    }
    return res.send(holdConfirmedPage(member, account));
  });

  app.post('/member/:id/account/:acct/transfer', (req: Request, res: Response) => {
    // Reachable by hand, so the demo is honest. The policy engine, not this app,
    // is what must stop an automation from ever arriving here.
    const member = findMember(param(req, 'id'));
    const account = member === undefined ? undefined : findAccount(member, param(req, 'acct'));
    if (member === undefined || account === undefined) return res.status(404).send(errorPage());
    return res.send(holdConfirmedPage(member, account));
  });

  app.get('/confirm', (req: Request, res: Response) => {
    const next = typeof req.query['next'] === 'string' ? req.query['next'] : '/search';
    res.send(confirmPage(next));
  });

  return app;
}

/** Started by tests on an ephemeral port, and by `npm run app` on the configured one. */
export function startApp(port: number): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createApp().listen(port, () => {
      const address = server.address();
      const bound = typeof address === 'object' && address !== null ? address.port : port;
      resolve({ url: `http://localhost:${bound}`, server });
    });
  });
}

const isEntry = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  const { config } = await import('../../src/config.js');
  const { url } = await startApp(config.appPort);
  console.log(`fixture app on ${url}`);
}
