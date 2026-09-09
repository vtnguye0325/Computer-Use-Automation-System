/**
 * The capability artifact.
 *
 * A capability is a typed, versioned, reviewable contract: what the flow does,
 * what it needs, what it returns, and how it knows it succeeded. It is
 * deliberately decoupled from the model transcript that produced it — the
 * transcript is evidence, the capability is the product.
 */
import { z } from 'zod';

/** Bump when the shape below changes in a way old artifacts cannot satisfy. */
export const SCHEMA_VERSION = '1.0.0';

export const AriaRoleSchema = z.enum([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
  'option', 'heading', 'cell', 'row', 'table', 'dialog', 'alert', 'list',
  'listitem', 'region', 'form', 'img', 'text', 'generic',
]);

export const TargetStrategySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('roleName'), role: AriaRoleSchema, name: z.string(), exact: z.boolean().optional() }),
  z.object({
    kind: z.literal('labelAnchor'),
    anchorText: z.string(),
    direction: z.enum(['right', 'below', 'left', 'above']),
    role: AriaRoleSchema.optional(),
  }),
  z.object({ kind: z.literal('structural'), framePath: z.array(z.string()), path: z.string() }),
  z.object({ kind: z.literal('text'), text: z.string(), exact: z.boolean().optional() }),
  z.object({ kind: z.literal('coordinates'), x: z.number(), y: z.number() }),
]);

export const TargetDescriptorSchema = z.object({
  description: z.string().min(1),
  strategies: z.array(TargetStrategySchema).min(1),
  framePath: z.array(z.string()).optional(),
});

export const ConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('elementVisible'), target: TargetDescriptorSchema }),
  z.object({ kind: z.literal('elementAbsent'), target: TargetDescriptorSchema }),
  z.object({ kind: z.literal('textPresent'), text: z.string() }),
  z.object({ kind: z.literal('textAbsent'), text: z.string() }),
  z.object({ kind: z.literal('urlMatches'), pattern: z.string() }),
  z.object({ kind: z.literal('elementHasText'), target: TargetDescriptorSchema, text: z.string() }),
]);

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), url: z.string() }),
  z.object({ type: z.literal('click'), target: TargetDescriptorSchema }),
  z.object({ type: z.literal('type'), target: TargetDescriptorSchema, text: z.string(), clearFirst: z.boolean().optional() }),
  z.object({ type: z.literal('select'), target: TargetDescriptorSchema, value: z.string() }),
  z.object({ type: z.literal('press'), key: z.string() }),
  z.object({ type: z.literal('waitFor'), condition: ConditionSchema, timeoutMs: z.number().int().positive().optional() }),
  z.object({ type: z.literal('extract'), target: TargetDescriptorSchema, as: z.string(), attribute: z.enum(['text', 'value']).optional() }),
  z.object({ type: z.literal('assert'), condition: ConditionSchema }),
]);

/** Inputs the calling agent supplies per invocation. */
export const ParamSpecSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string(),
  required: z.boolean().default(true),
  pattern: z.string().optional(),
  example: z.string().optional(),
  /**
   * Marks regulated or secret data. A sensitive value is never written to an
   * artifact, a log, or an evidence file — the recorder redacts it.
   */
  sensitive: z.boolean().default(false),
});

/** Data the capability returns to its caller. */
export const OutputSpecSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string(),
  /** The step whose `extract` action produces this value. */
  fromStepId: z.string(),
  sensitive: z.boolean().default(false),
});

/**
 * A legitimate business answer that is not a crash.
 *
 * "No such member" belongs here, not in the error path. Conflating the two is
 * the most common design mistake in this problem.
 */
export const OutcomeSpecSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** When this holds after any step, replay stops and returns this outcome. */
  detect: ConditionSchema,
  terminal: z.boolean().default(true),
});

/**
 * A known, benign interruption that replay clears on its own — a one-off
 * interstitial, a transient slow load. Each recovery is logged as evidence.
 */
