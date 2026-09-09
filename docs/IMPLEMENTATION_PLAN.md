# Implementation Plan — Computer-Use Automation System

Companion to `docs/REQUIREMENTS.md`. This plan proposes a concrete stack, a build
order, and the decisions I must be ready to defend. Every choice below is a default
I picked to keep the project moving; change it if you disagree, but change it before
Phase 1 rather than in the middle.

## 0. Decisions taken up front

| Decision | Choice | Why |
| --- | --- | --- |
| Language / runtime | TypeScript on Node 20+ | Playwright is first-class here, the artifact schema wants real static types, and the reviewer reads types as design. |
| Schema validation | Zod, with JSON Schema generated from it | One source of truth for the artifact contract, runtime validation of inputs, and a machine-readable contract for a calling agent. |
| Computer-use driver | Playwright, driven through an **accessibility-tree + screenshot** perception layer, not raw CSS selectors | The brief says to bias toward an approach that survives a dirty DOM. The AX tree exists on desktop too, so the perception seam stays honest. |
| LLM | Claude (`claude-opus-5` for discovery), tool-calling with a fixed action tool set | Native computer-use and strong structured tool output. The action tool set is the same enum the replay engine executes, so discovery cannot invent an unreplayable step. |
| Target app | A **local, intentionally hostile "credit union back office" app** I build: framesets or nested tables, no test IDs, generated class names, a confirmation dialog, a session-timeout mode, and a not-found path | No terms-of-service risk, no rate limits, no real PII, and I can inject the exact failure modes Section 3.3 asks me to demonstrate. This is the single highest-leverage choice in the project. |
| Storage | Artifacts as JSON files on disk under `capabilities/`, evidence under `evidence/<run-id>/` | The brief explicitly does not reward infrastructure. A database adds nothing to the evaluation. |
| Architecture | One process, one CLI with subcommands, plus a tiny local HTTP server for the operator handoff | Simplest thing that makes the control-transfer model real. |

**Model of the whole system:** a `Surface` interface (perceive, act, snapshot) sits
under both the discovery agent and the replay engine. Discovery writes a `Capability`
artifact. Replay reads it. Both go through a `PolicyEngine` and both write to the same
`EvidenceRecorder`. The `SessionBroker` owns the live browser session and can transfer
control between the automation and a human.

## 1. Phase plan

Phases are ordered so that the riskiest, highest-weight work happens early and the
end-to-end thread is closed before any polish begins.

### Phase 0 — Repo skeleton (short)
- `package.json`, TypeScript strict mode, `vitest`, `eslint`, `.env.example`, `.gitignore`.
- Directory layout:
  ```
  src/surface/      perception + action abstraction, Playwright implementation
  src/schema/       Zod artifact schema, versioning, JSON Schema emit
  src/discovery/    LLM agent loop
  src/replay/       deterministic executor
  src/policy/       allowlist, action risk classes, redaction
  src/evidence/     structured logging, screenshots, run directories
  src/session/      session broker + operator handoff server
  src/cli.ts        record | replay | catalog | operator
  fixtures/app/     the hostile target application
  capabilities/     saved artifacts
  evidence/         run output (committed for the demo runs)
  ```
- **Exit:** `npm run build` and `npm test` pass on an empty test.

### Phase 1 — The target application
Build this first. Everything downstream is only as interesting as this surface.

- A small Express app serving server-rendered HTML with a deliberately legacy shape:
  a frameset or nested-table layout, non-semantic markup, no `data-testid`, hashed
  class names that change per build.
- Flow: **member search → member detail → open sub-account → confirmation screen.**
  That is the "search → detail → action" shape the brief names.
- Built-in fault injection, driven by a query param or header so replay can trigger
  each on demand:
  - `notFound` — the member does not exist (an **expected business outcome**),
  - `validation` — the form rejects an input with an inline error,
  - `interstitial` — a one-off confirmation dialog appears (a **recoverable condition**),
  - `slow` — a delayed load that a wait strategy should absorb,
  - `sessionExpired` — the session dies mid-flow (a **hard failure** that should escalate),
  - `serverError` — a 500 (**hard failure**).
- Seed data with obviously fake members and balances.
- **Exit:** I can walk the full flow by hand in a browser, and each fault injector fires.

### Phase 2 — Surface abstraction
This is the seam the write-up section 4 depends on. Define it before writing the agent.

- `interface Surface` with roughly: `observe(): Promise<Observation>`,
  `act(action: Action): Promise<ActResult>`, `snapshot(): Promise<Evidence>`,
  `resolve(target: TargetDescriptor): Promise<Handle | null>`.
- `Observation` = a normalized element list derived from the accessibility tree
  (role, accessible name, value, enabled state, bounding box, a frame path) plus an
  optional screenshot. Deliberately **not** a DOM dump: a desktop AX tree can produce
  the same shape.
- `Action` is a closed union: `navigate`, `click`, `type`, `select`, `press`,
  `waitFor`, `extract`, `assert`. The LLM's tool set and the replay executor share
  this union. Nothing else is expressible.
