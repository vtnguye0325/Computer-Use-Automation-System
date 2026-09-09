/**
 * Perception: one browser page becomes a flat list of controls with geometry.
 *
 * Deviation from the plan, recorded here and in `docs/IMPLEMENTATION_PLAN.md`:
 * the plan called for `page.accessibility.snapshot()`. That snapshot carries
 * neither a frame path nor a bounding box, and `labelAnchor` is decided by
 * geometry. So each frame is walked in the page and normalized to the same
 * role/name shape an accessibility API reports. The DOM stops at this file.
 */
import type { Frame, Page } from 'playwright';
import type { PerceivedElement } from './types.js';
import { omitUndefined } from '../util/object.js';

/**
 * The extra fields resolution needs and the model must not see. `structural`
 * needs a path, and `text` matching needs the control's own text rather than
 * its accessible name.
 */
export interface SurfaceElement extends PerceivedElement {
  path: string;
  text: string;
}

/** Stamped on the element so a `ref` can be turned back into a locator. */
export const REF_ATTRIBUTE = 'data-cuas-ref';

/** Frames are addressed by name, because a legacy frameset names its frames. */
export function framePathOf(frame: Frame): string[] {
  const path: string[] = [];
  let node: Frame | null = frame;
  while (node !== null) {
    const parent: Frame | null = node.parentFrame();
    if (parent !== null) path.unshift(node.name() === '' ? 'frame' : node.name());
    node = parent;
  }
  return path;
}

interface RawElement {
  ref: string;
  role: string;
  name: string;
  value?: string;
  enabled: boolean;
  focused: boolean;
  path: string;
  text: string;
  box?: { x: number; y: number; width: number; height: number };
}

/** Runs inside the page. Returns plain data only. */
function collect(arg: { frameIndex: number; refAttribute: string }): RawElement[] {
  const { frameIndex, refAttribute } = arg;
  const out: RawElement[] = [];
  let counter = 0;

  function directText(el: Element): string {
    let s = '';
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) s += node.nodeValue ?? '';
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  function allText(el: Element): string {
    return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function cssPath(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node !== null && node.nodeName.toLowerCase() !== 'html') {
      const parent: Element | null = node.parentElement;
      if (parent === null) break;
      const tag = node.nodeName.toLowerCase();
      const sameTag = Array.from(parent.children).filter((c) => c.nodeName === node?.nodeName);
      const index = sameTag.indexOf(node) + 1;
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
      node = parent;
    }
    return parts.join(' > ');
  }

  function roleAndName(el: Element): { role: string; name: string; value?: string } | undefined {
    const tag = el.nodeName.toLowerCase();
    const aria = el.getAttribute('aria-label');
    if (tag === 'a') return { role: 'link', name: aria ?? allText(el) };
    if (tag === 'button') return { role: 'button', name: aria ?? allText(el) };
    if (tag === 'select') {
      const sel = el as HTMLSelectElement;
      return { role: 'combobox', name: aria ?? '', value: sel.value };
    }
    if (tag === 'textarea') {
      const ta = el as HTMLTextAreaElement;
      return { role: 'textbox', name: aria ?? '', value: ta.value };
    }
    if (tag === 'input') {
      const input = el as HTMLInputElement;
      const type = (input.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset') {
        return { role: 'button', name: aria ?? input.value };
      }
      if (type === 'checkbox') return { role: 'checkbox', name: aria ?? '', value: input.value };
      if (type === 'radio') return { role: 'radio', name: aria ?? '', value: input.value };
      if (type === 'hidden') return undefined;
      return { role: 'textbox', name: aria ?? '', value: input.value };
    }
    if (/^h[1-6]$/.test(tag)) return { role: 'heading', name: aria ?? allText(el) };
    // A layout table's cell is what carries a legacy label, so it is perceivable.
    if (tag === 'td' || tag === 'th') {
      const own = directText(el);
      if (own === '') return undefined;
      return { role: 'cell', name: own };
    }
    const own = directText(el);
    if (own !== '') return { role: 'text', name: own };
    return undefined;
  }

  for (const el of Array.from(document.querySelectorAll('*'))) {
    const described = roleAndName(el);
    if (described === undefined) continue;
    const rect = el.getBoundingClientRect();
    // A zero-size node is not perceivable, so it must not become a candidate.
    if (rect.width === 0 && rect.height === 0) continue;
    const ref = `f${frameIndex}/n${counter}`;
    counter += 1;
    el.setAttribute(refAttribute, ref);
    const raw: RawElement = {
      ref,
      role: described.role,
      name: described.name,
      enabled: !(el as HTMLInputElement).disabled,
      focused: document.activeElement === el,
      path: cssPath(el),
      text: allText(el),
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
    if (described.value !== undefined) raw.value = described.value;
    out.push(raw);
  }
  return out;
}

/** Every frame, flattened, with the frame path stamped on each node. */
export async function observeElements(page: Page): Promise<SurfaceElement[]> {
  const elements: SurfaceElement[] = [];
  const frames = page.frames();
  for (const [index, frame] of frames.entries()) {
    let raw: RawElement[];
    try {
      await installEvalShim(frame);
      raw = await frame.evaluate(collect, { frameIndex: index, refAttribute: REF_ATTRIBUTE });
    } catch {
      // A frame can navigate out from under the walk. Losing one frame must not
      // lose the observation.
      continue;
    }
    const framePath = framePathOf(frame);
    for (const r of raw) {
      elements.push(
        omitUndefined({
          ref: r.ref,
          role: r.role,
          name: r.name,
          value: r.value,
          enabled: r.enabled,
          focused: r.focused,
          framePath,
          box: r.box,
          path: r.path,
          text: r.text,
        }) as SurfaceElement,
      );
    }
  }
  return elements;
}

/**
 * A function sent into the page is serialized from the *compiled* source. Some
 * TypeScript runners compile with esbuild's `keepNames`, which wraps every
 * function in a `__name` helper that does not exist in the browser, and the
 * evaluate then dies with `__name is not defined`. Declaring the helper in the
 * frame first costs nothing and makes perception independent of the runner.
 */
export async function installEvalShim(frame: Frame): Promise<void> {
  await frame.evaluate('globalThis.__name = globalThis.__name || ((f) => f)');
}

/** The frame a `ref` was perceived in. `f<index>` indexes `page.frames()`. */
export function frameOfRef(page: Page, ref: string): Frame | undefined {
  const match = /^f(\d+)\//.exec(ref);
  if (match === null) return undefined;
  const index = Number(match[1]);
  return page.frames()[index];
}
