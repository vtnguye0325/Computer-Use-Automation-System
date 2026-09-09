/**
 * `Surface` over a real browser.
 *
 * Nothing above this file may mention Playwright, so every browser type stops
 * here. The browser is launched with a remote debugging port when one is
 * given, because the human handoff attaches to this same page target.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type {
  Action,
  ActResult,
  Condition,
  Observation,
  ResolveResult,
  Surface,
  TargetDescriptor,
} from './types.js';
import {
  REF_ATTRIBUTE,
  frameOfRef,
  installEvalShim,
  observeElements,
  type SurfaceElement,
} from './observe.js';
import { resolveAgainst } from './resolve.js';
import { settle, waitForCondition, waitForNavigation } from './wait.js';
import { omitUndefined } from '../util/object.js';

const ACTION_TIMEOUT_MS = 10_000;
const SETTLE_TIMEOUT_MS = 15_000;
const CHECK_TIMEOUT_MS = 5_000;

/** Named so evidence can log a degrading artifact before it breaks. */
export type SurfaceEvent =
  | { event: 'target.resolved'; description: string; strategyIndex: number }
  | { event: 'target.degraded'; description: string; strategyIndex: number }
  | { event: 'target.fragile'; description: string; strategyIndex: number }
  | { event: 'target.ambiguous'; description: string; strategyIndex: number; candidateCount: number }
  | { event: 'target.notFound'; description: string; triedStrategies: number };

export interface PlaywrightSurfaceOptions {
  headed: boolean;
  /** Set for the handoff; omitted for tests. */
  cdpPort?: number;
  viewport?: { width: number; height: number };
  onEvent?: (event: SurfaceEvent) => void;
}

