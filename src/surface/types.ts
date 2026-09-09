/**
 * The surface abstraction.
 *
 * This is the seam between "how we perceive and act on an application" and
 * "the recorded flow". Everything above this file — the discovery agent, the
 * replay engine, the artifact schema — is written against these types only.
 * A browser is one implementation. A desktop accessibility API is another.
 *
 * Design rule: nothing in this file may mention the DOM, CSS, or Playwright.
 */

/** How an element is described so that it can be found again later. */
export type TargetStrategy =
  /**
   * Accessibility role plus accessible name. The primary strategy: it exists
   * on the web and on desktop accessibility APIs, and it survives markup
   * churn because it tracks what the control *is*, not how it is built.
   */
  | { kind: 'roleName'; role: AriaRole; name: string; exact?: boolean }
  /**
   * A visible label or nearby text, plus the direction of the control from
   * that anchor. This is how a human finds a field in a table-based legacy
   * layout that has no label association.
   */
  | { kind: 'labelAnchor'; anchorText: string; direction: 'right' | 'below' | 'left' | 'above'; role?: AriaRole }
  /**
   * A structural path inside a named region or frame. Used when a legacy app
   * genuinely offers nothing semantic. Recorded with its frame path so that
   * frameset-based apps stay addressable.
   */
  | { kind: 'structural'; framePath: string[]; path: string }
  /** Match on the control's own visible text. */
  | { kind: 'text'; text: string; exact?: boolean }
  /**
   * Absolute coordinates. Last resort. Always recorded as fragile so that a
   * reviewer can see when an artifact leans on something that will not
   * survive a window resize.
   */
  | { kind: 'coordinates'; x: number; y: number };

/**
 * An ordered ladder of strategies for one control. Replay tries them in
 * order and records which one resolved, so the evidence shows when an
 * artifact is degrading toward its fragile fallbacks.
 */
export interface TargetDescriptor {
  /** Human-readable description of the control, for review and for logs. */
  description: string;
  /** Ordered, most robust first. Must not be empty. */
  strategies: TargetStrategy[];
  /** Frame or window the control lives in, when the surface has more than one. */
  framePath?: string[];
}

export type AriaRole =
  | 'button'
  | 'link'
  | 'textbox'
  | 'searchbox'
  | 'combobox'
  | 'checkbox'
  | 'radio'
  | 'option'
  | 'heading'
  | 'cell'
  | 'row'
  | 'table'
  | 'dialog'
  | 'alert'
  | 'list'
  | 'listitem'
  | 'region'
  | 'form'
  | 'img'
  | 'text'
  | 'generic';

/**
 * The closed set of things anything in this system may do to a surface.
 *
 * The discovery agent's tool set and the replay executor share this union.
 * The model therefore cannot invent a step that replay is unable to run.
 */
export type Action =
  | { type: 'navigate'; url: string }
  | { type: 'click'; target: TargetDescriptor }
  | { type: 'type'; target: TargetDescriptor; text: string; clearFirst?: boolean }
  | { type: 'select'; target: TargetDescriptor; value: string }
  | { type: 'press'; key: string }
  | { type: 'waitFor'; condition: Condition; timeoutMs?: number }
  | { type: 'extract'; target: TargetDescriptor; as: string; attribute?: 'text' | 'value' }
  | { type: 'assert'; condition: Condition };

export type ActionType = Action['type'];

/** A checkable statement about the current state of the surface. */
export type Condition =
  | { kind: 'elementVisible'; target: TargetDescriptor }
  | { kind: 'elementAbsent'; target: TargetDescriptor }
  | { kind: 'textPresent'; text: string }
  | { kind: 'textAbsent'; text: string }
  | { kind: 'urlMatches'; pattern: string }
  | { kind: 'elementHasText'; target: TargetDescriptor; text: string };

/** One control as perceived on the surface, normalized away from any toolkit. */
export interface PerceivedElement {
  ref: string;
  role: AriaRole | string;
  name: string;
  value?: string;
  enabled: boolean;
  focused?: boolean;
  framePath: string[];
  box?: { x: number; y: number; width: number; height: number };
}

/** A single reading of the surface state. */
export interface Observation {
  url?: string;
  title?: string;
  elements: PerceivedElement[];
  /** PNG bytes. Present when the surface can produce one. */
  screenshot?: Buffer;
  capturedAt: string;
}

/** A resolved, actionable handle to one control. */
export interface Handle {
  ref: string;
  strategyUsed: TargetStrategy;
  /** Index into TargetDescriptor.strategies. Higher means more degraded. */
  strategyIndex: number;
}

export type ResolveResult =
  | { status: 'resolved'; handle: Handle }
  | { status: 'notFound'; triedStrategies: number }
  /** Never guess between candidates. Ambiguity is a defect in the artifact. */
  | { status: 'ambiguous'; strategyIndex: number; candidateCount: number };

export type ActResult =
  | { status: 'ok'; extracted?: Record<string, string> }
  | { status: 'error'; reason: string };

/**
 * What every surface implementation must provide.
 *
 * `PlaywrightSurface` implements this against a browser. `DesktopSurface` is
 * a documented stub that proves the seam holds for an OS-level surface.
 */
export interface Surface {
  readonly kind: string;
  observe(): Promise<Observation>;
  resolve(target: TargetDescriptor): Promise<ResolveResult>;
  act(action: Action): Promise<ActResult>;
  check(condition: Condition, timeoutMs?: number): Promise<boolean>;
  screenshot(): Promise<Buffer | undefined>;
  currentUrl(): Promise<string | undefined>;
  close(): Promise<void>;
}
