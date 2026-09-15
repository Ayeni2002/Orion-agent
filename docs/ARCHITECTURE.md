# Orion — Architecture

> **Status: Phase 5 (Research intelligence).** The agent engine exists and runs: it
> plans an objective, executes the plan — calling real tools where a step names one —
> evaluates the outcome and returns a structured result. Above it, a research layer
> takes a question, plans retrieval tasks, searches, deduplicates, reads findings
> with the passage each claim rests on, and returns the evidence.
>
> What backs the engine out of the box is still deliberately thin: a
> **deterministic development adapter** rather than a real model, and a **catalogue
> holding exactly one tool**, a read-only text measurement. **Retrieval is real when
> configured** — point `LLM_ENDPOINT` at OpenRouter and `research.search` reaches its
> web-search plugin — and reports itself as unconfigured everywhere else, so a run
> stops with `search_not_configured` rather than appearing to search. The database,
> memory and reports described below under *future* **do not exist**. Sections record
> what is real and what is not; nothing here claims a capability the code does not
> have.
>
> Read this alongside [`DEVELOPMENT_PHASES.md`](./DEVELOPMENT_PHASES.md), which says
> which phase builds which part, and [`TOOL_SYSTEM.md`](./TOOL_SYSTEM.md), which is
> the reference for the tool layer this phase added.

## 1. Guiding principles

**The agent is a later concern.** Phase 1 exists so that the agent engine can be
added as a layer rather than a rewrite. Nothing in the foundation assumes the agent
does not exist, and nothing in it pretends the agent does.

**Business logic never lives in UI.** A React component renders and collects input.
It does not talk to a database, call a model, or decide what a task means.

**Boundaries are enforced by import discipline, not convention alone.** Server-only
modules (`next/headers`, the service-role Supabase client) must never be reachable
from a client bundle. See §4.

**Configuration is read in exactly one place.** `src/lib/env.ts` is the only module
that touches `process.env`. Every other module imports from it.

**The provider is configuration, not a dependency.** No AI vendor SDK is installed,
and none is named in the type system. See §6.

## 2. Frontend architecture

Next.js App Router, TypeScript throughout, Tailwind CSS v4, shadcn/ui primitives.

```
src/app/           routes — layout, pages, loading/error boundaries
src/components/
  common/          EmptyState, PageHeader, StatusIndicator — shared presentation
  layout/          application chrome (shells, sidebar, navigation)
  ui/              shadcn/ui primitives — presentation only
  workspace/       workspace-specific composition
```

**Server Components are the default.** A component becomes a Client Component
(`"use client"`) only when it needs state, effects, or browser APIs — for example
`src/components/workspace/workspace-console.tsx`, which owns the execution, the
request that produces it, and the capability check it performs on mount.

**Route-level states are first-class**, not an afterthought: `loading.tsx`,
`error.tsx` and `not-found.tsx` sit beside the routes they cover, so every route has
a defined loading and failure appearance without per-component handling.

**The UI never reaches for data directly.** Components receive plain data as props or
call a service. The workspace is the one place this is exercised for real: it collects
an objective, posts it to `/api/agent/executions`, and renders exactly what came back.
It does not know how a plan is produced, and it does not advance a step's status —
when a run finishes, it is the server that said so.

## 3. Backend architecture

```
src/app/api/**/route.ts     thin HTTP handlers
src/server/http.ts          body reading + error-to-response mapping
src/server/services/**      business logic
src/server/agent/**         the agent engine — see §5
src/server/errors.ts        ServiceError — an error that carries an HTTP status
```

**Route Handlers stay thin.** A handler parses and validates the request with a Zod
schema, calls a service, and shapes the response. It contains no business logic and
makes no database call. `src/app/api/health/route.ts` is the convention in miniature.

**Services are framework-free.** A service in `src/server/services/` takes plain
arguments and returns plain data. It must not import React, `next/headers`, or
anything from `src/components`. That restriction is what keeps a service callable
from a Route Handler, a Server Action, or a test with no request in scope.