export class PlaywrightSurface implements Surface {
  readonly kind = 'playwright';

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    readonly page: Page,
    private readonly onEvent: (event: SurfaceEvent) => void,
  ) {}

  async observe(): Promise<Observation> {
    const elements = await this.elements();
    const title = await this.page.title().catch(() => undefined);
    return omitUndefined({
      url: this.page.url(),
      title,
      elements,
      capturedAt: new Date().toISOString(),
    } as Observation);
  }

  /** The internal shape, with the path and text that resolution needs. */
  private elements(): Promise<SurfaceElement[]> {
    return observeElements(this.page);
  }

  async resolve(target: TargetDescriptor): Promise<ResolveResult> {
    const result = resolveAgainst(target, await this.elements());
    const description = target.description;
    if (result.status === 'resolved') {
      const index = result.handle.strategyIndex;
      const strategy = target.strategies[index];
      if (strategy?.kind === 'coordinates') {
        this.onEvent({ event: 'target.fragile', description, strategyIndex: index });
      } else if (index > 1) {
        this.onEvent({ event: 'target.degraded', description, strategyIndex: index });
      } else {
        this.onEvent({ event: 'target.resolved', description, strategyIndex: index });
      }
      return { status: 'resolved', handle: result.handle };
    }
    if (result.status === 'ambiguous') {
      this.onEvent({
        event: 'target.ambiguous',
        description,
        strategyIndex: result.strategyIndex,
        candidateCount: result.candidateCount,
      });
      return result;
    }
    this.onEvent({ event: 'target.notFound', description, triedStrategies: result.triedStrategies });
    return result;
  }

  /** A `ref` becomes an actionable locator through the attribute observe stamped. */
  private async locate(target: TargetDescriptor): Promise<
    { ok: true; ref: string; element: SurfaceElement } | { ok: false; reason: string }
  > {
    const elements = await this.elements();
    const result = resolveAgainst(target, elements);
    if (result.status === 'ambiguous') {
      return {
        ok: false,
        reason: `targetAmbiguous: "${target.description}" matched ${result.candidateCount} candidates at strategy ${result.strategyIndex}`,
      };
    }
    if (result.status === 'notFound' || result.element === undefined) {
      return {
        ok: false,
        reason: `targetNotFound: "${target.description}" matched nothing after ${target.strategies.length} strategies`,
      };
    }
    await this.resolve(target);
    return { ok: true, ref: result.handle.ref, element: result.element };
  }

  async act(action: Action): Promise<ActResult> {
    try {
      switch (action.type) {
        case 'navigate':
          await waitForNavigation(this.page, action.url, ACTION_TIMEOUT_MS);
          await settle(this.page, SETTLE_TIMEOUT_MS);
          return { status: 'ok' };

        case 'press':
          await this.page.keyboard.press(action.key);
          await settle(this.page, SETTLE_TIMEOUT_MS);
          return { status: 'ok' };

        case 'waitFor': {
          const held = await waitForCondition(
            () => this.check(action.condition),
            action.timeoutMs ?? CHECK_TIMEOUT_MS,
          );
          return held ? { status: 'ok' } : { status: 'error', reason: 'waitFor: condition never held' };
        }

        case 'assert': {
          const held = await this.check(action.condition, CHECK_TIMEOUT_MS);
          return held ? { status: 'ok' } : { status: 'error', reason: 'assert: condition does not hold' };
        }

        case 'click':
        case 'type':
        case 'select':
        case 'extract': {
          const located = await this.locate(action.target);
          if (!located.ok) return { status: 'error', reason: located.reason };
          const locator = this.locator(located.ref);
          if (locator === undefined) return { status: 'error', reason: 'surfaceError: the frame is gone' };

          if (action.type === 'click') {
            await locator.click({ timeout: ACTION_TIMEOUT_MS });
            await settle(this.page, SETTLE_TIMEOUT_MS);
            return { status: 'ok' };
          }
          if (action.type === 'type') {
            if (action.clearFirst === false) {
              await locator.pressSequentially(action.text, { timeout: ACTION_TIMEOUT_MS });
            } else {
              await locator.fill(action.text, { timeout: ACTION_TIMEOUT_MS });
            }
            return { status: 'ok' };
          }
          if (action.type === 'select') {
            await locator.selectOption(action.value, { timeout: ACTION_TIMEOUT_MS });
            await settle(this.page, SETTLE_TIMEOUT_MS);
            return { status: 'ok' };
          }
          const value =
            action.attribute === 'value' ? located.element.value ?? '' : located.element.text;
          return { status: 'ok', extracted: { [action.as]: value } };
        }
      }
    } catch (error) {
      return { status: 'error', reason: `surfaceError: ${(error as Error).message}` };
    }
  }

  private locator(ref: string) {
    const frame = frameOfRef(this.page, ref);
    if (frame === undefined) return undefined;
    return frame.locator(`[${REF_ATTRIBUTE}="${ref}"]`);
  }

  /** With no timeout this is one reading. With one it polls to the deadline. */
  async check(condition: Condition, timeoutMs?: number): Promise<boolean> {
    if (timeoutMs !== undefined) {
      return waitForCondition(() => this.checkOnce(condition), timeoutMs);
    }
    return this.checkOnce(condition);
  }

  private async checkOnce(condition: Condition): Promise<boolean> {
    switch (condition.kind) {
      case 'elementVisible':
      case 'elementAbsent': {
        const result = resolveAgainst(condition.target, await this.elements());
        const present = result.status === 'resolved';
        return condition.kind === 'elementVisible' ? present : !present;
      }
      case 'textPresent':
      case 'textAbsent': {
        const found = await this.pageContains(condition.text);
        return condition.kind === 'textPresent' ? found : !found;
      }
      case 'urlMatches':
        return new RegExp(condition.pattern).test(this.page.url());
      case 'elementHasText': {
        const result = resolveAgainst(condition.target, await this.elements());
        if (result.status !== 'resolved' || result.element === undefined) return false;
        return result.element.text.includes(condition.text);
      }
    }
  }

  /** Text may live in any frame, so every frame is read. */
  private async pageContains(text: string): Promise<boolean> {
    const wanted = text.replace(/\s+/g, ' ').trim().toLowerCase();
    for (const frame of this.page.frames()) {
      try {
        await installEvalShim(frame);
        const body = await frame.evaluate(() => document.body?.innerText ?? '');
        if (body.replace(/\s+/g, ' ').toLowerCase().includes(wanted)) return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  async screenshot(): Promise<Buffer | undefined> {
    try {
      return await this.page.screenshot({ fullPage: true });
    } catch {
      // Losing a screenshot must not lose the run.
      return undefined;
    }
  }

  async currentUrl(): Promise<string | undefined> {
    return this.page.url();
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }
}

export async function createPlaywrightSurface(
  options: PlaywrightSurfaceOptions,
): Promise<PlaywrightSurface> {
  // The debugging port is what lets an operator drive the same page target the
  // automation is driving. Without it the handoff would open a second session.
  const args = options.cdpPort === undefined ? [] : [`--remote-debugging-port=${options.cdpPort}`];
  const browser = await chromium.launch({ headless: !options.headed, args });
  const context = await browser.newContext(
    omitUndefined({ viewport: options.viewport ?? { width: 1280, height: 900 } }),
  );
  const page = await context.newPage();
  return new PlaywrightSurface(browser, context, page, options.onEvent ?? (() => undefined));
}
