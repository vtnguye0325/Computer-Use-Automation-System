# Computer-Use Automation System

An LLM discovers how to complete a task by driving a real application UI, the run is
recorded as a typed capability artifact, and that artifact then replays deterministically
with no model in the decision loop.

> The model discovers. The artifact becomes a reusable capability. Deterministic replay
> is how an AI agent invokes it in production.

**Status: Phase 0 complete — foundation and core seams.** See
`docs/IMPLEMENTATION_PLAN.md` for the phase plan and `docs/REQUIREMENTS.md` for the brief.

## Setup

```bash
npm install                     # postinstall runs `playwright install chromium`
npx playwright install chromium # run this by hand if you skipped scripts
cp .env.example .env      # add ANTHROPIC_API_KEY for discovery runs only
npm run typecheck
npm test
```

## Demo path

Not runnable yet. The target commands, once the phases land:

```bash
npm run app                                        # start the local target application
npm run cli -- record --goal "look up member 12345 and read their savings balance"
npm run cli -- replay -c capabilities/<artifact>.json -i memberId=12345
npm run cli -- replay -c capabilities/<artifact>.json -i memberId=99999   # business outcome
npm run cli -- operator                            # human takeover surface
```

Replay never reads `ANTHROPIC_API_KEY`. That is deliberate: the production path must not
depend on model access.

## Layout

| Path | What lives there |
| --- | --- |
| `src/surface/` | The perception and action seam. No DOM or Playwright vocabulary leaks above it. |
| `src/schema/` | The capability artifact contract, in Zod, plus the emitted JSON Schema. |
| `src/discovery/` | The LLM observe → decide → act loop. |
| `src/replay/` | The deterministic executor and its result contract. |
| `src/policy/` | Allowlist, action risk classes, redaction. One choke point. |
| `src/evidence/` | Structured run logs, screenshots, snapshots. |
| `src/session/` | Session ownership and human control transfer. |
| `fixtures/app/` | The local, intentionally legacy target application with injectable faults. |
| `capabilities/` | Saved artifacts and the emitted JSON Schema. |
| `evidence/` | Per-run output. Demo runs are committed. |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript, strict. |
| `npm test` | Vitest. |
| `npm run lint` | ESLint. |
| `npm run schema:emit` | Regenerate JSON Schema from the Zod source of truth. |
| `npm run app` | Start the local target application. |
| `npm run cli -- <verb>` | `record`, `replay`, `catalog`, `operator`. |
