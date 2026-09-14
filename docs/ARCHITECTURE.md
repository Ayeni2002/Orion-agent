# Orion — Architecture

> **Status: Phase 1 (Foundation).** The agent engine, model provider, tool runtime,
> research layer, report generation and memory described below under *future* **do
> not exist**. This document records the intended shape of the system so that later
> phases extend what is here rather than restructure it.
>
> Read this alongside [`DEVELOPMENT_PHASES.md`](./DEVELOPMENT_PHASES.md), which says
> which phase builds which part.

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
  layout/          application chrome (header, shell)
  ui/              shadcn/ui primitives — presentation only
  workspace/       workspace-specific composition
```

**Server Components are the default.** A component becomes a Client Component
(`"use client"`) only when it needs state, effects, or browser APIs — for example
`src/components/workspace/objective-form.tsx`, which owns form state.

**Route-level states are first-class**, not an afterthought: `loading.tsx`,
`error.tsx` and `not-found.tsx` sit beside the routes they cover, so every route has
a defined loading and failure appearance without per-component handling.

**The UI never reaches for data directly.** Components receive plain data as props or
call a service. In Phase 1 the only such boundary is the health endpoint; the pattern
is what matters, not the current surface area.

## 3. Backend architecture

```
src/app/api/**/route.ts     thin HTTP handlers
src/server/services/**      business logic
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

**Intended future schema** (Phase 2+, not created): users, projects, agent tasks,
task steps, tool executions, research artefacts, reports, agent state. The domain
types in `src/types/agent.ts` are the vocabulary those tables will be shaped around —
which is why they exist before the database does.

## 5. Future agent engine

**Not implemented.** No planner, executor, scheduler, or observe/evaluate loop exists.

The intended workflow — the reason the project exists — is:

```
goal → understand → plan → select tools → execute → observe → evaluate
     → continue or revise → structured final result
```

Where it will live: `src/server/agent/` (reserved, not created). It belongs on the
server because it orchestrates model calls and tool execution; the browser observes it.

The engine will consume and produce the Phase 1 types in `src/types/agent.ts` —
`Agent`, `AgentTask`, `TaskStatus`, `TaskStep`, `Tool`, `ToolExecution`, `AgentResult`.
Those types were defined first, deliberately, so the engine is written against a stable
vocabulary instead of inventing one mid-implementation.

**The evaluate step is a first-class stage**, not a retry wrapper. Orion is intended to
judge whether a result answers the objective, and revise the plan when it does not.

## 6. Model abstraction

**Not implemented.** No provider SDK is a dependency and no provider is hard-coded.

The model layer will be configuration, not code — the same discipline already applied
to the database. `.env.example` already reserves provider-neutral names:

```
ORION_LLM_API_KEY=
ORION_LLM_MODEL=
ORION_LLM_BASE_URL=
```

These are commented out because nothing reads them yet; they are listed so the names
are not invented ad hoc later.

**The engine talks to an interface, not a vendor.** The intended shape is a single
`ModelProvider` interface — given a prompt and a tool catalogue, return either text or
a tool call — with per-vendor adapters behind it. Selecting a provider is then an
environment change, not a code change.

**Why this is constrained now:** coupling the engine to one vendor's SDK, message
format, and tool-call schema is the most expensive mistake available in this project,
because it leaks into the planner, the executor, and every tool. The rule for Phase 1
is simply that no such dependency may be introduced.

## 7. Tool system

**Not implemented.** No tool registry, no tool runtime, no built-in tools.

A tool is intended to be a named capability the agent may select: a description, an
input schema, and an execution function. The `Tool` type in `src/types/agent.ts` is
deliberately loose (`inputSchema` is a `Record<string, unknown>` in Phase 1) because
nothing consumes it yet and a premature schema would be guessed rather than derived.

Two intended constraints, recorded now because they shape the design:

- **Tools are declared, not hard-coded into the planner.** The planner selects from a
  registry; adding a tool must not mean editing the planning logic.
- **Tool execution is recorded.** `ToolExecution` exists so a run can be explained
  after the fact — what was called, with what input, and what came back.

## 8. Future memory/state layer

**Not implemented.** No retrieval, no persistence between runs.

Phase 1 holds no agent state at all: the workspace collects an objective and stops.
The distinction the later design must respect:

- **Task state** — the live status of a run (status, steps, executions). This is
  `AgentTask` and friends, and is what the workspace will observe.
- **Long-term memory** — what Orion retains across runs so it does not rediscover the
  same things. This has no representation in Phase 1, and it should not be conflated
  with task state.

Both will live in PostgreSQL behind services, not in the client and not in process
memory, so a run survives a restart.

## 9. Testing strategy

Vitest, `node` environment, no globals — tests import `describe`/`it`/`expect`
explicitly. The `@/` path alias resolves in tests via `vitest.config.ts`.

Coverage is deliberately small and covers **only code that exists**: objective
validation, and the service behind `/api/health`. There is no component-render layer
and no end-to-end layer yet.

The convention that matters as the project grows:

- **Services are the natural unit of test.** They are framework-free by design, so
  they test without a request, a database, or a rendered tree.
- **External calls get mocked at the boundary.** No test should require network access
  or a live Supabase project.
- **Do not write tests ahead of the implementation.** A test for a phase that has not
  been built asserts a design that does not exist yet and will be rewritten.

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

No CI workflow exists yet. No deployment configuration is committed yet.
