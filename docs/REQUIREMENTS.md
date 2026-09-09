# What I Must Build — Assignment A: Computer-Use Automation System

Source: `docs/Assignment A — Computer-Use Automation System.pdf` (interface.ai engineering take-home).

## 1. The one-sentence goal

Build a system where an LLM discovers how to complete a task by driving a real
application UI, records that run as a typed reusable artifact, and then replays
that artifact deterministically with no LLM in the decision loop — with safety
guardrails, evidence, and a human-takeover path.

The through-line the brief states: **the model discovers, the artifact becomes a
reusable capability, deterministic replay is how a production AI agent invokes it.**

## 2. Why the problem exists

The company builds AI agents for banks and credit unions. When a back-office app
has an API, they use the API — that case is out of scope. This project targets the
long tail of legacy apps with no API, where the only way in is to drive the UI like
a human operator.

Three properties of that environment shape every design decision:

1. **Stable UIs, real runtime errors.** These enterprise apps change slowly, which
   makes record-once / replay-many viable. The hard part is not layout drift. It is
   the runtime conditions: validation errors, "record not found", permission denials,
   unexpected confirmation dialogs, session timeouts, transient slowness, app errors.
2. **Heterogeneous, often legacy surfaces.** Modern web app, legacy server-rendered
   web app (framesets, nested tables, non-semantic markup, no test IDs), or a native
   desktop app. I cannot assume a clean DOM, stable selectors, or an API.
3. **Multi-tenant at scale.** Hundreds of institutions, ~20 apps each. Many tenants
   run the same vendor product, branded and versioned differently. Artifacts should
   generalize across tenants or degrade gracefully, not be re-recorded per tenant.

## 3. Must-have requirements

I must deliver a thin-but-real version of **every** item below. The brief says to
cut depth, never cut a whole capability.

### 3.1 Goal-driven agent loop
- Accept a natural-language goal plus a target (app, URL, entry point).
- Run an LLM-driven observe → decide → act loop against a live surface until the
  goal is met or a stopping condition hits (max steps, timeout, dead end).
- The agent must interact with a real UI: click, type, navigate, read state.
- I choose the mechanism, but I should bias toward an approach that still works
  when the surface has no clean DOM.

### 3.2 Structured artifact (an agent-invocable capability)
After a successful run, emit a typed, serializable artifact that expresses at minimum:
- the ordered steps and actions,
- how each target element or control is identified, with my reasoning about robustness,
- typed input parameters the caller supplies per invocation (e.g. a member ID),
- typed outputs to extract and their shape,
- a checkpoint or success condition.

The artifact must be versioned and reviewable by both a human and a calling agent.
It must be decoupled from the raw model transcript. **The schema is a focal point of
the evaluation.**

### 3.3 Deterministic replay (the production path)
- Given a saved artifact plus input parameters, replay it with no LLM in the decision loop.
- Use stable element targeting, verify the checkpoint, return declared outputs.
- Handle runtime errors explicitly, and separate three classes in the result contract:
  - **expected business outcomes** the caller needs (e.g. "no such member" is a
    legitimate result, not a crash),
  - **recoverable conditions** (dismiss a known interstitial, wait or retry a transient load),
  - **hard failures** that stop and surface a clear, debuggable error.
- Report a structured result: success with outputs, a known business outcome, or a
  failure that says what step, what was expected, and what was observed.

### 3.4 Safety and policy guardrails
- Enforce an explicit, configurable allowlist of permitted domains, routes, and action
  types. The agent must not act outside it.
- Separate safe or reversible actions from risky or irreversible ones, and handle the
  risky class conservatively: block, require confirmation, or flag. I must justify the choice.
- Never persist credentials, tokens, or full PII into artifacts or logs. Redact.

### 3.5 Evidence and observability
- A structured log of what the agent did and why.
- At least one richer signal on failure: screenshot, DOM snapshot, or trace.

### 3.6 Human-in-the-loop escalation and handoff
- **Detect and route.** Identify a stuck or blocked state and raise an intervention
  request that carries which capability or goal, the current step, the current state or
  screenshot, and why it stopped.
- **Take control of the live session.** The human operates the *same* live session the
  automation used, not a fresh one, then hands control back so the run resumes or completes.
  Preserve context and evidence across the handoff, and record what the human did.