- `TargetDescriptor` is the robustness story. It is an **ordered list of strategies**,
  not one selector:
  1. role + accessible name (primary; works on desktop too),
  2. label or nearby-text anchor plus relative position,
  3. structural path within a named frame or region,
  4. text content match,
  5. bounding-box coordinates (last resort, recorded but flagged as fragile).
  Replay tries them in order, records which strategy resolved, and fails loudly when
  a strategy resolves to more than one candidate.
- `PlaywrightSurface` implements it. A `DesktopSurface` stub with the same interface
  and a "not implemented" body proves the seam is real, and is documented as a cut.
- **Exit:** unit tests resolve every control in the Phase 1 app through strategy 1 or 2.

### Phase 3 — Artifact schema
The highest-weight single artifact in the evaluation. Design it deliberately, in Zod.

Shape to aim for:

```
Capability {
  schemaVersion        // schema evolution, separate from capability version
  id, name, version    // semver; the calling agent pins a version
  description          // human- and agent-readable
  app: { id, vendorProduct?, tenantId?, baseUrl, variant? }
  inputs:  ParamSpec[]   // name, type, required, format, example, sensitivity flag
  outputs: OutputSpec[]  // name, type, source step, extraction target
  steps:   Step[]
  outcomes: OutcomeSpec[]  // named business outcomes and how to detect each
  successCheckpoint: Checkpoint
  provenance: { discoveredAt, model, runId, humanEdits[] }
  status: 'draft' | 'approved'
}

Step {
  id, intent           // human-readable "why", not just "what"
  action: Action       // the closed union from Phase 2
  target?: TargetDescriptor
  valueRef?            // binds an input param into the action
  preconditions: Checkpoint[]
  postcondition: Checkpoint    // per-step verification, not just at the end
  onFailure: 'retry' | 'escalate' | 'fail' | 'branch'
  timeoutMs, retry policy
}
```

Design points to state explicitly in `REPORT.md`:
- Inputs and outputs make the artifact a **typed callable contract**, not a macro.
- `intent` per step is what makes the artifact reviewable by a human.
- **Per-step postconditions**, not only a final checkpoint, are what turn a silent
  wrong-page failure into a precise error.
- `outcomes` is where "no such member" lives, so business outcomes never travel as
  exceptions.
- Parameterized routes (`/member/:id`) instead of concrete ones so the artifact is
  already tenant-shaped.
- `app.variant` plus a future override layer is the multi-tenant seam.
- Values marked sensitive are never written to the artifact or the log.

Also emit JSON Schema from the Zod definitions into `capabilities/schema/`.

- **Exit:** a hand-written artifact for the Phase 1 flow parses and validates.

### Phase 4 — Deterministic replay engine
Build replay **before** discovery. If replay can execute a hand-written artifact, then
discovery only has to produce one, and I never debug the model and the executor together.

- Validate inputs against `inputs` and reject with a typed error before touching the browser.
- For each step: check preconditions → resolve the target through the strategy ladder →
  act → verify the postcondition → record evidence.
- Waiting is explicit and condition-based. No fixed sleeps anywhere.
- Outcome detection runs after every step, so a "record not found" banner short-circuits
  the remaining steps and returns cleanly.
- The result contract is a discriminated union:
  ```
  { status: 'success', outputs, runId, evidencePath }
  { status: 'business_outcome', outcome, detail, outputs?, runId, evidencePath }
  { status: 'failed', stepId, expected, observed, category, runId, evidencePath }
  { status: 'escalated', interventionId, stepId, reason, runId, evidencePath }
  ```
- Recoverable conditions (known interstitial, transient slowness) are handled inside the
  engine with a bounded retry, and each recovery is logged as an event.
- **Exit:** the hand-written artifact replays green, and each Phase 1 fault injector
  produces the correct one of the four result statuses. This is the moment the project
  becomes defensible.

### Phase 5 — LLM discovery loop
- Input: goal string, target URL, optional parameter hints.
- Loop: `observe` (a compact AX-tree text rendering plus a screenshot) → model call with
  the Phase 2 action union as tools → policy check → `act` → append to the trace.
- Stopping conditions: max steps, wall-clock timeout, repeated no-progress states, and
  a policy block.
- The model is asked to declare, alongside each action, the `intent` and the
  `TargetDescriptor` strategies it believes are stable — that is what makes the artifact
  more than a click recording.
- On success, a **compilation** step converts the trace into a `Capability`:
  generalize literal values into input parameters, strip the model transcript, verify
  the compiled artifact against the schema, then immediately replay it once to prove it
  works. **An artifact that has not been replayed once is never saved as approved.**
- **Exit:** one real run against the local app produces a saved artifact, with the full
  trace in `evidence/`.

### Phase 6 — Safety and policy
Threaded through Phases 4 and 5 from the start, hardened here.

- `policy.yaml`: allowed origins and route patterns, allowed action types, per-action
  risk classification, and redaction patterns.
