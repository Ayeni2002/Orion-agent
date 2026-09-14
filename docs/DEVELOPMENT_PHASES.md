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
| 2 | Database & persistence | Not started |
| 3 | Model provider | Not started |
| 4 | Tool system | Not started |
| 5 | Agent engine | Not started |
| 6 | Memory & state | Not started |
| 7 | Reports & delivery | Not started |
| 8 | Hardening & deployment | Not started |

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

Explicitly **not** delivered, and not to be described as working: the agent engine,
any model provider, tools, research, reports, memory, authentication, and the
database schema. The workspace collects an objective and stops — the `Start Agent`
button validates and reports that the engine is not implemented. It does not simulate
progress.

---

## Phase 2 — Database & persistence

**Goal:** the application has a schema, and something is actually stored.

- Supabase project provisioned; migrations under version control from the first one.
- Tables shaped around the Phase 1 domain types: tasks, steps, tool executions.
- **Row Level Security enabled on every table at creation time**, with policies
  written alongside the migration — not deferred.
- Authentication, since RLS policy requires an identity to key on.
- Data access introduced through `src/server/services/**` only. Components and Route
  Handlers continue to issue no queries directly.

**Depends on Phase 1:** the types, the service convention, and both Supabase clients.

---

## Phase 3 — Model provider

**Goal:** one real model call, behind an interface, selectable by configuration.

- A `ModelProvider` interface — prompt plus tool catalogue in, text or tool call out.
- One concrete adapter behind it. A second vendor is a later phase, not this one.
- Provider chosen by environment (`ORION_LLM_*`), never hard-coded.
- Prompt construction isolated from the transport, so swapping a vendor does not mean
  rewriting prompts.

**Depends on Phase 1:** the environment strategy and the refusal to couple to a vendor.
**Depends on Phase 2:** nothing — but prompt/response logging needs somewhere to go.

---

## Phase 4 — Tool system

**Goal:** the agent can do something other than talk.

- A tool registry: name, description, input schema, execution function.
- A runtime that executes a tool call and records a `ToolExecution` for the run.
- A small set of real tools — starting with the ones the research workflow needs.
- Errors from a tool are returned to the engine as observations, not thrown past it.

**Depends on Phase 3:** a tool call has to come from somewhere.
**Depends on Phase 2:** executions are recorded.

---

## Phase 5 — Agent engine

**Goal:** Orion performs the workflow it exists for.

```
goal → understand → plan → select tools → execute → observe → evaluate
     → continue or revise → structured final result
```

- Planner, executor, and the loop that connects them.
- **Evaluation as a first-class stage** — judging whether a result answers the
  objective, and revising the plan when it does not. Not a retry wrapper.
- Bounded execution: explicit iteration and cost limits, and a defined behaviour when
  they are reached.
- Live task state observable from the workspace, replacing the Phase 1 placeholder.

**Depends on Phases 2–4:** every one of them, without exception. This is the phase the
previous four exist to make possible.

---

## Phase 6 — Memory & state

**Goal:** Orion does not rediscover the same things every run.

- Long-term memory distinct from task state, as set out in `ARCHITECTURE.md` §8.
- Retrieval at planning time, and writes at the end of a run.
- Persisted in PostgreSQL behind services, so memory survives a restart.

**Depends on Phase 5:** there is nothing worth remembering until runs produce results.

---

## Phase 7 — Reports & delivery

**Goal:** a result a person can read and act on.

- Structured report generation from the run's artefacts.
- Presentation in the workspace, and export or delivery.
- Every claim in a report traceable to the step or tool execution that produced it.

**Depends on Phases 5–6.**

---

## Phase 8 — Hardening & deployment

**Goal:** it runs somewhere other than a laptop.

- CI running typecheck, tests and build on every push.
- Deployment to the intended target, with environment configuration per environment.
- Rate limiting, cost ceilings, and observability over model and tool calls.
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
- **Do not claim a capability works before it does.** "Not implemented" is an
  acceptable state to be in; an inaccurate description of the current state is not.
- **Do not write tests for code that does not exist yet.** They assert a design that
  has not been settled and will be rewritten.
- **Add features; restructure only with reason.** If a phase needs the application
  reorganised, that is a finding about the earlier phase — record it, do not paper
  over it.

## Adding a phase

Amend the status table and add a section in the same form: goal, deliverables, and
what it depends on. Keep the dependency lines honest — they are the record of why the
order is what it is.
