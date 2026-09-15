# Orion

**Autonomous AI Research Agent.**

Orion turns complex goals into structured, researched, actionable results. The
intended workflow — understand an objective, plan the work, select tools,
execute, observe, evaluate, and revise — is now real up to the point where
external research and a real model are needed.

> **Phase 4 is the tool system.** The engine runs end to end and now calls real
> tools: it plans an objective, executes the plan, evaluates the outcome and
> returns a structured result. What backs it is still deliberately thin — a
> **deterministic development adapter** instead of a real model, and a
> **catalogue holding one read-only tool** — so there is **no external research,
> browsing, scraping, or any tool that reaches outside the process**. See
> [Not implemented](#not-implemented).

## Documentation

| Document | What it covers |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The shape of the system — frontend, backend, database boundary, and the agent engine, model abstraction, tool system and memory |
| [`docs/TOOL_SYSTEM.md`](docs/TOOL_SYSTEM.md) | The tool layer in full — vocabulary, registry, executor, permissions, receipts, and how to add a tool |
| [`docs/DEVELOPMENT_PHASES.md`](docs/DEVELOPMENT_PHASES.md) | The phase roadmap, what each phase depends on, what is done, and the gates every phase must pass |

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js (App Router) + React, TypeScript throughout |
| Styling | Tailwind CSS v4 + shadcn/ui primitives |
| Database | Supabase / PostgreSQL |
| Validation | Zod |
| Testing | Vitest |

The model provider is **still not chosen**. No provider SDK is a dependency and
no vendor is named in the engine — the engine talks to a `ModelProvider`
interface, and the one adapter that exists is deterministic and local. Choosing
a vendor later means adding a module and a case in `resolveModelProvider`.

## Setup

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run dev
```

The dev server runs on <http://localhost:3000>. Orion renders without Supabase
configured; only the features that need a database will report that it is
missing. **The agent engine runs with no credentials at all** — that is the
default configuration, not a degraded one.

Requires Node 20.9 or later (Next.js 16's minimum). No version is pinned in
`package.json`, so add an `engines` field or `.nvmrc` if you need one.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |

There is no CI workflow yet. Run `npm run typecheck && npm test && npm run build`
before pushing.

## Layout

```
src/
  app/                    routes (App Router)
    api/health/           liveness endpoint — the API convention in miniature
    api/agent/            executions (POST, GET), executions/[id] (GET), capabilities
    api/tools/            the registered tool catalogue (GET) — metadata only
    (app)/                the application surface (shell + sidebar)
    layout.tsx            root layout: shell + metadata
    page.tsx              landing page
    loading.tsx error.tsx not-found.tsx
  components/
    common/               EmptyState, PageHeader, StatusIndicator
    layout/               app chrome (shells, sidebar, navigation)
    ui/                   shadcn/ui primitives
    workspace/            objective form, execution / activity / results panels
    projects/ research/ reports/   per-domain cards, still empty states
  lib/
    env.ts                the only place environment variables are read
    supabase/             browser and server Supabase clients
    validation/           Zod schemas
    utils.ts              cn()
  server/
    http.ts               request body reading + error-to-response mapping
    errors.ts             ServiceError — carries an HTTP status
    agent/                the agent engine (see below)
    services/             business logic
  types/
    agent.ts              domain vocabulary for the agent system
```

### The agent engine

```
src/server/agent/
  provider/     ModelProvider interface, the development adapter, a scripted test one
  planner/      objective → validated plan (Zod, plus a dependency-graph check)
  executor/     walks the plan, records observations, calls tools through the tool layer
  tools/        the tool system — definitions, registry, executor, catalogue
  evaluator/    computes the verdict deterministically, requests a narrative
  runtime/      state builder, append-only event log, process-local store, the runner
  errors.ts     AgentEngineError — an engine failure with a machine-readable code
```

The lifecycle is assembled in `runtime/runner.ts`, which **never throws**: a
failed run comes back as an execution with `status: "failed"` and structured
errors attached. One failed step does not abort the run — dependent steps are
skipped and independent branches continue. A failed **tool call** fails its step
for the same reason, and is recorded as a receipt either way.

### The tool system

```
src/server/agent/tools/
  definition.ts   ToolDefinition, ToolExecutionContext, ToolReceipt, ToolPermission
  registry.ts     register / get / has / list / canExecute
  executor.ts     the only sanctioned way to call a tool
  catalog.ts      the one file that decides which tools a run can call
  builtin/        the tools that ship — currently text-analysis.ts
```

Every call goes through `ToolExecutor`, which resolves the tool, checks the
run's permission **before** validating the input, validates the input against
the tool's schema, executes, and returns a **receipt** — always, including when
the call failed. **Deny by default**: a run is granted `read_only` and nothing
else, and a tool needing more is refused until someone widens the grant on
purpose. A tool receives its validated input and a small execution context, and
nothing else — no filesystem, shell, environment or database handle.

[`docs/TOOL_SYSTEM.md`](docs/TOOL_SYSTEM.md) documents the layer in full,
including the seven steps for adding a tool.

### Conventions

**Route Handlers stay thin.** A handler in `src/app/api/**/route.ts` parses and
validates the request, calls a service, and shapes the HTTP response. It holds
no business logic and makes no direct database calls.

**Business logic lives in `src/server/services/**`.** Services take plain
arguments and return plain data. They must not import React, `next/headers`, or
anything from `src/components`, which is what keeps them callable from a Route
Handler, a Server Action or a test without a request in scope. Failures are
signalled by throwing `ServiceError` with a status.

**Supabase clients own connectivity only.** `src/lib/supabase/client.ts` is for
the browser and `server.ts` for Server Components, Server Actions and Route
Handlers. Server code must never import the browser client, and client code must
never import the server one — `next/headers` does not exist in a browser.

**Environment is read in one place.** `src/lib/env.ts` validates and returns
configuration. A missing variable throws a message that names it, instead of
failing as an obscure error deeper inside a client. `NEXT_PUBLIC_*` values are
inlined at build time, so they are only read via literal `process.env.X`
property accesses — a computed lookup is not replaced in client code. The model
credential is read here and **nowhere else**: `getModelProviderConfig` returns
whether a key is present, never its value, so no code path can put it in a
response body, an error message or a log line.

**Types describe shape, not behaviour.** `src/types/agent.ts` holds `Agent`,
`AgentTask`, `TaskStatus`, `TaskStep`, `Tool`, `ToolExecution` and `AgentResult`,
plus the execution vocabulary Phase 3 added — `StepStatus`, `ExecutionStatus`,
`Observation`, `ExecutionState`, `AgentEvent`, `AgentExecution`,
`AgentExecutionError` and `EngineCapabilities` — and the tool vocabulary Phase 4
added: `ToolCapability`, `ToolInput`, `ToolOutput`, `ToolExecutionStatus` and
`ToolCatalog`. Timestamps are ISO 8601 strings so every type survives a JSON
round-trip. Prefer adding optional fields or new union members over changing
existing ones. Anything holding a function or a Zod schema — a `ToolDefinition`,
say — belongs beside the code that uses it, not here, because it cannot survive
that round-trip.

**The client cannot assert that work was done.** No endpoint accepts a status,
a step list or a result. A run's status is computed by the evaluator from what
the steps actually did, and unknown keys in a request body are stripped before
the engine sees them.

## Testing

`npm test` runs Vitest in a `node` environment. The engine is tested at two
levels: units (plan validation, the adapter's determinism, the tool registry, the
tool executor's pipeline, the text analysis rules, error conversion, the store's
bound) and integration (`runtime/runner.test.ts` drives the whole lifecycle
against a *scripted* provider — cancellation, a failing step, an unavailable
capability, a tool-backed step end to end, a failed tool, a refused permission,
rejected tool input, planner failure, provider misconfiguration).

**No test needs network access or an API key**, and the suite passes with no
credentials present. There is still no component-render or end-to-end browser
layer, so CSS, layout and client interactivity are unverified by tests.

Tests import `describe`/`it`/`expect` explicitly rather than relying on globals,
and the `@/` path alias resolves in tests via `vitest.config.ts`.

## Environment

See `.env.example`. Only `NEXT_PUBLIC_*` variables reach the browser; no secret
should ever carry that prefix. `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level
Security and is server-only — it is documented but not yet read by any code.

The engine's own variables are provider-neutral and live rather than reserved:

```
ORION_LLM_PROVIDER=   # "dev" (default). Any other value fails loudly.
ORION_LLM_API_KEY=
ORION_LLM_MODEL=
ORION_LLM_BASE_URL=
```

## Not implemented

Everything below belongs to later phases and is deliberately absent. None of it
should be described as working:

- **External model calls** — the only adapter is the deterministic development
  one. It performs no inference and contacts nothing, and every result says so.
- **Tools that reach outside the process** — the catalogue holds exactly one tool,
  `text.analyze`, which counts characters, words, sentences and paragraphs in text
  it was given. There is no web search, browser automation, scraping, external API,
  shell, code execution, filesystem or database access. A step needing an external
  capability fails with `capability_unavailable` rather than returning invented
  findings. There is also no tool timeout, and a step makes at most one tool call.
- **Research** — no web search, browsing, scraping, email or social integration.
- **Memory and reports** — no long-term memory, no vector store, and no report
  generation. Task state is not memory.
- **Background execution** — a run completes inside the request that started it.
  No scheduler, no queue, no workers, no multi-agent collaboration.
- **Authentication and the database schema** — the Supabase clients and the
  conventions for using them exist; no tables, migrations, policies or auth flow
  do. **Executions are stored in process memory only**, so they do not survive a
  restart and are not shared between instances; a read after a restart returns
  `404` rather than reconstructing an answer. This is a known deviation,
  recorded with its consequences in `docs/ARCHITECTURE.md` §10.

The workspace's `Start Agent` button runs the real engine and renders what it
returns. It does not simulate progress.

## History

This repository previously held a Python CLI DeFi scoring agent. It was replaced
by this application in a later commit; the previous code remains recoverable in
the repository history.