export const RecoverySchema = z.object({
  name: z.string(),
  when: ConditionSchema,
  then: z.array(ActionSchema).min(1),
  maxAttempts: z.number().int().positive().default(2),
});

export const StepSchema = z.object({
  id: z.string().min(1),
  /** Why this step exists, in the operator's words. Makes review possible. */
  intent: z.string().min(1),
  action: ActionSchema,
  /** Must hold before the step runs. */
  preconditions: z.array(ConditionSchema).default([]),
  /**
   * Must hold after the step runs. Per-step verification is what turns a
   * silent wrong-page failure into a precise, debuggable error.
   */
  postcondition: ConditionSchema.optional(),
  /** Binds a declared input parameter into the action's value slot. */
  valueRef: z.string().optional(),
  onFailure: z.enum(['retry', 'escalate', 'fail']).default('fail'),
  timeoutMs: z.number().int().positive().default(10_000),
  maxRetries: z.number().int().min(0).default(0),
  /** Risk class, mirrored from the policy engine at record time for review. */
  risk: z.enum(['safe', 'guarded', 'irreversible']).default('safe'),
});

export const AppRefSchema = z.object({
  /** Logical app identity, shared across tenants running the same product. */
  id: z.string(),
  vendorProduct: z.string().optional(),
  /** Absent means the artifact is the cross-tenant base version. */
  tenantId: z.string().optional(),
  /** Named skin or version of the same vendor product. */
  variant: z.string().optional(),
  baseUrl: z.string(),
});

export const ProvenanceSchema = z.object({
  discoveredAt: z.string(),
  model: z.string().optional(),
  runId: z.string(),
  /** Every hand edit after discovery, so review has a trail. */
  humanEdits: z.array(z.object({ at: z.string(), by: z.string(), note: z.string() })).default([]),
});

export const CapabilitySchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  /** Semver. A calling agent pins a version. */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  app: AppRefSchema,
  inputs: z.array(ParamSpecSchema).default([]),
  outputs: z.array(OutputSpecSchema).default([]),
  steps: z.array(StepSchema).min(1),
  outcomes: z.array(OutcomeSpecSchema).default([]),
  recoveries: z.array(RecoverySchema).default([]),
  /** The final assertion that the goal was actually reached. */
  successCheckpoint: ConditionSchema,
  provenance: ProvenanceSchema,
  /** Only an approved capability may run unattended. */
  status: z.enum(['draft', 'approved']).default('draft'),
});

export type Capability = z.infer<typeof CapabilitySchema>;
export type Step = z.infer<typeof StepSchema>;
export type ParamSpec = z.infer<typeof ParamSpecSchema>;
export type OutputSpec = z.infer<typeof OutputSpecSchema>;
export type OutcomeSpec = z.infer<typeof OutcomeSpecSchema>;
export type Recovery = z.infer<typeof RecoverySchema>;

/**
 * Structural checks the type system cannot express.
 * Returns a list of problems; empty means the artifact is coherent.
 */
export function lintCapability(cap: Capability): string[] {
  const problems: string[] = [];
  const stepIds = new Set<string>();

  for (const step of cap.steps) {
    if (stepIds.has(step.id)) problems.push(`duplicate step id: ${step.id}`);
    stepIds.add(step.id);
    if (step.valueRef && !cap.inputs.some((i) => i.name === step.valueRef)) {
      problems.push(`step ${step.id} references unknown input: ${step.valueRef}`);
    }
  }

  for (const output of cap.outputs) {
    if (!stepIds.has(output.fromStepId)) {
      problems.push(`output ${output.name} references unknown step: ${output.fromStepId}`);
    }
    const producer = cap.steps.find((s) => s.id === output.fromStepId);
    if (producer && producer.action.type !== 'extract') {
      problems.push(`output ${output.name} maps to step ${producer.id}, which is not an extract action`);
    }
  }

  for (const input of cap.inputs) {
    if (!cap.steps.some((s) => s.valueRef === input.name)) {
      problems.push(`input ${input.name} is declared but never used by a step`);
    }
  }

  return problems;
}
