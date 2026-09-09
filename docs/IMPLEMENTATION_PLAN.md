# Implementation Plan — Computer-Use Automation System

Companion to `docs/REQUIREMENTS.md`. This plan gives the build order, the exact files to
write, the semantics that each component must obey, and the gate that closes each phase.

Read section 1 before you write code. It records what the repository already contains and
which defects block the first build. Sections 2 and 3 settle the semantics that the code
cannot invent later. Section 4 is the phase-by-phase build.

**Rules for this plan.**
- A phase closes on a runnable command, never on a feeling.
- Every phase names its files, its exported signatures, and its tests.
- If you change a decision, change it here first, then in the code.

---

## 0. How to read this plan

| Marker | Meaning |
| --- | --- |
| **DONE** | The repository already contains this. Verified on the current tree. |
| **FIX** | The repository contains this, but it is wrong or incomplete. Repair it before you build on it. |
| **NEW** | You write this from nothing. |

Time estimates assume focused work and no research detours. The total is about 30 hours.
The core thread — Phases 1 to 5 — is about 17 hours. Everything after Phase 5 protects the
score; everything before it creates the score.

---

## 1. Current state, verified against the tree

### 1.1 What exists and holds

| Path | State | Note |
| --- | --- | --- |
| `package.json`, `tsconfig.json`, `vitest.config.ts` | **DONE** | TypeScript strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`. |
| `src/config.ts` | **DONE** | One validated read of the environment. `requireApiKey()` keeps the key out of the replay path. |
| `src/surface/types.ts` | **DONE** | `Surface`, `Action`, `Condition`, `TargetDescriptor`, `Observation`. No DOM vocabulary. |
| `src/schema/capability.ts` | **DONE** | Zod artifact contract plus `lintCapability`. |
| `src/schema/emit.ts` | **DONE** | Emits JSON Schema with Zod 4's native `z.toJSONSchema`. |
| `src/replay/result.ts` | **DONE** | The four-status result union and `FailureCategory`. |
| `src/policy/types.ts`, `src/session/types.ts`, `src/evidence/types.ts` | **DONE** | Interfaces only. No implementation behind any of them. |
| `src/cli.ts` | **DONE** | Four verbs, each throwing "not implemented". |
| `tests/schema.test.ts` | **DONE** | Five schema and lint tests pass. |
| `capabilities/schema/capability-1.0.0.json` | **DONE** | Emitted from Zod. |
| `fixtures/app/` | **MISSING** | The directory does not exist. Phase 1 creates it. |

So Phase 0 is closed, the surface seam of Phase 2 is designed but not implemented, and the
Phase 3 schema is written but never proved against a real replay.

### 1.2 Defects that block the first build — fix these first (about 30 minutes)

These are verified, not suspected. Each one fails at a moment that costs more later.

1. **`npm run lint` fails now.** The script is
   `eslint src fixtures tests --ext .ts`. ESLint 9 flat config removed `--ext`, and
   `fixtures` does not exist. The observed error is
   `No files matching the pattern "fixtures" were found.`
   Fix: `eslint .` with `ignores` in `eslint.config.js`.
2. **`policy.yaml` has no parser.** `src/config.ts` names `policy.yaml`, but `package.json`
   declares no YAML dependency. Decide now: add `yaml@^2` as a dependency. Keep YAML,
   because the policy file is the one file a reviewer reads as prose, and it needs comments.
3. **`zod-to-json-schema` is dead weight.** `src/schema/emit.ts` uses Zod 4's built-in
   `z.toJSONSchema`. Remove the dependency so the reviewer does not ask which one is live.
4. **Playwright browsers are not installed by `npm install`.** Add
   `"postinstall": "playwright install chromium"` or document the command in the README.
   A reviewer who cannot start the demo scores nothing else.
5. **`exactOptionalPropertyTypes: true` rejects `{ foo: undefined }`.** Every optional field
   in `Observation`, `Handle`, and `Intervention` must be omitted, not set to `undefined`.
   Write a helper `omitUndefined<T>(o: T): T` in `src/util/object.ts` and use it at every
   place where you build an object from optional parts.

### 1.3 Schema defects to repair in Phase 3

The schema in `src/schema/capability.ts` is good but incomplete. It does not yet express
three things that the replay engine needs, and it permits two artifacts that cannot run.

| Problem | Repair |
| --- | --- |
| `Step.postcondition` is optional, but per-step verification is the stated design point. An artifact with no postconditions replays blind. | Keep the field optional in the type, and add a lint rule: every step whose action changes state (`click`, `type`, `select`, `press`, `navigate`) must declare a postcondition. Discovery must satisfy the rule, not bypass it. |
| `valueRef` binds an input into "the action's value slot", but `ActionSchema` still requires `text` on a `type` action. Nothing states which wins. | Add a lint rule: a step with `valueRef` must use a `type` or `select` action, and the recorded literal must be the empty string. Replay substitutes the input value. Record the rule in `REPORT.md`. |
| `OutputSpec.type` allows `number` and `boolean`, but `extract` returns a string. Coercion is undefined. | Define one coercer in `src/replay/coerce.ts`. A failed coercion is a typed failure, not a crash. Add `outputCoercionFailed` to `FailureCategory`. |
| A hard runtime condition, such as an expired session, has nowhere to live. It is not a business outcome and not recoverable. Today it can only surface as a vague postcondition failure. | Add `hazards: HazardSpec[]` to the schema. See section 2.3. This is the single most valuable schema change in the plan. |
| `onFailure` in the prose said `branch`, the code says `retry \| escalate \| fail`. | Keep the code. Delete `branch` from the design. Record it as a cut. |
| `ParamSpec.pattern` is declared and never enforced. | Compile it in the input validator in Phase 4. |
| `ParamSpec.example` can leak a real value for a sensitive parameter. | Lint rule: a sensitive parameter must not carry an `example`. |

---

## 2. Semantics that must be settled before any code

These five decisions determine whether the system is defensible. Write them into
`REPORT.md` in the same words.

### 2.1 Target resolution — the strategy ladder

`Surface.resolve(target)` walks `target.strategies` in order and stops at the first
strategy that produces exactly one candidate.

```
for (index, strategy) in strategies:
    candidates = matchAll(strategy)
    if candidates.length == 0: continue          # try the next strategy
    if candidates.length == 1: return resolved(candidate, index)
    return ambiguous(index, candidates.length)   # STOP. Never fall through.
