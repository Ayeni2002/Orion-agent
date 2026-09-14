# Orion

**Autonomous AI Research Agent.**

Orion turns complex goals into structured, researched, actionable results. The
intended workflow — understand an objective, plan the work, select tools,
execute, observe, evaluate, and revise — is the direction of the project, not
something this phase implements.

> **Phase 1 is the foundation only.** There is no agent engine, no planner, no
> tool runtime, no model provider, no research, no reports and no memory. The
> workspace collects an objective and stops. See [Not implemented](#not-implemented).

## Documentation

| Document | What it covers |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The intended shape of the system — frontend, backend, database boundary, and the agent engine, model abstraction, tool system and memory that later phases add |
| [`docs/DEVELOPMENT_PHASES.md`](docs/DEVELOPMENT_PHASES.md) | The eight-phase roadmap, what each phase depends on, and the gates every phase must pass |

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js (App Router) + React, TypeScript throughout |
| Styling | Tailwind CSS v4 + shadcn/ui primitives |
| Database | Supabase / PostgreSQL |
| Validation | Zod |
| Testing | Vitest |

The model provider is intentionally **not** chosen yet. No provider SDK is a
dependency, no provider is hard-coded, and the environment variable names are
provider-neutral — so the agent engine can be added without rewriting the app
around one vendor.

## Setup

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run dev
```

The dev server runs on <http://localhost:3000>. Orion renders without Supabase
configured; only the features that need a database will report that it is
missing.

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
    api/health/route.ts   liveness endpoint — the API convention in miniature
    layout.tsx            root layout: shell + metadata
    page.tsx              landing page
    workspace/page.tsx    workspace shell
    loading.tsx error.tsx not-found.tsx
    globals.css           Tailwind v4 import + design tokens
  components/
    layout/               app chrome (header, shell)
    ui/                   shadcn/ui primitives
    workspace/            workspace-specific components
  lib/
    env.ts                the only place environment variables are read
    supabase/             browser and server Supabase clients
    validation/           Zod schemas
    utils.ts              cn()
  server/
    errors.ts             ServiceError — carries an HTTP status
    services/             business logic
  types/
    agent.ts              domain vocabulary for the agent system
```

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
property accesses — a computed lookup is not replaced in client code.

**Types describe shape, not behaviour.** `src/types/agent.ts` holds `Agent`,
`AgentTask`, `TaskStatus`, `TaskStep`, `Tool`, `ToolExecution` and `AgentResult`.
Timestamps are ISO 8601 strings so every type survives a JSON round-trip. Prefer
adding optional fields or new union members over changing existing ones.

## Testing

`npm test` runs Vitest in a `node` environment. Coverage is deliberately small
and covers only code that exists: an objective-validation test and a test for
the system service behind `/api/health`. There is no component-render or
end-to-end layer yet.

Tests import `describe`/`it`/`expect` explicitly rather than relying on globals,
and the `@/` path alias resolves in tests via `vitest.config.ts`.

## Environment

See `.env.example`. Only `NEXT_PUBLIC_*` variables reach the browser; no secret
should ever carry that prefix. `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level
Security and is server-only — it is documented but not yet read by any code.

## Not implemented

Everything below belongs to later phases and is deliberately absent:

- **Agent engine** — no planner, executor, scheduler, or observe/evaluate loop.
- **Model provider** — no provider client, no SDK, no prompt layer.
- **Tools** — no tool registry or tool runtime.
- **Research, reports, memory** — no retrieval, no report generation, no state
  that persists between runs.
- **Authentication and the database schema** — the Supabase clients and the
  conventions for using them exist; no tables, migrations, policies or auth flow
  do. The workspace does not save anything.

The `Start Agent` button validates the objective and reports that the engine is
not implemented. It does not simulate progress, and no result is stored.

## History

This repository previously held a Python CLI DeFi scoring agent. It was replaced
by this application in a later commit; the previous code remains recoverable in
the repository history.
