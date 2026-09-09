/**
 * Control transfer.
 *
 * Automation must be able to pause, cede the *same* live session to a person,
 * and resume. The broker owns the session and the answer to "who is driving".
 */
import type { Surface } from '../surface/types.js';

export type Controller = 'automation' | 'human' | 'none';

export interface Intervention {
  id: string;
  runId: string;
  capabilityId?: string;
  goal?: string;
  stepId?: string;
  reason: string;
  createdAt: string;
  /** Paths, relative to the evidence directory, that give the operator context. */
  screenshotPath?: string;
  snapshotPath?: string;
  /** How the operator attaches to the live session. */
  attachUrl?: string;
  status: 'open' | 'in_progress' | 'resolved' | 'abandoned';
  /** Filled in on hand-back, so the human's work is part of the record. */
  resolution?: { at: string; by: string; note: string };
}

export interface SessionBroker {
  readonly sessionId: string;
  readonly surface: Surface;
  /** Nobody acts without holding control. Acting without it is a defect. */
  controller(): Controller;
  /** Pause automation and raise an intervention against the live session. */
  escalate(request: Omit<Intervention, 'id' | 'createdAt' | 'status'>): Promise<Intervention>;
  /** Grant a person control of the session the automation was already using. */
  grantToHuman(interventionId: string): Promise<{ attachUrl: string }>;
  /** Take control back, after the human declares they are done. */
  reclaim(interventionId: string, resolution: { by: string; note: string }): Promise<void>;
  close(): Promise<void>;
}
