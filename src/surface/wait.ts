/**
 * The wait model. Three primitives, every one bounded by a deadline.
 *
 * There is no bare sleep in the execution path. A fixed sleep either wastes
 * time or fails under the `slow` injector, and it hides the reason a step
 * waited. `settle` absorbs a slow page by watching the page stop changing.
 */
import type { Page } from 'playwright';
import { observeElements, type SurfaceElement } from './observe.js';

const POLL_MS = 100;
const QUIET_MS = 150;

/** Used only between polls, never as a substitute for a condition. */
function tick(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Polls until the predicate holds or the deadline passes. */
export async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await tick(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  }
}

/** A snapshot signature that changes whenever a control appears, moves, or renames. */
function signature(elements: SurfaceElement[]): string {
  return elements
    .map((e) => `${e.framePath.join('/')}|${e.role}|${e.name}|${e.value ?? ''}|${Math.round(e.box?.y ?? -1)}`)
    .join('\n');
}

/**
 * After any action that can navigate: wait for the document to load, then wait
 * until two observations taken 150 ms apart are equal.
 */
export async function settle(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  try {
    await page.waitForLoadState('load', { timeout: Math.max(0, deadline - Date.now()) });
  } catch {
    // A load that never completes is still judged by the quiet check below,
    // and by the step's own postcondition. It is not a failure on its own.
  }
  let previous = signature(await observeElements(page));
  while (Date.now() < deadline) {
    await tick(QUIET_MS);
    const current = signature(await observeElements(page));
    if (current === previous) return;
    previous = current;
  }
}

/** Used by the `navigate` action only. */
export async function waitForNavigation(page: Page, url: string, timeoutMs: number): Promise<void> {
  await page.goto(url, { timeout: timeoutMs, waitUntil: 'load' });
}