return notFound(strategies.length)
```

**Ambiguity stops the run. It does not fall through to the next strategy.** Two candidates
under a strategy means the artifact describes the control imprecisely. Falling through
would silently pick a different control on a different day. That is exactly the failure
this system exists to prevent.

Replay records `strategyIndex` on every resolution. An index above 1 emits a
`target.degraded` event, so the evidence shows an artifact leaning on its fragile
fallbacks before it breaks.

### 2.2 The wait model — no sleeps anywhere

Three primitives, all bounded by a deadline:

- `waitForCondition(condition, timeoutMs)` — polls every 100 ms until the condition holds
  or the deadline passes.
- `settle(timeoutMs)` — after any action that can navigate, waits for the document `load`
  state, then waits until two accessibility snapshots taken 150 ms apart are equal. This
  absorbs the `slow` fault injector without a fixed sleep.
- `waitForNavigation(timeoutMs)` — used only by the `navigate` action.

Grep for `setTimeout` in a review. A bare sleep in the execution path is a defect.

### 2.3 Check ordering after every step — the precedence rule

This ordering is the error model. Get it wrong and every result status is wrong.

```
 1. broker.assertControl('automation')     -> defect if not held
 2. policy.check(action, {mode, url})      -> block  => failed(policyBlocked)
 3. wait for each precondition             -> unmet  => failed(checkpointFailed)
 4. resolve target through the ladder      -> per 2.1
 5. act
 6. settle
 7. detect outcomes  (business)            -> hit    => business_outcome, STOP CLEANLY
 8. detect hazards   (hard)                -> hit    => escalate or failed, per the spec
 9. detect recoveries(recoverable)         -> hit    => run recovery actions, then re-check
