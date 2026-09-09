# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

An LLM discovers how to complete a task by driving a real application UI. The system records
that run as a typed capability artifact. The artifact then replays deterministically, with no
model in the decision loop.

This is a take-home assignment. `docs/REQUIREMENTS.md` states what the graders score.
`docs/IMPLEMENTATION_PLAN.md` states the build order, the exact files, and the gate that closes
each phase. **Read the plan before you write code, and change the plan first if you change a
decision.**

## Commands

```bash
npm run typecheck                 # tsc --noEmit, strict
npm test                          # vitest run
npx vitest run tests/schema.test.ts          # one test file
npx vitest run -t 'lint rejects'             # one test by name
npm run lint                      # eslint
npm run schema:emit               # regenerate capabilities/schema/capability-<version>.json from Zod
npm run app                       # start the local target application (fixtures/app)
npm run cli -- <verb>             # record | replay | catalog | operator
```

`npm run lint` fails on the current tree. The script passes `--ext .ts`, which ESLint 9 flat
config removed, and it names `fixtures`, which does not exist yet. Change the script to
`eslint .` — `eslint.config.js` already carries the `ignores` list.

Vitest uses a 30 second `testTimeout`, because browser-backed tests start a real server and a
real browser.

## Architecture

Data flows in one direction: **Surface → discovery → artifact → replay → result**. Each arrow is
a typed contract, and each contract lives in exactly one file.

### The surface seam (`src/surface/types.ts`)

`Surface` is the only way anything perceives or acts on an application. Nothing above this file
may mention the DOM, CSS, or Playwright. `PlaywrightSurface` is one implementation; a desktop
accessibility API is another. This seam is the answer to the heterogeneity requirement, so
protect it — a Playwright type that leaks into `src/discovery/` or `src/replay/` is a defect.

`Action` and `Condition` are closed unions here. The discovery agent's tool set and the replay
executor both derive from them, so **the model cannot invent a step that replay is unable to
run.** Add a new capability by extending these unions and both sides at once, never by
special-casing one side.

### Target resolution is a ladder, not a selector

`TargetDescriptor.strategies` is an ordered list, most robust first: `roleName`, `labelAnchor`,
`structural`, `text`, then `coordinates` as the last resort. `resolve()` returns which strategy
index won, so evidence shows when an artifact degrades toward its fragile fallbacks.
`ResolveResult` has an explicit `ambiguous` status. Never guess between candidates — ambiguity
is a defect in the artifact.

### The capability artifact (`src/schema/capability.ts`)

Zod is the single source of truth. `npm run schema:emit` derives the JSON Schema with Zod 4's
native `z.toJSONSchema`, for callers that are not TypeScript. `zod-to-json-schema` is still in
`devDependencies` and is unused.

Bump `SCHEMA_VERSION` when the shape changes so that old artifacts can no longer satisfy it.

`lintCapability()` holds the structural checks the type system cannot express: duplicate step
ids, a `valueRef` that names no input, an output that maps to a step which is not an `extract`.
Add a check here whenever you find a way to write an incoherent artifact.

Three fields carry most of the design weight:

- `outcomes` — legitimate business answers, such as "no such member". These are **not** errors.
- `recoveries` — benign interruptions replay clears on its own, such as an interstitial.
- `successCheckpoint` — the assertion that proves the goal was reached.

`app` (`AppRefSchema`) carries the multi-tenant story: an artifact with no `tenantId` is the
cross-tenant base version; `variant` names a skin or version of the same vendor product.

### The replay result contract (`src/replay/result.ts`)

`ReplayResult` separates four things, and conflating any two is the central design mistake of
this problem:

| Status | Meaning |
| --- | --- |
| `success` | The goal was reached; declared outputs are attached. |
| `business_outcome` | A legitimate answer the caller needs. Not a crash. |
| `failed` | A defect, with a `FailureCategory`, the step, the expectation, and the observation. |
| `escalated` | Paused on a human. The run resumes on the same session. |

### Policy is one choke point (`src/policy/types.ts`)

Both discovery and replay call `PolicyEngine.check()`. There is deliberately no second path.
Risk classes are `safe`, `guarded`, `irreversible`, and the posture is fail-closed: treat an
unclassified action as irreversible. `redact()` runs at the recorder boundary, so nothing
sensitive reaches an artifact, a log, or an evidence file.

### Session ownership (`src/session/types.ts`)

`SessionBroker` owns the live session and the answer to "who is driving". The human takes over
the **same** session the automation was using, never a fresh one, and hands it back. Acting
without holding control is a defect. The handoff uses CDP (`CUAS_CDP_PORT`), so the browser
context must outlive the discovery loop.

### Evidence (`src/evidence/types.ts`)

One directory per run under `evidence/`. `events.jsonl` alone must explain what the system did
and why. Every event names its `Actor`, so a human takeover appears in the same stream as the
automation.

## Conventions

- TypeScript is strict, with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and
  `verbatimModuleSyntax`. Use `import type` for type-only imports; ESLint enforces it.
- Module resolution is NodeNext with ESM. Relative imports carry a `.js` extension, even from
  `.ts` sources.
- `__dirname` does not exist. Derive script-relative paths from `import.meta.url`.
- `src/config.ts` performs the one validated read of the environment. Do not read `process.env`
  anywhere else. `requireApiKey()` exists so that the replay path never depends on model access,
  and that property is deliberate — keep it.
- Every code comment in this repository states *why*, not *what*. Match that.

## Model access

Discovery uses `claude-opus-5` through `@anthropic-ai/sdk` (`CUAS_MODEL`). On Opus 5, pass
`thinking: { type: 'adaptive' }` and `output_config: { effort: 'high' }`; `budget_tokens` returns
a 400. Set `disable_parallel_tool_use: true`, because UI actions are ordered. Mark every tool
`strict: true`, and always `JSON.parse` tool input rather than matching the serialized string.

## Other agent configuration

An OpenAI Codex config exists at `~/.codex/config.toml`. To import the user-level items from it,
reply `/import` to see what is importable, then `/import --yes=<digest>` to apply it. If
`/import` is unavailable here, run `claude import` from a terminal.