- Every action passes through `PolicyEngine.check()` in both discovery and replay. There
  is exactly one choke point.
- Risk classes: `safe` (read, navigate within allowlist), `guarded` (writes that are
  reversible — allowed in replay, confirmed in discovery), `irreversible` (submit money
  movement, delete) — **blocked and escalated by default**. Defend this as fail-closed:
  in regulated finance, the cost of a wrong irreversible action far exceeds the cost of
  a human confirmation.
- Redaction runs at the recorder boundary so nothing sensitive can reach a log or an
  artifact even by accident. Test it.
- **Exit:** a test proves an off-allowlist navigation is blocked, and a test proves a
  field marked sensitive never appears in the artifact or the log.

### Phase 7 — Evidence and observability
- One directory per run: `evidence/<runId>/` with `events.jsonl` (structured,
  timestamped, redacted), `screenshots/`, `ax/` snapshots, `result.json`, and the
  Playwright trace on failure.
- Every event carries `runId`, `stepId`, `actor` (`agent` | `replay` | `human`), and a reason.
- **Exit:** reading `events.jsonl` alone explains what happened and why.

### Phase 8 — Escalation and handoff
The requirement most submissions leave as a TODO. Make it real.

- `SessionBroker` owns the browser context and a `controller` field:
  `automation` | `human` | `none`. Every act call asserts it holds control.
- On escalation: pause the loop, capture full context (capability, step, screenshot,
  AX snapshot, reason), write an `Intervention` record, and set `controller = 'human'`.
- Expose the **same live session** — the honest and simple mechanism is to launch the
  browser with a remote debugging port and hand the operator a URL that attaches to that
  exact context, so the human drives the session the automation was using, not a new one.
- A minimal operator surface (a local page listing open interventions, with the context,
  a "take control" and a "hand back" button, and a free-text note field) is enough. It is
  a documented mock of a real console.
- While the human holds control, keep recording: capture navigation and input events into
  the same evidence stream, tagged `actor: human`.
- On hand-back, re-verify the current step's postcondition before resuming, because the
  human may have left the session somewhere unexpected. Then continue.
- **Exit:** a demo where a replay hits the `sessionExpired` injector, escalates, a human
  fixes it in the live session, hands control back, and the replay completes. The evidence
  shows the whole sequence including the human's actions.

### Phase 9 — Write-up and deliverables
- `/README.md`: setup, `.env` keys, how to start the local target app, and the exact
  demo commands for record → replay → failing replay → escalation.
- `/REPORT.md`: the seven required headings, in order, no substitutions.
- `/evidence/`: committed output from a discovery run, a clean replay, a failing replay,
  and the escalation run.
- Tests where they count: the schema, the target-resolution ladder, the outcome
  classifier, the policy engine, and redaction.
- **Exit:** a clean clone runs the demo path from the README with no undocumented steps.

### Phase 10 — Stretch, only if the core is solid
Pick at most one. Ranked by how much each strengthens the main story:
1. **Capability catalog** — an endpoint or tool surface that lists artifacts with their
   typed args, plus one shown invocation. It closes the "agent invokes it in production"
   loop the brief opens with.
2. **Cross-tenant reuse** — a second, re-skinned variant of the target app, and one
   artifact running against both with a per-variant override. It is the most direct
   evidence for Section 3.7.
3. Multi-run stability, then confidence and approval gating.

## 2. Sequencing rationale

The riskiest assumption is that a compiled artifact replays reliably against a hostile
DOM. Phases 1, 2, and 4 attack exactly that, and Phase 4 closes with a hand-written
artifact replaying green — before a single token is spent on the model. Discovery then
becomes a producer for a proven consumer. Escalation comes after replay because it needs
a real paused run to hand over.

## 3. Risks and the response to each

| Risk | Response |
| --- | --- |
| The model produces steps that do not replay | Discovery emits only the closed action union, and the compiler replays the artifact once before saving it. |
| Target resolution is ambiguous on a table-based layout | The strategy ladder fails loudly on multiple candidates instead of picking the first. Phase 2 tests this. |
| Escalation slides into a hand-wave | Phase 8 has a concrete exit demo. If time runs short, the operator *page* is the cut, never the control-transfer mechanism. |
| Scope creep into infrastructure | The brief explicitly does not reward queues, clusters, or multi-tenant plumbing. Files on disk, one process. |
| Discovery run cost | One successful run is cheap. Develop the loop against a recorded fixture, and spend real tokens only on the demo run. |

## 4. Declared cuts (write these into `REPORT.md` section 7)

- Desktop surface: interface defined, implementation stubbed.
- Multi-tenant override resolution: schema fields present, resolver not built (unless
  the Phase 10 stretch lands).
- Operator console: a minimal local page, not a real-time co-browsing product.
- No queue, no database, no auth, no deployment.
- Assisted LLM recovery on replay failure: deliberately excluded, because it weakens the
  determinism guarantee that is the point of the system. Escalating to a human is the
  chosen answer instead.
