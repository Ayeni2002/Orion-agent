# Orion — Development Phases

Orion is built in phases. **Each phase assumes the previous ones are complete**, and
each is expected to extend the existing structure rather than replace it. The
foundation exists precisely so that later phases add layers — a phase that requires
restructuring the application is a signal the earlier phase was designed wrong, and
should be treated as such rather than absorbed silently.

Read alongside [`ARCHITECTURE.md`](./ARCHITECTURE.md), which describes the intended
shape of the parts marked *not implemented* here.

## Status

| Phase | Name | Status |
| --- | --- | --- |
| 1 | Foundation | **Complete** |
| 2 | Application shell | **Complete** |
| 3 | Agent engine | **Complete** |
| 4 | Tool system | **Complete** |
| 5 | Database & persistence | Not started |
| 6 | Real model provider | Not started |
| 7 | Memory & state | Not started |
| 8 | Reports & delivery | Not started |
| 9 | Hardening & deployment | Not started |

### Why the numbering changed

The original roadmap put the database first, then a model provider, then tools, and the
agent engine fifth — on the reasoning that the engine needs all three. Building the
engine third instead turned out to be possible, because the engine was designed against
seams rather than against implementations: `ModelProvider` has a deterministic adapter,
and the tool registry is a lookup that answers "no".

So the plan and the work diverged, and this table follows the work. **The reordering is
a finding, not a correction**: the original dependency reasoning was about *capability*,
and it was right about that — the engine genuinely cannot research anything yet. What it
underestimated is how much of the engine could be built and tested against a seam with
nothing behind it.

Three consequences worth recording:

- The original **Phase 3 (Model provider)** is split. The *interface*, its resolution,
  and a deterministic development adapter were built as part of Phase 3. A real external
  adapter is Phase 6 and remains entirely unbuilt.
- The original **Phase 4 (Tool system)** was built as Phase 4, against the registry seam
  Phase 3 left in place. That seam turned out to need *evolving* rather than filling:
  Phase 3's `AgentTool` and `executor/registry.ts` were replaced by the fuller
  `ToolDefinition` and `tools/registry.ts`, and the old registry was deleted rather than
  kept alongside. See the Phase 4 section for why.
- The database moved after the engine. Task state is currently held in process memory,
  which `ARCHITECTURE.md` §10 records as a known deviation with its consequences.

---

## Phase 1 — Foundation ✅

**Goal:** a project that runs, is typed, is tested, and has decided where everything
will go — with no agent functionality and no pretence of any.

Delivered:

- Next.js (App Router) + TypeScript, Tailwind CSS v4, shadcn/ui primitives.
- Application shell: root layout, landing page, workspace shell, and route-level
  `loading` / `error` / `not-found` boundaries.
- Environment strategy: `.env.example` naming every variable, `src/lib/env.ts` as the
  single reader, and `NEXT_PUBLIC_*` restricted to values that are safe in a browser.
- Supabase connectivity: browser and server clients, with the boundary between them
  documented and enforced by import discipline.
- Domain vocabulary in `src/types/agent.ts` — `Agent`, `AgentTask`, `TaskStatus`,
  `TaskStep`, `Tool`, `ToolExecution`, `AgentResult`.
- Validation (Zod) and API conventions: thin Route Handlers over framework-free
  services, with `ServiceError` carrying an HTTP status. `/api/health` demonstrates it.
- Vitest configured, with tests covering only what exists.

---

## Phase 2 — Application shell ✅

**Goal:** every surface the product needs exists and is navigable, with nothing faked
behind it.

Delivered:

- Two route groups so the two surfaces get different frames: the landing page at `/`
  uses `MarketingShell`; everything under `(app)` is wrapped in `AppShell` with a
  sidebar and mobile navigation. The group name stays out of the URLs.
- Six application routes — `/overview`, `/workspace`, `/projects`, `/research`,
  `/reports`, `/settings` — plus a landing page.
- Shared navigation configuration in `src/lib/navigation.ts`, so active-link logic has
  one implementation rather than one per surface.
- Presentational components in `src/components/common/`, `layout/`, and per-domain
  folders, with locally-defined props rather than imports of the domain types.

**The rule this phase established, which later phases must not break:** no fabricated
data anywhere. Every list is an explicitly empty typed constant rendered through an
`EmptyState`; every control belonging to a later phase is `disabled` and says so. No
invented statistics, no simulated progress, no placeholder results.

---

## Phase 3 — Agent engine ✅

**Goal:** Orion accepts an objective, plans it, executes the plan through an extensible
task system, observes the results, evaluates progress, and returns a structured result.

Delivered:

- **Domain model** (`src/types/agent.ts`) extended, not replaced: `StepStatus`,
  `ExecutionStatus`, `Observation`, `ExecutionState`, `AgentEvent`, `AgentExecution`,
  `AgentExecutionError`, `EngineCapabilities`. The Phase 1 types are all still present.