**Failures are typed.** A service signals failure by throwing `ServiceError` with a
status, rather than returning sentinel values or leaking a raw exception. The handler
maps it to a response; nothing else needs to know about HTTP.

**Server Actions** are available for mutations without a REST surface and follow the
same rule: validate, call a service, return. They are not used yet.

## 4. Database boundary

Supabase (PostgreSQL). Phase 1 establishes connectivity and the rules for using it —
**not the schema**. There are no tables, migrations, policies or auth flow yet.

```
src/lib/supabase/client.ts   browser client  (anon key, RLS applies)
src/lib/supabase/server.ts   server client   (Server Components, Actions, Handlers)
```

**The two clients are not interchangeable.** Server code must never import the
browser client, and client code must never import the server one — `next/headers`
does not exist in a browser, and the server client is a different trust level. This is
the single most important boundary in the codebase.

**Row Level Security is the security model**, not secrecy of the anon key. The anon
key is public by design and is exposed to the browser; RLS is what protects data. The
`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely, is server-only, and is documented
in `.env.example` but deliberately unread by any code until a phase needs it.

**The database is behind services.** No component and no Route Handler issues a query
directly. When the schema arrives, the only files that change are the services.

**Intended future schema** (Phase 5, not created): users, projects, agent tasks,
task steps, tool executions, research artefacts, reports, agent state. The domain
types in `src/types/agent.ts` are the vocabulary those tables will be shaped around —
which is why they exist before the database does.

## 5. Agent engine

**Implemented**, and the reason the project exists.

```
request → validate → plan → execute → [ tool call ] → observe → evaluate → result
```

Lives in `src/server/agent/`, which is real rather than reserved:

```
provider/     ModelProvider interface, the development adapter, a scripted test one
planner/      objective → validated plan (Zod, plus a dependency-graph check)
executor/     walks the plan, records observations, calls tools through the tool layer
tools/        the tool system — definitions, registry, executor, catalogue (see §7)
evaluator/    computes the verdict, requests a narrative
runtime/      state builder, append-only event log, process-local store, the runner
errors.ts     AgentEngineError — an engine failure with a machine-readable code
```

**The lifecycle is assembled in one place** — `runtime/runner.ts`. Every stage below it
is independently testable and knows nothing about the others; the runner is the only
module that has to know the whole shape of a run.

**A tool call is not a lifecycle status.** The bracketed stage in the diagram above is a
thing a run does repeatedly inside one step-walking pass, not a state the run is in, so
it has no `ExecutionStatus` of its own. It is visible where it actually happens: as
`tool.started` / `tool.completed` / `tool.failed` events, as observations carrying
`source: "tool"`, and as a receipt recorded on the step that made the call.

**The runner never throws.** A failed run is a returned execution with
`status: "failed"` and structured errors attached, because a caller needs the partial
results of a run that went wrong far more than it needs an exception.

**One failed step does not abort the run.** Steps depending on it are skipped, since
running them would mean running them against input that does not exist; independent
branches continue. A run therefore produces as much as it honestly can, and reports
exactly which step failed and why.

**The verdict is computed, not generated.** `evaluation` decides `completed` or
`failed` deterministically from what the steps actually did. A model is asked only for
the narrative. This is what stops model output from having the authority to mark work
complete — the same rule §3 applies to clients.

**What the engine does not do yet.** It runs a plan **once**. Evaluation reports; it
does not revise the plan and re-run it, so `iteration_limit_reached` exists in the
error vocabulary with nothing that can raise it. Bounded execution, cost ceilings and
plan revision arrive with the phases that need them. There is also no scheduler and no
background worker: a run completes inside the request that started it.

The engine consumes and produces the Phase 1 types in `src/types/agent.ts`, which later
phases extended rather than replaced — `ExecutionState`, `Observation`, `AgentEvent`,
`AgentExecution`, `StepStatus` and `ExecutionStatus` were added in Phase 3, and
`ToolCapability`, `ToolInput`, `ToolOutput`, `ToolExecutionStatus` and `ToolCatalog` in
Phase 4; nothing was removed. Phase 4 did reshape two of the Phase 1 types, `Tool` and
`ToolExecution`, because nothing produced either of them yet and a tool system built
around unproduced sketch vocabulary would have been built around a guess. That is recorded
as a change rather than presented as an addition.

## 6. Model abstraction

**The interface is implemented. No external provider is.** The only adapter that exists
is deterministic and local; no vendor SDK is a dependency and no vendor is named in the
engine.

```
src/server/agent/provider/provider.ts       the interface, request/response, JSON parsing
src/server/agent/provider/dev-provider.ts   the deterministic development adapter
src/server/agent/provider/stub-provider.ts  a scripted adapter, for tests
src/server/agent/provider/index.ts          resolveModelProvider() — the one place a
                                            concrete provider is named
