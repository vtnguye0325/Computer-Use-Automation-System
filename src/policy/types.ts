/**
 * Guardrails.
 *
 * Every action in this system — during discovery and during replay — passes
 * through one choke point. There is deliberately no second path.
 */
import type { Action, ActionType } from '../surface/types.js';

/**
 * safe         reads and in-allowlist navigation
 * guarded      writes that a person could undo
 * irreversible money movement, deletion, anything with no undo
 *
 * The default posture is fail-closed: an unclassified action is treated as
 * irreversible. In regulated finance the cost of one wrong irreversible action
 * far exceeds the cost of asking a human.
 */
export type RiskClass = 'safe' | 'guarded' | 'irreversible';

export interface PolicyConfig {
  /** Origins the agent may visit. Anything else is blocked. */
  allowedOrigins: string[];
  /** Route patterns within those origins, as path globs. Empty means all. */
  allowedRoutes: string[];
  /** Action types the agent may perform at all. */
  allowedActions: ActionType[];
  /** Text matched against a control's name or a URL to raise its risk class. */
  riskRules: Array<{ match: string; risk: RiskClass; reason: string }>;
  /** How each risk class is handled, per execution mode. */
  handling: Record<RiskClass, 'allow' | 'confirm' | 'block'>;
  /** Regexes whose matches are replaced before anything is written to disk. */
  redactPatterns: Array<{ name: string; pattern: string }>;
}

export type PolicyDecision =
  | { verdict: 'allow'; risk: RiskClass }
  | { verdict: 'confirm'; risk: RiskClass; reason: string }
  | { verdict: 'block'; risk: RiskClass; reason: string };

export interface PolicyEngine {
  /** The single choke point. Both the agent loop and replay call this. */
  check(action: Action, context: { mode: 'discovery' | 'replay'; currentUrl?: string }): PolicyDecision;
  /** Applied at the recorder boundary, so nothing sensitive reaches disk. */
  redact(value: string): string;
}