- **Model abstraction** — a `ModelProvider` interface the engine depends on, with the
  vendor named in exactly one place. Three implementations of it exist: the
  deterministic development adapter, a scripted adapter for tests, and nothing else.
  **No external provider is implemented.**
- **Planner** — objective in, Zod-validated plan out, with a dependency-graph check on
  top of the schema so no malformed model output can enter the execution system.
- **Executor** — walks the plan in dependency order, records an observation per step,
  resolves tools through a registry, and distinguishes a failed step from a skipped one.
- **Evaluator** — computes the verdict deterministically from the step outcomes and asks
  the provider only for the narrative.
- **Runtime** — an append-only event log, a state builder that owns every transition, a
  bounded process-local store, and a runner that assembles the lifecycle.
- **API** — `POST /api/agent/executions` starts a run and returns it finished;
  `GET` lists recent ones; `GET /api/agent/executions/[id]` reads one; `GET
  /api/agent/capabilities` reports what the engine can do before a run is attempted.
- **Workspace integration** — the objective form submits to the real engine and the
  execution, activity and results panels render what the engine returned.

**Explicitly not delivered, and not to be described as working:** any external model
call, any tool, web search, browsing, scraping, email, social integration, long-term
memory, vector storage, report generation, background workers, queues, and
multi-agent collaboration. A step needing an external capability is *reported as
unavailable*, which is the honest outcome and the one the engine is built to produce.

**Depends on Phases 1–2:** the domain types, the service convention, and the workspace
that now drives it.

---

## Phase 4 — Tool system ✅

**Goal:** the agent can do something other than talk.

Delivered:

- **Tool domain model** — `ToolCapability`, `ToolInput`, `ToolOutput`,
  `ToolExecutionStatus` and `ToolCatalog` added to `src/types/agent.ts`; `Tool` and
  `ToolExecution` reshaped. The executable half of the vocabulary (`ToolDefinition`,
  `ToolExecutionContext`, `ToolReceipt`, `ToolPermission`) lives in
  `tools/definition.ts`, because a Zod schema and a function do not survive a JSON
  round-trip and so cannot live in the domain-types module.
- **Tool registry** (`tools/registry.ts`) — `register` / `get` / `has` / `list` /
  `canExecute` / `ids`. It refuses a duplicate id and refuses a tool that declares no
  capabilities. `canExecute` requires the granted capabilities *and* that the registry
  actually holds the definition.
- **Tool execution engine** (`tools/executor.ts`) — resolve, check permission, validate
  input, execute, build a receipt. It always returns a receipt and **never throws**: a
  failed call is data, not an exception.
- **Execution context** — ids, objective, start time and granted capabilities. No
  filesystem, shell, environment, database or ambient network. A tool's dependencies must
  be passed to it explicitly.
- **Permissions** — `read_only`, `network`, `data_access`, `user_action`. **Deny by
  default**: a run is created granting `read_only` only, the permission is a constructor
  argument to the executor rather than a per-call parameter, and permission is checked
  *before* input validation.
- **First real tool** — `text.analyze`: a deterministic, read-only count of characters,
  words, sentences and paragraphs, with a bounded input and documented counting rules.
- **Receipts** — `ToolReceipt extends ToolExecution`, recording ids, tool version,
  status, timestamps, the validated input, the output and a structured error. No secret,
  credential or environment variable is reachable from inside a tool, so none can appear.
- **Agent engine integration** — the `AgentRunner` remains the orchestrator; the sequence
  is now `request → validate → plan → execute → tool call → observe → evaluate → result`.
  New events `tool.started` / `tool.completed` / `tool.failed`; observations carry
  `source` and `toolId` as first-class fields. A tool call is deliberately **not** an
  `ExecutionStatus`: it is a thing a run does repeatedly, not a state the run is in.
- **Failure handling** — unknown tool (`capability_unavailable`), refused permission
  (`tool_permission_denied`), invalid input (`invalid_tool_input`) and a throwing tool
  (`tool_failed`) are each recorded as a structured error on the step and, where
  applicable, in the run's error list. A failed tool fails its step, not the application.
- **API** — `GET /api/tools` returns registered tool metadata and the granted
  capabilities. It exposes no `execute` function, no schema, and no execution surface.
- **Workspace integration** — the execution panel renders each step's tool, its receipt
  (status, version, duration, structured output or error), and the observation that came
  back. The catalogue notice reads `/api/tools` rather than assuming what is registered.
- **Tests** — registry, executor pipeline, permission enforcement, the text analysis
  rules, planner handling of tool input, the development adapter's tool branch, the
  catalogue service, and tool-backed steps end to end through `runAgent`.

**Two changes to Phase 3, recorded rather than glossed over.**