```

The engine talks to `ModelProvider` and knows nothing else: not a wire format, not a
vendor's message shape, not a base URL. `ModelProvider` has several independent
implementations of the same interface, which is the practical evidence that the seam is
real rather than intended.

**The development adapter is a stand-in, and says so.** It performs no inference and
contacts nothing; its plan is a fixed analytical skeleton parameterised by the objective
text. It is never presented as AI output — `isExternal` is `false`, and every execution
carries its provider descriptor so the workspace can state which one ran.

**The real adapter is one file, and it is not vendor-specific.** `provider/openai-provider.ts`
speaks the OpenAI-compatible `/chat/completions` protocol, which OpenRouter, Groq,
Together, Fireworks, vLLM, LM Studio and OpenAI itself all speak. `LLM_API_STYLE` names
the *protocol* rather than the vendor, so reaching a new service is a change to
`LLM_ENDPOINT` and not a change to code. A genuinely different protocol — Anthropic's
messages API, Gemini's `generateContent` — would be a new member of
`SUPPORTED_API_STYLES` and a new adapter beside this one.

**Resolution does not fall back.** If `LLM_API_STYLE` names a style Orion does not
implement, or a remote style is configured without an endpoint or a model,
`getModelProviderConfig` throws and the run fails loudly. Quietly running the development
adapter while an operator believes a real model is configured would make every downstream
result a lie.

**The credential never leaves `src/lib/env.ts`.** `getModelProviderConfig` reads
`LLM_API_KEY` *only* to compute a `hasApiKey` boolean and never returns the value. That
matters more now than it did when nothing consumed the key: the configuration object is
spread into provider descriptors, returned from services and rendered by the settings
screen, so a credential living on it would travel with every copy. The one function that
does return the secret is `readModelApiKey`, whose sole caller is the adapter, which
writes it into an `Authorization` header and drops it. §10's one-reader rule is what makes
this enforceable rather than aspirational.

`.env.example` carries the provider-neutral names, now live:

```
LLM_API_STYLE=   # "dev" (default) | "openai". Any other value fails loudly.
LLM_ENDPOINT=    # Base URL, without the /chat/completions suffix.
LLM_MODEL=       # Required for every style except "dev".
LLM_API_KEY=     # Optional — a local endpoint such as vLLM needs none.
```

**Not yet present:** a research/search adapter. Phase 5 adds a second seam beside this
one, through which retrieval reaches the network; the model adapter above is never asked
to search, and the search adapter is never asked to reason. Keeping those apart is what
makes "the model did not fetch this" a checkable claim rather than a hope.


## 7. Tool system

**Implemented, with one tool in the catalogue.** The full reference — the vocabulary,
the pipeline, the permission model and the procedure for adding a tool — is
[`TOOL_SYSTEM.md`](./TOOL_SYSTEM.md). This section records the shape and the reasoning.

```
src/server/agent/tools/
  definition.ts          ToolDefinition, ToolExecutionContext, ToolReceipt, ToolPermission
  registry.ts            ToolRegistry — register / get / has / list / canExecute
  executor.ts            ToolExecutor — the only sanctioned way to call a tool
  catalog.ts             the one file that decides which tools a run can call
  builtin/
    text-analysis.ts     text.analyze — the only tool that ships
  testing.ts             a scripted tool, for tests only (not in the public barrel)
