/**
 * The replay result contract.
 *
 * This union is the whole point of the system's error model. A caller must be
 * able to tell, without parsing prose, whether it got an answer, a legitimate
 * business answer it did not want, a defect, or a request for a human.
 */
import type { Condition } from '../surface/types.js';

export type FailureCategory =
  /** The artifact described a control that no longer resolves uniquely. */
  | 'targetNotFound'
  | 'targetAmbiguous'
  /** A step ran, but the state afterwards was not what the artifact asserted. */
  | 'checkpointFailed'
  /** The surface stopped cooperating: timeout, navigation error, crash. */
  | 'surfaceError'
  /** The session died underneath the run. */
  | 'sessionExpired'
  /** The policy engine refused the action. */
  | 'policyBlocked'
  /** Supplied inputs did not satisfy the declared parameter contract. */
  | 'invalidInput'
  /** The artifact itself is incoherent. */
  | 'invalidArtifact';

export interface ReplayContext {
  runId: string;
  capabilityId: string;
  capabilityVersion: string;
  evidencePath: string;
}

export type ReplayResult =
  | ({ status: 'success'; outputs: Record<string, string | number | boolean> } & ReplayContext)
  /** A legitimate answer the caller needs to know about, e.g. "no such member". */
  | ({ status: 'business_outcome'; outcome: string; detail: string; outputs?: Record<string, string | number | boolean> } & ReplayContext)
  | ({
      status: 'failed';
      category: FailureCategory;
      stepId?: string;
      expected?: Condition | string;
      observed?: string;
      message: string;
    } & ReplayContext)
  /** Paused and waiting on a human. The run is resumable on the same session. */
  | ({ status: 'escalated'; interventionId: string; stepId?: string; reason: string } & ReplayContext);

export function isTerminal(result: ReplayResult): boolean {
  return result.status !== 'escalated';
}
