/**
 * A desktop surface, declared and stubbed. This is a cut, recorded in
 * `REPORT.md`: the seam is the deliverable, not a second automation stack.
 *
 * It exists to prove the interface holds away from a browser. A desktop
 * accessibility API — UI Automation, AX, AT-SPI — reports the same role, name,
 * value, and bounding box this file's `PerceivedElement` already carries, so
 * the same strategy ladder resolves against it with no change above the seam.
 */
import type {
  Action,
  ActResult,
  Condition,
  Observation,
  ResolveResult,
  Surface,
  TargetDescriptor,
} from './types.js';

const REASON =
  'DesktopSurface is a declared cut. The seam is implemented; no OS automation backend is wired.';

export class DesktopSurface implements Surface {
  readonly kind = 'desktop';

  observe(): Promise<Observation> {
    return Promise.reject(new Error(REASON));
  }

  resolve(_target: TargetDescriptor): Promise<ResolveResult> {
    return Promise.reject(new Error(REASON));
  }

  act(_action: Action): Promise<ActResult> {
    return Promise.resolve({ status: 'error', reason: REASON });
  }

  check(_condition: Condition, _timeoutMs?: number): Promise<boolean> {
    return Promise.reject(new Error(REASON));
  }

  screenshot(): Promise<Buffer | undefined> {
    return Promise.resolve(undefined);
  }

  currentUrl(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