```

The path a call takes:

```
AgentRunner → AgentExecutor → ToolRegistry → ToolExecutor → Tool → Observation → Evaluator
```

**The five stages, in order, and the order is the control.** Resolve the tool (unknown →
`capability_unavailable`); **check the permission** (refused → `tool_permission_denied`);
**then** validate the input against the tool's schema (`invalid_tool_input`); execute (a
throw becomes `tool_failed`); build the receipt. Permission is checked *before* validation
on purpose — a tool the run may not use is refused without its schema ever consuming
untrusted input.

**It always returns a receipt and never throws.** A failed call is data, not an exception:
the run has to keep going, the step has to record what happened, and the evaluator has to
be able to read it. One flaky tool must not be able to destroy an otherwise sound run.

**Deny by default.** A run is created with `DEFAULT_TOOL_PERMISSION`, which grants
`read_only` and nothing else. There is no "allow everything" constructor to reach for by
accident, the permission is a *constructor* argument to `ToolExecutor` rather than a
per-call parameter — so no caller can grant itself a capability — and the registry refuses
to register a tool that declares no capabilities at all, because "declares nothing" would
otherwise read as "needs nothing".

**Tools are declared, not hard-coded into the planner.** The planner selects from a
catalogue by id; adding a tool means adding a module, a test, and one line in `catalog.ts`.
Nothing in the planner, the executor, the runner or the API names a tool.

**Tool execution is recorded.** `ToolExecution` existed from Phase 1 with no producer;
`ToolReceipt` extends it and the tool executor produces one per call — call identity, run
identity, tool id and version, status, timestamps, the validated input, the output, and a
structured error when there is one. It never carries a credential, an environment variable
or a raw upstream payload, and none of those is reachable from inside a tool in the first
place.

**What the catalogue holds:** `text.analyze` and nothing else — a deterministic, read-only
count of characters, words, sentences and paragraphs. It measures the text it is given and
retrieves nothing.

**Still absent:** web search, browser automation, scraping, external APIs, shell
execution, code execution, filesystem access, database access, and any tool that reaches
outside the process. `web.search` is still named by the planner and still unregistered, so
the engine's `capability_unavailable` path is live behaviour rather than a memory of one.
A step carries at most one `toolId`, so a run makes at most one tool call per step; a
multi-call step is not supported. There is also no timeout handling — a tool call is
awaited without a deadline, which is recorded as a gap rather than claimed as a feature.

## 8. Memory and state

**Task state exists. Long-term memory does not.**

The distinction the design has to respect, and now does:

- **Task state** — the live status of a run. This is `ExecutionState` plus the task,
  steps and observations around it. **Implemented**, in `ExecutionStateBuilder` and the
  event log.
- **Long-term memory** — what Orion retains across runs so it does not rediscover the
  same things. **Not implemented**, and it has no representation in the codebase. It
  must not be conflated with task state, and nothing in `ExecutionState` should be
  reused as though it were memory.

**Both are meant to live in PostgreSQL behind services.** Task state currently does
not — see §10 for the deviation, and `src/server/agent/runtime/store.ts` for why.

Structured failures are state too: `AgentExecution.errors` carries machine-readable
codes so a consumer can branch on the kind of failure without parsing prose.

## 9. Testing strategy

Vitest, `node` environment, no globals — tests import `describe`/`it`/`expect`
explicitly. The `@/` path alias resolves in tests via `vitest.config.ts`. Tests sit
beside the code they cover.

The engine is tested at two levels, and the split is deliberate:

- **Units** — plan validation (schema and dependency graph), the development adapter's
  determinism, the tool registry, the tool executor's pipeline, the text analysis tool's
  counting rules, error conversion, the store's bound. Each asserts one rule.
- **Integration** — `runtime/runner.test.ts` drives the whole lifecycle against a
  scripted provider: cancellation, a failing step, an unavailable capability, a
  registered tool, a tool-backed step end to end, a failed tool, a refused permission,
  rejected tool input, planner failure, provider misconfiguration. These are the tests
  that would catch a broken seam, because the scripted provider is a *different
  implementation* of `ModelProvider` from the development one — the engine cannot tell
  which it is talking to, which is exactly the property being verified.

The convention that matters as the project grows:

- **Services are the natural unit of test.** They are framework-free by design, so
  they test without a request, a database, or a rendered tree.
- **External calls get mocked at the boundary.** No test requires network access, a live
  Supabase project, or a live model credential — the engine's tests run with no API key
  present at all, which is the only way to know they are not quietly depending on one.
- **Do not write tests ahead of the implementation.** A test for a phase that has not
  been built asserts a design that does not exist yet and will be rewritten.
- **A test that mocks the thing under test proves nothing.** Provider calls are scripted
  so that the planner, executor and evaluator run for real; none of them is mocked.

There is still no component-render layer and no end-to-end browser layer, so CSS,
layout and client interactivity remain unverified by tests.

Run `npm run typecheck && npm test && npm run build` before pushing (see
`DEVELOPMENT_PHASES.md` §Gates).

## 10. Deployment direction

The application is a standard Next.js app and deploys as one — the intended target is
**Vercel**, with Supabase as the managed database.

Consequences the design already respects:

- **Environment variables are the only configuration channel**, read in one place, so
  a new environment is a matter of setting variables rather than changing code.
- **No server-side state in process memory.** Anything that must survive a request
  belongs in the database, because serverless instances are not long-lived.
- **The model provider must be swappable per environment**, which is the practical
  reason §6 forbids a hard-coded vendor: the deployment target and the model vendor
  should be independent decisions.

### Known deviation: the execution store

`src/server/agent/runtime/store.ts` is a process-local `Map`, and **it violates the
second rule above**. This is recorded rather than glossed over.

The reason is that there is nowhere else to put it. The persistence phase has not been
built, and Phase 3 was scoped to the engine rather than to storage; the alternative was
to build a database, which is different work.

The consequences, stated plainly:

- A stored execution is visible only from the process that ran it. It does not survive
  a restart and is not shared between instances.
- On a serverless deployment, a later request may reach an instance that has never heard
  of the execution it is asking about. Those reads return `404` rather than
  reconstructing an answer, because reconstructing one would mean inventing it.
- Retention is bounded to 50 executions, oldest evicted first, so the worst case is a
  bounded amount of memory rather than a leak.

**Execution itself does not depend on the store.** A run completes inside the request
that started it and returns its full state, events and result in the response. The store
exists only so a recent run can be looked up again. Losing it degrades convenience, not
correctness.

Replacing it with a real repository is the intended fix. Its surface is three functions
with no callers reaching past them and no engine module importing it, so the swap is
contained.

No CI workflow exists yet. No deployment configuration is committed yet.

## 11. Research subsystem

**A layer on top of the engine, not a second engine.** This section is numbered 11 rather
than inserted after §7 because other documents refer to the existing sections by number,
and renumbering them to make room would break those references for no gain. The
dependency order is: §5 engine → §7 tools → here.

§26 of the Phase 5 brief forbids re-implementing anything Phase 3 or Phase 4 already
provides, so the import list *is* the design:

| Research needs | Comes from | Not built here |
| --- | --- | --- |
| Planning a question into tasks | `ModelProvider`, `parseModelJson` | a second model client |
| Calling retrieval | `ToolExecutor`, `ToolRegistry`, `ToolPermission` | a second tool pipeline |
| Progress and state | `EventLog`, `ExecutionStateBuilder` | a second event or state system |
| Structured failure | `AgentExecutionError`, `toAgentExecutionError` | a second error vocabulary |
| Identifiers | `createId` | a second id scheme |

**The shape, in one pass.** A question goes in. The planner turns it into Zod-validated
retrieval tasks. Each task calls one tool through the Phase 4 executor, which checks the
run's permission, validates the input, calls the `ResearchProvider` behind the tool, and
returns a receipt. Retrieved sources are normalised, deduplicated, and the model provider
is asked what they establish — quoting them. A deterministic evaluator judges whether
that is enough, and everything comes back as one `ResearchRecord`.

Four decisions are worth stating because they are the ones a reader would otherwise have
to infer.

**A finding is a claim plus a quote.** §12 forbids inventing facts the sources do not
support, and prose cannot enforce that, so `ResearchFinding` carries the passage it rests
on and `verifyQuote` checks it against the retrieved text — normalised for NFKC, folded
for typographic variants, whitespace collapsed, lowercased. A quote that does not verify
downgrades the finding to `basis: "model"` and strips its evidence rather than rejecting
the claim. The claim is kept and labelled, which is more useful than losing it and more
honest than pretending it was sourced.

**Evidence is the link, and the link must not break.** `Source → Evidence → Finding` is
enforced by an alias map: when a duplicate URL is collapsed, citations of the discarded
id are rewritten to the kept one. Without it, deduplication would silently orphan
findings — the run would report evidence for a source it no longer holds, and the
traceability §13 requires would be quietly false.

**The one widened tool grant lives in one file.** `research/permission.ts` holds
`RESEARCH_TOOL_PERMISSION = ToolPermission.only("read_only", "network")`.
`DEFAULT_TOOL_PERMISSION` is unchanged at `read_only`, so every agent run, every test
that constructs an executor without arguments, and `/api/tools` report exactly what they
reported in Phase 4. Research reaches the network by constructing an executor with the
widened grant, which is a visible act in one place rather than a default nobody sees.

**`resolveResearchProvider()` names one host, deliberately.** It returns the web-search
adapter when `LLM_ENDPOINT` is on `openrouter.ai`, and the development adapter otherwise
— including for every other OpenAI-compatible endpoint. The narrowness is the design, not
a missing case: `LLM_API_STYLE=openai` covers Groq, Together, vLLM, LM Studio and OpenAI
itself, all of which speak `/chat/completions` and none of which has a `web` plugin. A
plugin sent to one of those would be dropped, the model would answer from its own weights,
and the run would be configured, would be reached, and would retrieve nothing. So the
endpoint decides, `isConfigured` follows, and a run against anything else stops at
`search_not_configured` with a message naming what to change.

**Two properties make the adapter safe without a verified live call.** It never reads the
model's prose — only `url_citation` annotations become sources — so an endpoint that
ignores the plugin cannot put generated text, or a URL inside generated text, into a
finding as though it were retrieved. And a response carrying no citations reports
`performedRetrieval: false`, because "found nothing" and "never looked" are
indistinguishable from the client and only one of those readings can fabricate evidence.
Both are asserted in `research/provider/openrouter-search-provider.test.ts`.

**Security.** Orion does not dereference a source URL in this phase, so `url-safety.ts`
is a recording and rendering guard rather than a fetcher's guard. It rejects dangerous
schemes, credentials in the authority, and internal or private destinations — including
loopback, RFC 1918, link-local, CGNAT, IPv6 unique-local and link-local, and the
alternative encodings that reach the same addresses (`2130706433`, `0x7f.1`, `127.1`,
`[::ffff:127.0.0.1]`). The order is load-bearing: the URL is parsed by `new URL` *before*
it is inspected, so a parser and a checker cannot disagree about what a string means. A
rejected URL is counted and dropped, never repaired, because a stripped credential is
still a source nobody should have been sent to. See `docs/RESEARCH.md` §Security.

**A second known deviation, of the same kind as §10.** `research/store.ts` is a
process-local `Map` with a 20-record bound, for exactly the reasons §10 records: the
persistence phase has not been built. It is a container, not a second state system — a
run's progress goes through `ExecutionStateBuilder` and `EventLog`. A read that misses
returns `404` rather than reconstructing a record, because reconstructing one would mean
inventing research nobody carried out.

**What is deliberately absent.** No long-term memory, no vector store, no embeddings, no
scheduled or background runs, and no cross-run cache of retrieved sources. §20 requires
that, and it is also what keeps a research run's result reproducible from its own record.

