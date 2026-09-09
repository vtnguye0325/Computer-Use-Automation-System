/**
 * Evidence.
 *
 * One directory per run. Reading events.jsonl alone must explain what the
 * system did and why. Every event names who acted, so a human takeover is
 * visible in the same stream as the automation.
 */
export type Actor = 'agent' | 'replay' | 'human' | 'system';

export interface EvidenceEvent {
  at: string;
  runId: string;
  actor: Actor;
  /** e.g. 'step.start', 'target.resolved', 'policy.block', 'handoff.granted'. */
  event: string;
  stepId?: string;
  /** Why this happened. Free text, already redacted. */
  reason?: string;
  data?: Record<string, unknown>;
}

export interface EvidenceRecorder {
  readonly runId: string;
  readonly dir: string;
  log(event: Omit<EvidenceEvent, 'at' | 'runId'>): Promise<void>;
  /** Saves a PNG and returns its path relative to the run directory. */
  saveScreenshot(name: string, png: Buffer): Promise<string>;
  /** Saves any structured snapshot: an observation, a DOM dump, a trace. */
  saveSnapshot(name: string, payload: unknown): Promise<string>;
  /** Writes the final result and closes the run. */
  finish(result: unknown): Promise<void>;
}