10. verify the postcondition               -> unmet  => apply step.onFailure
11. record evidence at every numbered line
```

**Why outcomes come first.** "No member matches that number" is an answer the caller needs.
If the postcondition check ran first, that answer would arrive as `checkpointFailed`, and
the caller would retry a query that will never succeed. Business outcomes outrank every
error path.

**Why hazards come second.** An expired session invalidates the meaning of every later
check. Detecting it before the recovery pass stops the engine from retrying against a
dead session.

**Why recoveries come third.** A known interstitial is noise between the action and the
postcondition. Clear it, then judge the step on its real result. Each recovery attempt is
bounded by `maxAttempts` and logged as a `recovery.applied` event.

Add to `src/schema/capability.ts`:

```ts
export const HazardSpecSchema = z.object({
  name: z.string(),                  // 'sessionExpired'
  description: z.string(),
  when: ConditionSchema,             // 'textPresent: Your session has expired'
  category: z.enum(['sessionExpired', 'surfaceError', 'policyBlocked']),
  handling: z.enum(['escalate', 'fail']).default('escalate'),
});
```

### 2.4 Redaction — one boundary, not many

`EvidenceRecorder.log`, `saveSnapshot`, and `finish` all pass every string through
`policy.redact` before a byte reaches the disk. No caller redacts by hand.

The recorder holds a secret registry. Before a run starts, the engine calls
`recorder.registerSecret(value)` for every input whose `ParamSpec.sensitive` is true.
`redact` then replaces exact registry matches and every configured regex with
`[REDACTED:<name>]`.

This ordering is what makes the safety test cheap to write: pass a sensitive input, replay,
then grep the whole run directory and the artifact for the literal value.

### 2.5 Control — one flag, asserted at the act boundary

`SessionBroker.controller()` returns `automation | human | none`. Both the discovery loop
and the replay engine call `assertControl('automation')` before every `act`. A call made
without control throws immediately and is logged as `control.violation`. Nobody polls the
flag; the assertion is the mechanism.

---

## 3. Decisions taken up front

| Decision | Choice | Why |
| --- | --- | --- |
| Language and runtime | TypeScript on Node 20+ | Playwright is first-class, and the reviewer reads the types as the design. |
| Schema | Zod, with JSON Schema emitted from it | One source of truth, runtime validation, and a machine-readable contract for a calling agent. |
| Perception | Accessibility tree first, screenshot second. Never a DOM dump. | The brief asks for an approach that survives a dirty DOM. A desktop accessibility API produces the same shape, so the seam stays honest. |
| Driver | Playwright, launched headed with a remote debugging port | The debugging port is what makes the human handoff run on the same session. |
| Model | `claude-opus-5`, tool-calling over the closed action union | The action tools are the same union the replay engine executes, so discovery cannot emit an unreplayable step. |
| Target app | A local, intentionally hostile "credit union back office" | No terms-of-service risk, no rate limits, no real data, and full control of the fault injectors that Section 3.3 of the brief demands. This is the highest-leverage choice in the project. |
| Storage | JSON files under `capabilities/`, run output under `evidence/<runId>/` | The brief rewards no infrastructure. A database adds nothing. |
| Process model | One CLI process. The operator server runs inside the replay process. | The operator needs the live broker. A separate process would need shared session state, which is infrastructure the brief does not reward. |
| Policy file | `policy.yaml`, parsed with `yaml@^2` | A reviewer reads this file as prose. It needs comments. |

**Model of the whole system.** A `Surface` sits under both the discovery agent and the
replay engine. Discovery writes a `Capability`. Replay reads it. Both pass every action
through one `PolicyEngine` and write to one `EvidenceRecorder`. A `SessionBroker` owns the
live browser and answers who is driving.

```
        record                                     replay
          |                                          |
   DiscoveryLoop ---.                     .--- ReplayEngine
          |          \                   /           |
      Compiler        +--> PolicyEngine <+           |
          |          /                   \           |
     Capability <---'                     '--> EvidenceRecorder
          |                                          |
          '------------> SessionBroker <-------------'
                              |
                           Surface  (PlaywrightSurface | DesktopSurface stub)
