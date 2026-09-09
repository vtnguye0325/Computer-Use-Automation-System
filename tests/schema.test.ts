/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { CapabilitySchema, SCHEMA_VERSION, lintCapability, type Capability } from '../src/schema/capability.js';

function baseCapability(): unknown {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'member.lookup_savings_balance',
    name: 'Look up a member savings balance',
    version: '1.0.0',
    description: 'Search for a member by id and read the current savings balance.',
    app: { id: 'demo-core', baseUrl: 'http://localhost:4173' },
    inputs: [{ name: 'memberId', type: 'string', description: 'Member number', required: true, sensitive: false }],
    outputs: [{ name: 'savingsBalance', type: 'string', description: 'Current balance', fromStepId: 'read-balance', sensitive: false }],
    steps: [
      {
        id: 'search',
        intent: 'Enter the member number into the search field.',
        action: {
          type: 'type',
          target: { description: 'Member search field', strategies: [{ kind: 'roleName', role: 'textbox', name: 'Member Number' }] },
          text: '',
        },
        valueRef: 'memberId',
      },
      {
        id: 'read-balance',
        intent: 'Read the savings balance from the detail screen.',
        action: {
          type: 'extract',
          target: { description: 'Savings balance cell', strategies: [{ kind: 'labelAnchor', anchorText: 'Savings', direction: 'right' }] },
          as: 'savingsBalance',
        },
      },
    ],
    outcomes: [],
    recoveries: [],
    successCheckpoint: { kind: 'textPresent', text: 'Member Detail' },
    provenance: { discoveredAt: '2026-09-08T00:00:00Z', runId: 'run-1', humanEdits: [] },
    status: 'draft',
  };
}

describe('capability schema', () => {
  it('accepts a coherent artifact', () => {
    const parsed = CapabilitySchema.parse(baseCapability());
    expect(lintCapability(parsed)).toEqual([]);
  });

  it('rejects a target with no strategies', () => {
    const bad = baseCapability() as Record<string, any>;
    bad['steps'][0].action.target.strategies = [];
    expect(CapabilitySchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-semver version', () => {
    const bad = baseCapability() as any;
    bad.version = 'v1';
    expect(CapabilitySchema.safeParse(bad).success).toBe(false);
  });

  it('flags an input that no step consumes', () => {
    const cap = CapabilitySchema.parse(baseCapability()) as Capability;
    cap.inputs.push({ name: 'unused', type: 'string', description: 'x', required: true, sensitive: false });
    expect(lintCapability(cap)).toContain('input unused is declared but never used by a step');
  });

  it('flags an output whose producing step does not extract', () => {
    const cap = CapabilitySchema.parse(baseCapability()) as Capability;
    cap.outputs[0]!.fromStepId = 'search';
    expect(lintCapability(cap)).toContain('output savingsBalance maps to step search, which is not an extract action');
  });
});
