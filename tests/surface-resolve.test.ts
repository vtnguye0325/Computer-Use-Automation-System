import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startApp } from '../fixtures/app/server.js';
import { createPlaywrightSurface, type PlaywrightSurface } from '../src/surface/playwright.js';
import type { TargetDescriptor } from '../src/surface/types.js';

let base = '';
let server: Server;
let surface: PlaywrightSurface;

/** Ladders are written the way an artifact writes them: most robust first. */
const button = (name: string): TargetDescriptor => ({
  description: `${name} button`,
  strategies: [
    { kind: 'roleName', role: 'button', name, exact: true },
    { kind: 'text', text: name, exact: true },
  ],
});

const fieldRightOf = (label: string): TargetDescriptor => ({
  description: `${label} field`,
  strategies: [
    { kind: 'roleName', role: 'textbox', name: label, exact: true },
    { kind: 'labelAnchor', anchorText: label, direction: 'right', role: 'textbox' },
  ],
});

/** A value cell has no accessible name of its own, so only the anchor finds it. */
const cellRightOf = (label: string): TargetDescriptor => ({
  description: `${label} value`,
  strategies: [{ kind: 'labelAnchor', anchorText: label, direction: 'right', role: 'cell' }],
});

async function expectResolved(target: TargetDescriptor): Promise<number> {
  const result = await surface.resolve(target);
  expect(result.status, `${target.description} did not resolve`).toBe('resolved');
  if (result.status !== 'resolved') throw new Error('unreachable');
  return result.handle.strategyIndex;
}

async function signIn(): Promise<void> {
  await surface.act({ type: 'navigate', url: `${base}/` });
  await surface.act({ type: 'type', target: fieldRightOf('User Name'), text: 'teller' });
  await surface.act({ type: 'type', target: fieldRightOf('Password'), text: 'demo' });
  await surface.act({ type: 'click', target: button('Sign In') });
}

async function searchFor(memberId: string): Promise<void> {
  await surface.act({ type: 'type', target: fieldRightOf('Member Number'), text: memberId });
  await surface.act({ type: 'click', target: button('Search') });
}

beforeAll(async () => {
  const started = await startApp(0);
  base = started.url;
  server = started.server;
  surface = await createPlaywrightSurface({ headed: false });
});

afterAll(async () => {
  await surface.close();
  server.close();
});

describe('the strategy ladder against the hostile app', () => {
  it('resolves every control on every screen through strategy 1 or strategy 2', async () => {
    await surface.act({ type: 'navigate', url: `${base}/` });
    for (const target of [fieldRightOf('User Name'), fieldRightOf('Password'), button('Sign In')]) {
      expect(await expectResolved(target)).toBeLessThanOrEqual(1);
    }

    await signIn();
    for (const target of [fieldRightOf('Member Number'), button('Search')]) {
      expect(await expectResolved(target)).toBeLessThanOrEqual(1);
    }

    await searchFor('100001');
    // The savings row's own View link, found from the account number beside it.
    const savingsView: TargetDescriptor = {
      description: 'View link on the savings row',
      strategies: [{ kind: 'labelAnchor', anchorText: 'S-01', direction: 'right', role: 'link' }],
    };
    expect(await expectResolved(savingsView)).toBe(0);

    await surface.act({ type: 'click', target: savingsView });
    for (const target of [
      cellRightOf('Current Balance'),
      fieldRightOf('Hold Reason'),
      button('Place Hold'),
      button('Transfer Funds'),
    ]) {
      expect(await expectResolved(target)).toBeLessThanOrEqual(1);
    }

    const balance = await surface.act({ type: 'extract', target: cellRightOf('Current Balance'), as: 'savingsBalance' });
    expect(balance).toEqual({ status: 'ok', extracted: { savingsBalance: '$4,182.55' } });
  });

  it('reports ambiguity and does not fall through to the next strategy', async () => {
    await signIn();
    await searchFor('100001');
    const result = await surface.resolve({
      description: 'a View link, described imprecisely',
      strategies: [
        { kind: 'text', text: 'View', exact: true },
        // If the ladder fell through, this rung would resolve and hide the defect.
        { kind: 'roleName', role: 'button', name: 'Place Hold', exact: true },
      ],
    });
    expect(result).toEqual({ status: 'ambiguous', strategyIndex: 0, candidateCount: 2 });
  });

  it('reports notFound with the number of strategies tried', async () => {
    await signIn();
    const result = await surface.resolve({
      description: 'a control that does not exist',
      strategies: [
        { kind: 'roleName', role: 'button', name: 'Approve Loan', exact: true },
        { kind: 'text', text: 'Approve Loan', exact: true },
      ],
    });
    expect(result).toEqual({ status: 'notFound', triedStrategies: 2 });
  });

  it('still resolves after a restart rehashes every class name', async () => {
    const serverPath = fileURLToPath(new URL('../fixtures/app/server.ts', import.meta.url));
    const child = spawn('npx', ['tsx', serverPath], {
      env: { ...process.env, CUAS_APP_PORT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const childUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the second app never started')), 20_000);
      child.stdout.on('data', (chunk: Buffer) => {
        const match = /fixture app on (\S+)/.exec(chunk.toString());
        if (match?.[1] !== undefined) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });

    try {
      const classesOf = async (url: string): Promise<Set<string>> =>
        new Set((await (await fetch(url)).text()).match(/c-[0-9a-f]{4}/g) ?? []);
      const first = await classesOf(`${base}/`);
      const second = await classesOf(`${childUrl}/`);
      // The premise of the test: a selector-based recorder would break here.
      expect([...second].some((c) => !first.has(c))).toBe(true);

      base = childUrl;
      await signIn();
      expect(await expectResolved(fieldRightOf('Member Number'))).toBeLessThanOrEqual(1);
      await searchFor('100001');
      expect(
        await expectResolved({
          description: 'View link on the savings row',
          strategies: [{ kind: 'labelAnchor', anchorText: 'S-01', direction: 'right', role: 'link' }],
        }),
      ).toBe(0);
    } finally {
      child.kill();
    }
  });
});