Phase 3's `AgentTool` interface and `executor/registry.ts` were **replaced**, and the old
file deleted. Keeping both would have meant two registries, two notions of what a tool
is, and a rule nobody could state about which one a new tool belongs in. `ToolExecution`
also existed from Phase 1 with **no producer** — nothing wrote one — so building the tool
system around unproduced sketch vocabulary would have meant building it around a guess.

**Explicitly not delivered, and not to be described as working:** web search, browsing,
scraping, browser automation, any external API or account integration, email or social
integration, shell execution, code execution, filesystem or database access from a tool,
tool timeouts, multi-call steps, long-term memory, vector storage, report generation,
background workers, queues, multi-agent collaboration, and any tool marketplace. A step
needing an external capability is still *reported as unavailable*, which remains the
honest outcome.

**Depends on Phase 3:** the runner, the plan-walking executor, the `capability_unavailable`
path, and the planned step's `toolId` field all existed and are now backed by a real
implementation.

---

## Phase 5 — Database & persistence

**Goal:** the application has a schema, and something is actually stored.

- Supabase project provisioned; migrations under version control from the first one.
- Tables shaped around the domain types: executions, tasks, steps, observations, tool
  executions.
- **Row Level Security enabled on every table at creation time**, with policies written
  alongside the migration — not deferred.
- Authentication, since RLS policy requires an identity to key on.
- The process-local execution store replaced by a repository behind the service. This
  closes the deviation recorded in `ARCHITECTURE.md` §10.

**Depends on Phase 3:** there is now state worth persisting, and a bounded, swappable
store to replace.

---

## Phase 6 — Real model provider

**Goal:** one real model call, behind the interface that already exists.

- A concrete external adapter under `src/server/agent/provider/`, and a case for it in
  `resolveModelProvider`. Two files, if §6 of the architecture document is accurate.
- Prompt construction kept isolated from the transport, so swapping a vendor does not
  mean rewriting prompts.
- Response parsing that treats model output as untrusted, as the planner already does.
- Provider selection by environment, which is already how resolution works.

**Depends on Phase 3:** the interface, the resolution point, and the credential
containment in `src/lib/env.ts` are all in place.

---

## Phase 7 — Memory & state

**Goal:** Orion does not rediscover the same things every run.

- Long-term memory distinct from task state, as set out in `ARCHITECTURE.md` §8.
- Retrieval at planning time, and writes at the end of a run.
- Persisted in PostgreSQL behind services, so memory survives a restart.

**Depends on Phases 5–6:** there is nothing worth remembering until runs use a real
model and their results are stored.

---

## Phase 8 — Reports & delivery

**Goal:** a result a person can read and act on.

- Structured report generation from the run's artefacts. The raw per-step findings the
  engine already records are the input this needs, and they are kept unmerged precisely
  so a report can trace every claim back to its step.
- Presentation in the workspace, and export or delivery.
- Every claim in a report traceable to the step or tool execution that produced it.

**Depends on Phases 4–7.**

---

## Phase 9 — Hardening & deployment

**Goal:** it runs somewhere other than a laptop.

- CI running typecheck, tests and build on every push.
- Deployment to the intended target, with environment configuration per environment.
- Rate limiting, cost ceilings, and observability over model and tool calls.
- Replacing the process-local store if Phase 5 has not already done so — a serverless
  deployment makes the deviation in `ARCHITECTURE.md` §10 a correctness problem rather
  than a convenience one.
- The security review that a system holding credentials and executing tools requires.

**Depends on all previous phases.**

---

## Gates

Every phase ends the same way. A phase is not complete until all three pass locally:

```bash
npm run typecheck && npm test && npm run build
```

Rules that hold for every phase:

- **Do not weaken TypeScript configuration or disable tests to make a gate pass.**
  A gate that was weakened is worse than a gate that failed.
- **Do not hard-code credentials**, in source, tests, or fixtures. Configuration
  arrives through the environment, read in `src/lib/env.ts`.
- **Tests must not depend on live credentials** or network access. The engine's tests
  run with no API key present at all, which is the only way to know they are not
  quietly relying on one.
- **Do not claim a capability works before it does.** "Not implemented" is an
  acceptable state to be in; an inaccurate description of the current state is not.
- **Do not present a development stand-in as the real thing.** When the deterministic
  adapter is used, the result says so.
- **Do not write tests for code that does not exist yet.** They assert a design that
  has not been settled and will be rewritten.
- **Do not rewrite unrelated tests from earlier phases** to accommodate a change.
- **Add features; restructure only with reason.** If a phase needs the application
  reorganised, that is a finding about the earlier phase — record it, do not paper
  over it.

## Adding a phase

Amend the status table and add a section in the same form: goal, deliverables, and
what it depends on. Keep the dependency lines honest — they are the record of why the
order is what it is.