```

---

## 4. The build

### Phase 0 — Foundation (**DONE**, plus 30 minutes of repair)

Apply every fix in section 1.2.

- **Gate:** `npm run typecheck && npm test && npm run lint` all pass, and
  `npx playwright install chromium` is documented in the README.

---

### Phase 1 — The hostile target application (about 3 hours) — **NEW**

Build this first. Everything downstream is only as interesting as this surface.

**Files**

```
fixtures/app/server.ts        Express app, session cookie, fault middleware
fixtures/app/data.ts          seeded members and accounts
fixtures/app/render.ts        HTML helpers that emit the legacy shape
fixtures/app/pages/*.ts       one function per screen
```

**The legacy shape — make each of these deliberate, and defend each one**

- A frameset: a `nav` frame and a `main` frame. This forces `framePath` through the whole
  perception layer instead of leaving it as an unused field.
- Layout by nested tables, not by CSS.
- No `data-testid`, no stable `id`.
- Class names hashed per process boot, for example `c-a3f9`. A selector-based recorder
  breaks between runs. The accessibility ladder does not.
- Labels not associated with inputs: `<td>Member Number</td><td><input name=q></td>`.
  This is what forces strategy 2, `labelAnchor`, to carry real weight.
- One control with a genuine accessible name, so strategy 1 is proved as well.

**The flow: search → detail → action → confirmation**

| Route | Screen |
| --- | --- |
| `GET /` | Login. Any user, password `demo`. Sets the session cookie. |
| `GET /search` | Frameset. Member search form in the `main` frame. |
| `POST /search` | Redirects to the detail page, or renders the not-found banner. |
| `GET /member/:id` | Member detail. Sub-account rows in a nested table. |
| `GET /member/:id/account/:acct` | Account detail. Balance. Two action buttons. |
| `POST /member/:id/account/:acct/hold` | Guarded write. Reversible. Shows a confirmation interstitial. |
| `POST /member/:id/account/:acct/transfer` | Irreversible. The policy engine must block it. |
| `GET /confirm` | The one-off interstitial with a **Continue** button. |
| `POST /_reset` | Clears all injected faults for the session. |

**Seed data**

| Member | Purpose |
| --- | --- |
| `100001` | The happy path. Savings balance `$4,182.55`. |
| `100002` | Triggers the inline validation error on the hold form. |
| `100003` | Always shows the interstitial before the detail page. |
| `999999` | Does not exist. Drives the business outcome. |

Use obviously fake names and balances. Say so in the README.

**Fault injection — make it sticky**

A query parameter alone dies on the next navigation, so the whole point is lost. Inject on
the query parameter, then persist it in a session cookie until `POST /_reset`.

```
GET /search?fault=sessionExpired   ->  Set-Cookie: cuas_fault=sessionExpired
```

| Fault | Behavior | Expected replay result |
| --- | --- | --- |
| `notFound` | Search returns the "No member matches that number." banner. | `business_outcome` |
| `validation` | The hold form returns an inline field error. | `business_outcome` or `failed`, and the artifact decides which. State the choice. |
| `interstitial` | `/confirm` appears once before the detail page. | `success`, with a `recovery.applied` event in the evidence. |
| `slow` | A 4 second delay before the detail page renders. | `success`, absorbed by `settle`. |
| `sessionExpired` | The next request redirects to `/` with "Your session has expired". | `escalated` |
| `serverError` | A 500 with a stack-free error page. | `failed`, category `surfaceError` |

**Tests** — `tests/fixture-app.test.ts`: start the server on an ephemeral port, then drive
each route with `fetch`. Assert that each fault fires and that `POST /_reset` clears it.

- **Gate:** `npm run app`, then walk the full flow by hand in a browser, and fire each of
  the six injectors from the URL bar.

---

### Phase 2 — The Playwright surface (about 3 hours) — types **DONE**, code **NEW**

**Files**

```
src/surface/playwright.ts     PlaywrightSurface implements Surface
src/surface/resolve.ts        the strategy ladder, one function per strategy
src/surface/observe.ts        accessibility snapshot -> PerceivedElement[]
src/surface/wait.ts           waitForCondition, settle, waitForNavigation
src/surface/desktop.ts        DesktopSurface stub, same interface, documented cut
```

**Signatures**

```ts
export interface PlaywrightSurfaceOptions {
  headed: boolean;
  cdpPort?: number;          // set for the handoff; omitted for tests
  viewport?: { width: number; height: number };
}
export function createPlaywrightSurface(o: PlaywrightSurfaceOptions): Promise<PlaywrightSurface>;
```

**Perception.** Walk every frame. **Decision changed during Phase 2:** the plan first called
for `page.accessibility.snapshot({ interestingOnly: false })`. That snapshot carries neither a
frame path nor a bounding box, and `labelAnchor` is decided by geometry. So each frame is walked
in the page and every node is normalized to the same role/name/value shape an accessibility API
reports, plus a box. The DOM stays inside `src/surface/`. Flatten the result to
`PerceivedElement[]`, and stamp `framePath` on every node. Assign each node a stable `ref`
of the form `f0/n17`, and stamp it on the node as `data-cuas-ref`, so a `ref` turns back into an
actionable locator without a selector. Attach the bounding box only for nodes that a coordinate fallback
could need, because boxes make the observation large and the model does not need them.

**Resolution.** One matcher per strategy, all operating on the flattened observation, not
on the DOM:

| Strategy | Matcher |
| --- | --- |
| `roleName` | Role equals, and the accessible name equals or contains. |
| `labelAnchor` | Find the node whose text equals `anchorText`, then take the nearest node in `direction` by bounding-box geometry, filtered by `role` when given. |
| `structural` | Resolve `framePath`, then apply the recorded path within that frame. |
| `text` | Visible text equals or contains. |
| `coordinates` | The node whose box contains the point. Always emits a `target.fragile` event. |

`labelAnchor` is the one that makes the legacy layout work. Give it real geometry: for
`right`, take candidates whose box vertically overlaps the anchor by more than half the
anchor's height and whose left edge sits right of the anchor's right edge, then take the
nearest one. Do not settle for "the next node in document order"; a nested table breaks
that immediately.

**Tests** — `tests/surface-resolve.test.ts`, against the live Phase 1 app:

1. Every control on every screen resolves through strategy 1 or strategy 2.
2. A deliberately ambiguous descriptor, such as `text: "View"` on a list with several rows,
   returns `ambiguous` and does **not** fall through.
3. A descriptor that matches nothing returns `notFound` with the number of strategies tried.
4. Resolution still works after a server restart changes every hashed class name. This is
   the test that proves the robustness claim.

- **Gate:** those four tests pass headless.

---

### Phase 3 — Close the artifact schema (about 2 hours) — mostly **DONE**, some **FIX**

Apply every repair in section 1.3, then add:

```ts
export function validateInputs(
  cap: Capability,
  raw: Record<string, string>
): { ok: true; values: Record<string, string|number|boolean> }
 | { ok: false; problems: string[] };
```

It checks required parameters, coerces by declared type, and compiles `ParamSpec.pattern`.
It runs **before the browser starts**. A bad member id must never open a browser window.

Extend `lintCapability` with the new rules:

- a state-changing step declares a postcondition,
- a `valueRef` step uses `type` or `select` and records an empty literal,
- a sensitive parameter carries no `example`,
- every `OutcomeSpec.detect` and `HazardSpec.when` condition is reachable, meaning its
  target descriptor is non-empty,
- `successCheckpoint` is present and is not `textPresent: ""`.

Write `capabilities/member-savings-balance.v1.json` **by hand**. This is the artifact that
Phase 4 replays. Writing it by hand forces you to find every field the schema is missing
before the model produces one.

- **Gate:** `npm run schema:emit` is clean, the hand-written artifact parses, and
  `lintCapability` returns an empty list.

---

### Phase 4 — The deterministic replay engine (about 5 hours) — **NEW**

Build replay **before** discovery. If replay executes a hand-written artifact, then
discovery only has to produce one, and you never debug the model and the executor at the
same time. This phase is the moment the project becomes defensible.

**Files**

```
src/replay/engine.ts        the step loop
src/replay/detect.ts        outcome, hazard, and recovery detection
src/replay/coerce.ts        string -> declared output type
src/replay/bind.ts          valueRef -> action value substitution
src/policy/engine.ts        the one choke point
src/policy/load.ts          policy.yaml -> PolicyConfig
src/evidence/recorder.ts    FileEvidenceRecorder
src/util/runid.ts           sortable run ids: 20260908T2251-a3f9
policy.yaml                 the checked-in default policy
```

**Signature**

```ts
export interface ReplayOptions {
  capability: Capability;
  inputs: Record<string, string>;
  surface: Surface;
  policy: PolicyEngine;
  recorder: EvidenceRecorder;
  broker?: SessionBroker;      // absent means escalation degrades to failed
  fault?: string;              // test hook for the fixture app
}
export function replay(o: ReplayOptions): Promise<ReplayResult>;
```

**The loop** is section 2.3, executed literally, in that order.

**Retry.** `step.onFailure === 'retry'` retries up to `step.maxRetries`, with a 250 ms,
500 ms, 1000 ms backoff, and only for `targetNotFound` and `checkpointFailed`. Never retry
`policyBlocked`, `targetAmbiguous`, or `invalidInput`; those are defects, and a retry only
hides them.

**Policy engine.**

```yaml
# policy.yaml
allowedOrigins: ["http://localhost:4173"]
allowedRoutes: ["/", "/search", "/member/*", "/confirm", "/_reset"]
allowedActions: [navigate, click, type, select, press, waitFor, extract, assert]
riskRules:
  - { match: "Transfer",  risk: irreversible, reason: "Moves money. No undo." }
  - { match: "Delete",    risk: irreversible, reason: "Destroys a record." }
  - { match: "Place Hold", risk: guarded,     reason: "A person can release a hold." }
handling:
  safe: allow
  guarded: allow          # in replay; discovery confirms instead
  irreversible: block
redactPatterns:
  - { name: "ssn",   pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b" }
  - { name: "pan",   pattern: "\\b\\d{13,19}\\b" }
  - { name: "email", pattern: "[\\w.+-]+@[\\w-]+\\.[\\w.]+" }
```

Fail closed on three axes: an origin outside the allowlist is blocked, an action type
outside `allowedActions` is blocked, and a control that matches no risk rule but submits a
form is treated as `guarded`, never as `safe`. State the reason in `REPORT.md`: in
regulated finance, the cost of one wrong irreversible action far exceeds the cost of a
human confirmation.

**Evidence recorder.** Appends one JSON object per line to `events.jsonl`. Fixed event
names, so the log is greppable:

```
run.start  run.finish
step.start step.ok step.failed
target.resolved target.degraded target.fragile target.ambiguous target.notFound
policy.allow policy.confirm policy.block
outcome.detected hazard.detected recovery.applied
handoff.requested handoff.granted handoff.human_action handoff.reclaimed
control.violation
```

**Tests** — `tests/replay.test.ts`, all against the live fixture app, no model:

| Test | Expected |
| --- | --- |
| Happy path, member `100001` | `success`, `savingsBalance` equals the seeded value |
| Member `999999` | `business_outcome`, name `memberNotFound` |
| `fault=interstitial` | `success`, and `recovery.applied` appears in `events.jsonl` |
| `fault=slow` | `success`, with no `setTimeout` in the engine |
| `fault=sessionExpired` | `escalated`, or `failed(sessionExpired)` with no broker |
| `fault=serverError` | `failed`, category `surfaceError`, with the step id named |
| Bad input `memberId=abc` against `pattern` | `failed(invalidInput)`, and **the browser never launches** |
| An artifact naming a control that no longer exists | `failed(targetNotFound)`, naming the step and the strategies tried |
| A `Transfer Funds` step | `failed(policyBlocked)` |
| Three consecutive happy-path replays | Identical outputs. This is the determinism check. |

- **Gate:** the whole table is green. Commit the evidence directory from the happy path and
  the not-found path now, not at the end.

---

### Phase 5 — The discovery loop (about 4 hours) — **NEW**

**Files**

```
src/discovery/loop.ts       observe -> model -> policy -> act
src/discovery/tools.ts      the Action union as Anthropic tool definitions
src/discovery/prompt.ts     the system prompt
src/discovery/render.ts     Observation -> compact text for the model
src/discovery/compile.ts    trace -> Capability
```

**Tools.** Generate the tool JSON Schemas from the Zod action schemas, so the model's
vocabulary and the executor's vocabulary cannot drift. Every action tool also takes:

- `intent` — why this step exists, in an operator's words,
- `target.strategies` — an **ordered** list, most robust first,
- `expectAfter` — the condition the model believes will hold after the action. This becomes
  the step postcondition. Asking the model to predict the result before it acts is what
  turns a click recording into a verifiable artifact.

Two extra tools:

- `note_outcome(name, description, detect)` — the model saw a business outcome such as a
  not-found banner.
- `finish(summary, outputs[], successCheckpoint)` — ends the run.

**Observation rendering.** Send a compact indented text tree, one line per element:
`[f0/n17] textbox "Member Number" value="" enabled`. Send the screenshot only every third
turn, or when the previous action failed. Screenshots dominate the token cost and the
accessibility tree carries most of the signal.

**Stopping conditions.** Maximum steps (default 30), a wall-clock timeout (default 5
minutes), three consecutive turns with no observation change, any policy block, and a
model `finish` call.

**Compilation — where the artifact is earned.**

1. Drop failed and no-op actions from the trace.
2. Generalize the literals. The caller supplies hints: `--param memberId=100001`. Replace
   exact occurrences of `100001` in `type` and `select` values with `valueRef: memberId`,
   and in any `urlMatches` pattern with `:memberId`. Deterministic substitution only. Do
   not let the model guess which literals are parameters.
3. Attach `expectAfter` to each step as its postcondition.
4. Copy the noted outcomes into `outcomes`, and attach the standard hazard set.
5. Parse against `CapabilitySchema`, then run `lintCapability`. A lint failure aborts the
   save with the problems printed.
6. **Replay the compiled artifact once, immediately, with the same inputs.** An artifact
   that has never replayed is never saved with `status: 'approved'`. If the verification
   replay does not return `success`, save it as `draft` and print why.

**Cost control.** Record the observation and model messages of a real run to
`tests/fixtures/discovery-trace.json`, then develop the compiler against that recording.
Spend real tokens only on the demo run.

- **Gate:** one real run against the local app produces
  `capabilities/member-savings-balance.v1.json` and a full trace under `evidence/<runId>/`,
  and the verification replay returns `success`.

---

### Phase 6 — Safety hardening (about 1.5 hours) — **NEW**

The policy engine already exists from Phase 4. This phase proves it.

- Discovery calls `policy.check` on the same path replay uses. Verify there is exactly one
  call site per mode, and that no code path reaches `surface.act` around it.
- Add the sensitive-value registry to the recorder, per section 2.4.
- Add `npm run policy:explain`, which prints how the current policy classifies each control
  found on the fixture app. A reviewer can read it in ten seconds.

**Tests** — `tests/policy.test.ts`:

1. Navigation to `https://example.com` is blocked in both modes.
2. `Transfer Funds` is blocked and escalated, and the reason names the risk rule.
3. `Place Hold` is allowed in replay and confirmed in discovery.
4. An action type absent from `allowedActions` is blocked.
5. A sensitive input never appears in `events.jsonl`, in any snapshot, in the artifact, or
   in `result.json`. Assert this by grepping the whole run directory for the literal value.

- **Gate:** all five pass.

---

### Phase 7 — Evidence (about 1 hour) — **NEW**

```
evidence/<runId>/
  events.jsonl        structured, timestamped, redacted, one line per event
  screenshots/        NNN-<event>.png
  ax/                 NNN-<event>.json, the accessibility snapshot
  result.json         the ReplayResult, or the discovery summary
  capability.json     a copy of the artifact that ran, for reproduction
  trace.zip           the Playwright trace, on failure only
  interventions/      one JSON file per intervention
```

Every event carries `runId`, `actor`, `event`, and a reason. Capture a screenshot and an
accessibility snapshot on every step boundary and on every failure.

- **Gate:** hand `events.jsonl` alone to someone who has not seen the code, and they can
  say what happened and why it stopped.

---

### Phase 8 — Escalation and handoff (about 4 hours) — **NEW**

This is the requirement most submissions leave as a TODO. Make it real.

**Files**

```
src/session/broker.ts       PlaywrightSessionBroker
src/session/operator.ts     the Express operator surface
src/session/watch.ts        records the human's actions into the evidence stream
```

**Launch for handoff.** Launch Chromium headed with
`--remote-debugging-port=${config.cdpPort}`. The operator attaches to the **same page
target**, which is the whole point:

```
GET http://localhost:9222/json/list      -> find the page target id
attachUrl = http://localhost:9222/devtools/inspector.html?ws=localhost:9222/devtools/page/<id>
```

State the honest limit in `REPORT.md`: the DevTools front end is a developer tool, not an
operator console. The mechanism — one browser context, one page target, control transferred
by flag, both parties driving the same session — is real. The console is the mock. That is
the split the brief allows.

**The escalation sequence**

```
engine hits a hazard or an escalate-class failure
  -> recorder.saveScreenshot + saveSnapshot          (context for the human)
  -> broker.escalate({runId, capabilityId, stepId, reason, paths})
  -> write evidence/<runId>/interventions/<id>.json
  -> controller = 'human'; the engine's step loop awaits resolution
  -> log handoff.requested
```

**While the human holds control**, keep recording. Add a `page.addInitScript` that attaches
`click`, `input`, and `submit` listeners which write a prefixed line to the console. The
broker reads those through the CDP console event and logs each as
`handoff.human_action` with `actor: 'human'`. Redact input values through the same
recorder boundary. The human's work is part of the record, not a gap in it.

**Hand-back is the subtle part.** The human may have left the session anywhere. On
`reclaim`:

1. Set `controller = 'automation'`.
2. Re-observe.
3. If the **current** step's postcondition already holds, the human completed the step.
   Log `handoff.reclaimed` with `resumeMode: 'skip'` and continue at the next step.
4. Else if the **previous** step's postcondition holds, the session is where the engine
   left it. Log `resumeMode: 'retry'` and re-run the current step.
5. Else the session is somewhere unexpected. Do not guess. Return
   `failed(checkpointFailed)` and name what was observed.

Resuming without this check is the defect that makes a handoff demo look real and behave
randomly.

**Operator surface** — Express on `config.operatorPort`, served from inside the replay
process so it holds the live broker:

| Route | Purpose |
| --- | --- |
| `GET /` | Open interventions, with the reason and the step. |
| `GET /interventions/:id` | Full context: capability, step, reason, screenshot, attach link. |
| `POST /interventions/:id/take` | Grants control. Returns `attachUrl`. |
| `POST /interventions/:id/handback` | Takes a free-text note, then reclaims. |
| `GET /interventions/:id/screenshot` | The captured PNG. |

Server-rendered HTML, no build step, no client framework. It is a documented mock.

**Gate — the demo, recorded as a GIF:**

`replay --fault sessionExpired` escalates, the operator page shows the intervention, a
human takes control, logs back in through the same browser window, hands control back with
a note, and the replay completes and returns `success`. `events.jsonl` shows the whole
sequence, including the human's actions tagged `actor: human`.

---

### Phase 9 — Write-up and deliverables (about 3 hours)

**`/README.md`** — setup including `npx playwright install chromium`, the `.env` keys, how
to start the fixture app, and the five demo commands below. Every command must run from a
clean clone with no undocumented step.

**`/REPORT.md`** — the seven required headings, in the brief's order, no substitutions.
Map each heading to the thing that earns the score:

| Heading | The one thing it must say |
| --- | --- |
| 1. Architecture | The `Surface` seam, and why the same interface holds for a desktop accessibility API. |
| 2. Artifact schema | Inputs and outputs make the artifact a typed callable contract, not a macro. `intent` makes it reviewable. Per-step postconditions turn a silent wrong-page failure into a precise error. |
| 3. Determinism and error handling | The precedence rule in section 2.3, and why outcomes outrank errors. |
| 4. Heterogeneity and multi-tenant | `app.variant`, parameterized routes, and the override layer that is designed but not built. |
| 5. Escalation and handoff | One page target, control by flag, re-verification on hand-back. Name the console as the mock. |
| 6. Safety | Fail-closed, one choke point, redaction at the recorder boundary. |
| 7. Cuts | Section 6 of this plan, verbatim. |

**`/evidence/`** — commit four runs: discovery, a clean replay, a not-found replay, and the
escalation run.

- **Gate:** a clean clone runs every demo command with no undocumented step.

---

### Phase 10 — Stretch, only if the core is solid

Pick at most one. Ranked by how much each strengthens the main story.

1. **Capability catalog.** `cuas catalog --json` emits every artifact as a tool definition
   with typed arguments, plus one shown invocation. It closes the "an agent invokes this in
   production" loop the brief opens with. About 1 hour, and it is the cheapest of the three.
2. **Cross-tenant reuse.** A second, re-skinned variant of the fixture app, and one artifact
   running against both through a per-variant override file. It is the most direct evidence
   for Section 3.7. About 3 hours.
3. **Multi-run stability.** Replay N times and report a flakiness rate. About 1 hour, and it
   is worth doing only if the replay tests already run clean.

---

## 5. Failure-mode trace

Walk every component from entry to exit. A `catch` block is not an answer; what the caller
does with the fallback value is the answer.

| Component | The failure | What the caller sees | Requirement |
| --- | --- | --- | --- |
| `validateInputs` | A required parameter is missing | `failed(invalidInput)` before any browser starts | Never launch a browser to discover a typo. |
| `resolve` | Two candidates match | `failed(targetAmbiguous)`, naming the strategy index and the count | Never pick the first. |
| `resolve` | No strategy matches | `failed(targetNotFound)`, naming every strategy tried | The message must be enough to repair the artifact. |
| `settle` | The page never stops changing | The deadline fires; the step fails with the observed state | A bounded wait, never an unbounded one. |
| `detect` | Both an outcome and a hazard hold | The outcome wins, per section 2.3 | The precedence rule is code, not convention. |
| `coerce` | `extract` returns `"$4,182.55"` for a `number` output | `failed(outputCoercionFailed)`, naming the raw value | Never return `NaN` to a caller. |
| `PolicyEngine` | `policy.yaml` is missing or malformed | The process refuses to start | A missing policy must never mean "allow everything". |
| `EvidenceRecorder` | The disk write fails | Log to stderr and continue the run | Losing evidence must not lose the run, but it must be visible. |
| `SessionBroker` | The human never hands control back | The engine returns `escalated` with the intervention id after a timeout | An `escalated` result is terminal and resumable, not a hang. |
| `SessionBroker` | The human closes the browser window | `failed(surfaceError)`, naming the closed session | Never resume against a dead target. |
| Discovery | The model calls `finish` on the wrong page | The verification replay fails, and the artifact saves as `draft` | An unverified artifact is never approved. |
| Discovery | `ANTHROPIC_API_KEY` is absent | `record` fails with the copy-`.env` message; `replay` is unaffected | The production path must not depend on model access. |
| CLI | `--fault` is passed to `record` | Reject it. Faults are for replay tests | A discovery run against an injected fault records a broken flow. |

---

## 6. Declared cuts — copy these into `REPORT.md` section 7

- **Desktop surface.** The interface is defined and a stub implements it. No real desktop
  automation. The seam is the deliverable.
- **Multi-tenant override resolution.** The schema carries `app.variant` and `tenantId`.
  The resolver that merges a base artifact with a per-variant override is not built, unless
  the Phase 10 stretch lands.
- **Operator console.** A local server-rendered page plus the DevTools attach URL. Not a
  real-time co-browsing product.
- **`onFailure: 'branch'`.** Considered and dropped. Branching turns the artifact into a
  program, and a program needs a debugger. Business outcomes cover the real branch.
- **Assisted LLM recovery on replay failure.** Deliberately excluded. It weakens the
  determinism guarantee that is the point of the system. Escalating to a human is the
  chosen answer.
- **No queue, no database, no authentication, no deployment.** The brief rewards none of it.

---

## 7. Cut ladder — drop in this order if time runs short

Do not improvise this list under pressure. Decide now.

1. Phase 10 entirely.
2. The `trace.zip` capture on failure. The screenshot and the accessibility snapshot carry
   the signal.
3. The `validation` fault injector. Five injectors still prove all four result classes.
4. The operator page's styling. Plain HTML is acceptable.
5. The `structural` and `coordinates` resolution strategies. Ship the ladder with three
   rungs, and document why the last two are stubs.

**Never cut, in any circumstance:** the control-transfer mechanism, the four-status result
union, the one policy choke point, the redaction test, and the real discovery run. Each one
maps directly to a scored requirement.

---

## 8. Definition of done

```
[ ] npm install && npx playwright install chromium && npm test   passes on a clean clone
[ ] npm run lint && npm run typecheck                            clean
[ ] npm run app                                                  serves the fixture app
[ ] cuas record ...                                              a real model run, evidence committed
[ ] cuas replay ... -i memberId=100001                           success, with the balance returned
[ ] cuas replay ... -i memberId=999999                           business_outcome, not an error
[ ] cuas replay ... --fault serverError                          failed, with the step named
[ ] cuas replay ... --fault sessionExpired                       escalated, then completed after handoff
[ ] cuas catalog                                                 lists artifacts as typed contracts
[ ] evidence/ holds four committed runs
[ ] REPORT.md carries the seven headings, in order
[ ] Every sensitive value is absent from every file in evidence/ and capabilities/
```

---

## 9. The demo path, exactly

```bash
npm install && npx playwright install chromium
cp .env.example .env                       # add ANTHROPIC_API_KEY
npm run app &                              # http://localhost:4173

# 1. Discovery. One real model run.
npm run cli -- record \
  --goal "Look up member 100001 and read their savings balance" \
  --param memberId=100001 \
  --out capabilities/member-savings-balance.v1.json

# 2. Deterministic replay. No model in the decision loop.
npm run cli -- replay -c capabilities/member-savings-balance.v1.json -i memberId=100001

# 3. A business outcome, not an error.
npm run cli -- replay -c capabilities/member-savings-balance.v1.json -i memberId=999999

# 4. A hard failure with a debuggable message.
npm run cli -- replay -c capabilities/member-savings-balance.v1.json -i memberId=100001 --fault serverError

# 5. Escalation, human takeover on the same session, and completion.
npm run cli -- replay -c capabilities/member-savings-balance.v1.json -i memberId=100001 \
  --fault sessionExpired --operator
# then open http://localhost:4174
```

---

## 10. Risks and the response to each

| Risk | Response |
| --- | --- |
| The model emits steps that do not replay | Discovery speaks only the closed action union, and the compiler replays the artifact once before it saves it as approved. |
| Resolution is ambiguous on a table layout | The ladder stops on ambiguity instead of guessing. Phase 2 tests it directly. |
| `labelAnchor` geometry is harder than it looks | Budget the time in Phase 2, and test it against the nested-table screen first, not last. |
| Escalation slides into a hand-wave | Phase 8 closes on a recorded demo. If time runs short, the operator page is the cut, never the control-transfer mechanism. |
| Scope creep into infrastructure | Files on disk, one process. The brief rewards no queues and no clusters. |
| Discovery cost | Develop the compiler against a recorded trace. Spend real tokens only on the demo run. |
| The handoff demo is not reproducible | Record it as a GIF and commit it under `evidence/`. A reviewer who cannot reproduce it still sees it. |
