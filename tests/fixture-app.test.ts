import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startApp } from '../fixtures/app/server.js';

let base = '';
let server: Server;

/** One cookie jar per client, because every injector is session scoped. */
function client() {
  const jar = new Map<string, string>();
  return async function req(
    path: string,
    init?: { method?: string; form?: Record<string, string> },
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (jar.size > 0) headers['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body: string | undefined;
    if (init?.form !== undefined) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const res = await fetch(`${base}${path}`, {
      method: init?.method ?? 'GET',
      redirect: 'manual',
      headers,
      ...(body === undefined ? {} : { body }),
    });
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(';')[0] ?? '';
      const i = pair.indexOf('=');
      if (i < 1) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value === '') jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  };
}

async function signedIn() {
  const req = client();
  const res = await req('/', { method: 'POST', form: { user: 'teller', password: 'demo' } });
  expect(res.status).toBe(303);
  return req;
}

beforeAll(async () => {
  const started = await startApp(0);
  base = started.url;
  server = started.server;
});

afterAll(() => {
  server.close();
});

describe('the fixture back office', () => {
  it('rejects a wrong password and admits the demo one', async () => {
    const req = client();
    const bad = await req('/', { method: 'POST', form: { user: 'teller', password: 'nope' } });
    expect(await bad.text()).toContain('Sign in failed');
    await signedIn();
  });

  it('sends every screen to the sign-in page without a session', async () => {
    const req = client();
    const res = await req('/member/100001');
    expect(await res.text()).toContain('Your session has expired');
  });

  it('serves the frameset and finds a member', async () => {
    const req = await signedIn();
    expect(await (await req('/search')).text()).toContain('<frameset');
    const found = await req('/frame/search', { method: 'POST', form: { q: '100001' } });
    expect(found.status).toBe(303);
    expect(found.headers.get('location')).toBe('/member/100001');
    const detail = await req('/member/100001');
    expect(await detail.text()).toContain('$4,182.55');
  });

  it('hashes class names differently from the literal logical name', async () => {
    const req = await signedIn();
    const html = await (await req('/frame/search')).text();
    expect(html).not.toContain('data-testid');
    expect(html).toMatch(/class="c-[0-9a-f]{1,4}"/);
  });

  it('fault notFound returns the business banner', async () => {
    const req = await signedIn();
    await req('/frame/search?fault=notFound');
    const res = await req('/frame/search', { method: 'POST', form: { q: '100001' } });
    expect(await res.text()).toContain('No member matches that number.');
  });

  it('fault interstitial fires once and then clears itself', async () => {
    const req = await signedIn();
    await req('/frame/search?fault=interstitial');
    const first = await req('/member/100001');
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toContain('/confirm');
    expect(await (await req('/confirm?next=%2Fmember%2F100001')).text()).toContain('Continue');
    expect(await (await req('/member/100001')).text()).toContain('$4,182.55');
  });

  it('fault slow delays the detail page', async () => {
    const req = await signedIn();
    await req('/frame/search?fault=slow');
    const started = Date.now();
    const res = await req('/member/100001');
    expect(Date.now() - started).toBeGreaterThan(3_500);
    expect(await res.text()).toContain('$4,182.55');
  });

  it('fault sessionExpired ends the session on the next request', async () => {
    const req = await signedIn();
    await req('/frame/search?fault=sessionExpired');
    expect(await (await req('/member/100001')).text()).toContain('Your session has expired');
  });

  it('fault serverError returns a 500 with no stack trace', async () => {
    const req = await signedIn();
    await req('/frame/search?fault=serverError');
    const res = await req('/member/100001');
    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).toContain('An unexpected error occurred.');
    expect(html).not.toContain('at ');
  });

  it('fault validation returns an inline field error on the hold form', async () => {
    const req = await signedIn();
    await req('/frame/search?fault=validation');
    const res = await req('/member/100001/account/S-01/hold', {
      method: 'POST',
      form: { reason: 'fraud review' },
    });
    expect(await res.text()).toContain('Hold Reason is required');
  });

  it('member 100002 forces the same validation error with no fault armed', async () => {
    const req = await signedIn();
    const res = await req('/member/100002/account/S-01/hold', {
      method: 'POST',
      form: { reason: 'fraud review' },
    });
    expect(await res.text()).toContain('Hold Reason is required');
  });

  it('member 100003 always shows the interstitial', async () => {
    const req = await signedIn();
    const res = await req('/member/100003');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/confirm');
  });

  it('member 999999 is a business outcome, not an error', async () => {
    const req = await signedIn();
    const res = await req('/frame/search', { method: 'POST', form: { q: '999999' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('No member matches that number.');
  });

  it('a good hold succeeds and shows the confirmation', async () => {
    const req = await signedIn();
    const res = await req('/member/100001/account/S-01/hold', {
      method: 'POST',
      form: { reason: 'fraud review' },
    });
    expect(await res.text()).toContain('Hold placed on this account.');
  });

  it('POST /_reset clears an armed fault', async () => {
    const req = await signedIn();
    await req('/frame/search?fault=notFound');
    await req('/_reset', { method: 'POST' });
    const res = await req('/frame/search', { method: 'POST', form: { q: '100001' } });
    expect(res.status).toBe(303);
  });
});
