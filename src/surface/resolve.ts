/**
 * The strategy ladder. One matcher per strategy, all of them reading the
 * flattened observation rather than the DOM.
 *
 * The ladder stops at the first strategy that yields exactly one candidate.
 * Two candidates under a strategy means the artifact describes the control
 * imprecisely, so the run stops. Falling through would silently pick a
 * different control on a different day, which is the failure this system
 * exists to prevent.
 */
import type { ResolveResult, TargetDescriptor, TargetStrategy } from './types.js';
import type { SurfaceElement } from './observe.js';

/** Roles a person can act on. `labelAnchor` searches these unless told a role. */
const ACTIONABLE = new Set(['textbox', 'combobox', 'checkbox', 'radio', 'button', 'link']);

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function matches(candidate: string, wanted: string, exact: boolean | undefined): boolean {
  const c = norm(candidate);
  const w = norm(wanted);
  if (w === '') return false;
  return exact === true ? c === w : c === w || c.includes(w);
}

function samePath(a: string[] | undefined, b: string[]): boolean {
  if (a === undefined) return true;
  return a.length === b.length && a.every((part, i) => part === b[i]);
}

type Box = NonNullable<SurfaceElement['box']>;

/** The nearest actionable node in `direction` from the anchor's box. */
function nearestFrom(anchor: SurfaceElement, pool: SurfaceElement[], direction: 'right' | 'below' | 'left' | 'above'): SurfaceElement | undefined {
  const a: Box | undefined = anchor.box;
  if (a === undefined) return undefined;
  let best: SurfaceElement | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of pool) {
    const b = candidate.box;
    if (b === undefined || candidate.ref === anchor.ref) continue;
    if (!samePath(anchor.framePath, candidate.framePath)) continue;
    // Overlap by more than half the anchor keeps the match on the same row or
    // column. A nested table breaks "the next node in document order".
    const vOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    const hOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    let distance: number;
    if (direction === 'right') {
      if (vOverlap < a.height / 2 || b.x < a.x + a.width - 2) continue;
      distance = b.x - (a.x + a.width);
    } else if (direction === 'left') {
      if (vOverlap < a.height / 2 || b.x + b.width > a.x + 2) continue;
      distance = a.x - (b.x + b.width);
    } else if (direction === 'below') {
      if (hOverlap < a.width / 2 || b.y < a.y + a.height - 2) continue;
      distance = b.y - (a.y + a.height);
    } else {
      if (hOverlap < a.width / 2 || b.y + b.height > a.y + 2) continue;
      distance = a.y - (b.y + b.height);
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** Every element one strategy considers a match, deduplicated by `ref`. */
export function matchAll(
  strategy: TargetStrategy,
  elements: SurfaceElement[],
  framePath?: string[],
): SurfaceElement[] {
  const scoped = elements.filter((e) => samePath(framePath, e.framePath));
  switch (strategy.kind) {
    case 'roleName':
      return scoped.filter((e) => e.role === strategy.role && matches(e.name, strategy.name, strategy.exact));
    case 'labelAnchor': {
      const anchors = scoped.filter((e) => matches(e.name, strategy.anchorText, true));
      const pool = scoped.filter((e) =>
        strategy.role === undefined ? ACTIONABLE.has(e.role) : e.role === strategy.role,
      );
      const hits: SurfaceElement[] = [];
      for (const anchor of anchors) {
        const near = nearestFrom(anchor, pool, strategy.direction);
        if (near !== undefined && !hits.some((h) => h.ref === near.ref)) hits.push(near);
      }
      return hits;
    }
    case 'structural':
      return scoped.filter(
        (e) => samePath(strategy.framePath, e.framePath) && e.path === strategy.path,
      );
    case 'text':
      return scoped.filter((e) => matches(e.text, strategy.text, strategy.exact));
    case 'coordinates':
      return scoped.filter((e) => {
        const b = e.box;
        if (b === undefined) return false;
        return (
          strategy.x >= b.x && strategy.x <= b.x + b.width &&
          strategy.y >= b.y && strategy.y <= b.y + b.height
        );
      });
  }
}

/**
 * Walk the ladder. Returns which strategy index won, so evidence shows when an
 * artifact degrades toward its fragile fallbacks.
 */
export function resolveAgainst(target: TargetDescriptor, elements: SurfaceElement[]): ResolveResult & { element?: SurfaceElement } {
  for (const [index, strategy] of target.strategies.entries()) {
    const candidates = matchAll(strategy, elements, target.framePath);
    if (candidates.length === 0) continue;
    if (candidates.length > 1) {
      return { status: 'ambiguous', strategyIndex: index, candidateCount: candidates.length };
    }
    const element = candidates[0];
    if (element === undefined) continue;
    return {
      status: 'resolved',
      handle: { ref: element.ref, strategyUsed: strategy, strategyIndex: index },
      element,
    };
  }
  return { status: 'notFound', triedStrategies: target.strategies.length };
}