- Reason about the seam: automation must pause, cede control, and resume on the same
  session, and there must be a way to know who is in control.
- A full real-time co-browsing console is out of scope. A mocked operator surface is
  acceptable, but the handoff mechanism and control-transfer model must be real.

### 3.7 Design for heterogeneity and scale (write-up, not necessarily code)
I implement against one surface, but the write-up must answer:
- **Surface abstraction:** how the schema and replay engine extend to a legacy web app
  and a desktop app. What is the seam between "how we perceive and act on a surface"
  and "the recorded flow"?
- **Multi-tenant reuse:** how to represent an artifact so it is reused, or safely
  specialized and overridden, across tenants running the same vendor app instead of
  being re-recorded. How to detect and manage per-tenant and per-version drift.

## 4. What is my call

Language, runtime, frameworks, LLM provider and model, prompting, computer-use
technology, target application, artifact schema and storage, the determinism strategy,
and the architecture. Simpler is fine when justified.

**Target app constraints:** no real bank system, and I must not try to get one. I pick
a proxy target that exercises a non-trivial multi-step flow — search → detail → action,
or a multi-field form with a confirmation step. A public demo site, a local app I build,
or an intentionally hostile legacy-style surface all qualify. If I use a public site, I
respect its terms and rate limits and never use real credentials or real PII.

**The one thing that is not my call:** the discovery run has to be real. At least one
genuine LLM-driven run against a live surface, with the evidence in `/evidence/`.
I need my own model API access.

Everywhere else, a clean documented seam is acceptable.

## 5. Deliverables (exact paths and headings required)

1. **Source code** in a public GitHub repo, with `/README.md` covering:
   - setup and run instructions, including keys and config, and how to run without
     live services if applicable,
   - a demo path: the exact commands to run the agent on a goal, then replay the artifact.

2. **`/REPORT.md`**, roughly 1–3 pages, using these seven headings exactly:
   1. Architecture
   2. Artifact schema
   3. Determinism & error handling
   4. Heterogeneity & multi-tenant
   5. Escalation & handoff
   6. Safety
   7. Cuts

3. **`/evidence/`** with a saved example artifact plus logs from a discovery run and a
   replay run. Ideally one replay that hits an error or exceptional state — a bad input,
   a not-found result, or an injected failure. A short screen recording is optional.

4. Push to a public GitHub repo, then email the link on its own line to
   `assignments@interface.ai` from the address I applied with. No zip file.

## 6. How it is scored (in weight order)

1. **System design** — clear boundaries, sensible data models, good trade-offs. The
   artifact schema and replay contract are central.
2. **Correctness of the core loop** — the agent completes a real goal, the artifact
   replays deterministically and verifies success.
3. **Robustness and error handling** — detection and response to runtime errors, clean
   separation of business outcomes from recoverable conditions and hard failures, sound
   locator, wait, and checkpoint strategy.
4. **Human-in-the-loop escalation** — a real mechanism, not a TODO.
5. **Generalization to the real environment** — a credible story for heterogeneous
   surfaces and cross-tenant reuse.
6. **Safety and data handling** — allowlist enforcement, risky-action treatment, redaction.
7. **Code quality** — readable, typed and tested where it counts, easy to run.
8. **Communication** — the write-up makes reasoning, trade-offs, and cut lines clear.

Feature breadth, framework name-dropping, and scaling infrastructure (queues, clusters,
multi-tenant plumbing) earn nothing. A small, correct, well-argued system is the goal.

## 7. Optional stretch goals — pick at most one or two

- Agent-facing capability catalog with typed args, and show one invocation.
- Code generation: emit a runnable test or page object from an artifact.
- Confidence and approval: score replay reliability, gate unattended replay on
  draft → approved.
- Assisted fallback: a bounded, policy-checked LLM recovery for a single step on
  replay failure, recorded as evidence.
- Canonicalization and cross-tenant reuse: normalize `/item/12345` to `/item/:id`,
  or apply one artifact to a second app variant with per-variant overrides.
- Multi-run stability: replay N times and report a flakiness signal.

## 8. Ground rules

- AI-assisted development is assumed and encouraged. I own everything I submit and
  must defend any part of it in detail.
- Do not automate against sites where it violates their terms, harms the service, or
  needs real credentials.
- Keep secrets out of the repo.
- Time-box it myself. No deadline. If I stop early, I document the rest as next steps.
