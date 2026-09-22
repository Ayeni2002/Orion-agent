# Orion

**Autonomous AI Research Agent.**

Orion turns complex goals into structured, researched, actionable results. The
intended workflow — understand an objective, plan the work, select tools,
execute, observe, evaluate, and revise — is real, and so is the research layer
above it: a question is planned into retrieval tasks, searched, deduplicated,
read for findings, and returned with the evidence behind every claim that has
any. Retrieval is real too, when it is configured, and there are two routes to
it: point `LLM_ENDPOINT` at OpenRouter and a question comes back with sources and
quotes, or set `LLM_API_STYLE=gemini` and it comes back with the pages Google
Search grounding found. Point an OpenAI-compatible endpoint anywhere else and the
provider says it cannot search rather than pretending it looked.

> **Phase 5 is research intelligence.** A question can be planned into retrieval
> tasks, searched, normalised, deduplicated, read for findings, evaluated and
> returned as a structured record in which every claim that rests on a source
> carries the passage it rests on. Set `LLM_API_STYLE=openai` with
> `LLM_ENDPOINT=https://openrouter.ai/api/v1`, or `LLM_API_STYLE=gemini`, and
> retrieval is on; leave it unset and the deterministic development adapter
> reports itself as unconfigured, so a research run stops with
> `search_not_configured` before it plans anything rather than appearing to
> search. See [Not implemented](#not-implemented).

## Documentation

| Document | What it covers |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The shape of the system — frontend, backend, database boundary, and the agent engine, model abstraction, tool system, memory and research layer |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | The research layer in full — the run, the provider seam, the planner, findings and evidence, conflicts, the evaluator, limits, the API, and the security review |
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

The model provider is **configuration, not a dependency**. No provider SDK is
installed and no vendor is named in the engine — the engine talks to a
`ModelProvider` interface, and three adapters implement it: a deterministic local
one, one that speaks the OpenAI-compatible `/chat/completions` protocol (which is
how OpenRouter, Groq, Together, vLLM, LM Studio and OpenAI itself are all
reached), and one that speaks Google's native `generateContent`. Choosing a
vendor is a matter of setting `LLM_API_STYLE`, `LLM_ENDPOINT` and `LLM_MODEL` —
though `gemini` fills in its own endpoint, being one vendor at one host.

**The default is the deterministic adapter**, because the default must be a
configuration that works with no credentials at all.

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
    api/research/         research (POST, GET), research/capabilities (GET)
    (app)/                the application surface (shell + sidebar)
    layout.tsx            root layout: shell + metadata
    page.tsx              landing page
    loading.tsx error.tsx not-found.tsx
  components/
    common/               EmptyState, PageHeader, StatusIndicator
    layout/               app chrome (shells, sidebar, navigation)
    ui/                   shadcn/ui primitives
    workspace/            objective form, execution / activity / results panels
    research/             question form, research console, panel, result card
    projects/ reports/    per-domain cards, still empty states
  lib/
    env.ts                the only place environment variables are read
    supabase/             browser and server Supabase clients
    validation/           Zod schemas
    utils.ts              cn()
  server/
    http.ts               request body reading + error-to-response mapping
    errors.ts             ServiceError — carries an HTTP status
    agent/                the agent engine (see below)
    research/             the research layer (see below)
    services/             business logic
  types/
    agent.ts              domain vocabulary for the agent system
    research.ts           domain vocabulary for the research system
```

### The agent engine

```
src/server/agent/
  provider/     ModelProvider interface, the OpenAI-compatible and native Gemini
                adapters, the shared prompts, the development adapter and a
                scripted test one
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

### The research layer

```
src/server/research/
  provider/     ResearchProvider interface, the OpenRouter and Gemini
                retrieval adapters, the development adapter, a scripted test one
  planner/      question → validated retrieval tasks (Zod, plus a duplicate-query check)
  tools/        research.search — the only tool in Orion that declares `network`
  findings/     source text → claims, each with the passage it rests on
  evaluator/    sufficient | insufficient | conflicting | failed, from the facts alone
  normalize.ts  canonicalisation and deduplication, with an alias map
  url-safety.ts URL vetting — schemes, credentials, internal destinations
  permission.ts the one widened tool grant, in a file of its own so it is findable
  service.ts    the run loop
  store.ts      process-local, bounded, and a known deviation (ARCHITECTURE.md §11)
```

It is **a layer on the engine, not a second one**. Planning goes through the
Phase 3 `ModelProvider`; retrieval goes through the Phase 4 `ToolExecutor`;
progress goes through `EventLog` and `ExecutionStateBuilder`; failures go
through `AgentExecutionError`. The import list is the design.

**A finding is a claim plus a quote.** §12 of the brief forbids inventing facts
the sources do not support, and prose cannot enforce that — so every attributed
claim carries the passage it rests on, and the quote is checked against the
retrieved text. A quote that does not verify **demotes** the claim to
`basis: "model"` rather than being accepted or discarded: the claim is kept and
labelled, which is more useful than losing it and more honest than pretending it
was sourced.

**Retrieval is deny-by-default like everything else.** `research.search` declares
`network`, the default grant is `read_only`, and only the research service
constructs an executor with the widened grant. `/api/tools` does not list it.

[`docs/RESEARCH.md`](docs/RESEARCH.md) documents the layer in full, including
what is deliberately not built.

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
`ToolCatalog`. `src/types/research.ts` holds the research vocabulary Phase 5
added, on the same terms. Timestamps are ISO 8601 strings so every type survives
a JSON round-trip. Prefer adding optional fields or new union members over
changing existing ones. Anything holding a function or a Zod schema — a
`ToolDefinition`, a `ResearchProvider`, say — belongs beside the code that uses
it, not here, because it cannot survive that round-trip. That is why
`src/types/research.ts` has no schema in it and `research/provider/provider.ts`
has one.

**The client cannot assert that work was done.** No endpoint accepts a status,
a step list, a finding, a source or a result. A run's status is computed by the
evaluator from what the steps actually did, unknown keys in a request body are
stripped before the engine sees them, and a research request is reduced to
`{ question }` — so a client cannot manufacture evidence, and a finding is a
claim with a URL behind it.

## Testing

`npm test` runs Vitest in a `node` environment. The engine is tested at two
levels: units (plan validation, the adapter's determinism, the tool registry, the
tool executor's pipeline, the text analysis rules, error conversion, the store's
bound) and integration (`runtime/runner.test.ts` drives the whole lifecycle
against a *scripted* provider — cancellation, a failing step, an unavailable
capability, a tool-backed step end to end, a failed tool, a refused permission,
rejected tool input, planner failure, provider misconfiguration).

The research layer is tested the same way. `research/service.test.ts` drives the
real planner, registry, executor, normaliser, extractor and evaluator against
scripted providers — cancellation, every limit, deduplication, conflicts, an
untraceable quote, a failing step, a provider that cannot plan. Around it sit
focused files for URL safety, normalisation, the plan contract, the quote check,
the search tool, both retrieval adapters, the provider resolver and the
evaluator, plus the service layer, both API routes and the request schema.

**No test needs network access or an API key**, and the suite passes with no
credentials present. Every remote call is stubbed at `fetch`, and
`vitest.setup.ts` clears the provider environment before each test file — so the
suite behaves identically in CI, on a fresh checkout, and on a machine that has
`LLM_API_STYLE` exported in its shell. There is still no component-render or
end-to-end browser layer, so CSS, layout and client interactivity are unverified
by tests.

Tests import `describe`/`it`/`expect` explicitly rather than relying on globals,
and the `@/` path alias resolves in tests via `vitest.config.ts`.

## Environment

See `.env.example`. Only `NEXT_PUBLIC_*` variables reach the browser; no secret
should ever carry that prefix. `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level
Security and is server-only — it is documented but not yet read by any code.

The AI provider is configured by wire protocol rather than by vendor, and every
value is read in `src/lib/env.ts` and nowhere else:

```
LLM_API_STYLE=        # "dev" (default) | "openai" | "gemini"
LLM_ENDPOINT=         # base URL; optional for "gemini", required for "openai"
LLM_MODEL=            # the endpoint's own model id, e.g. openai/gpt-4o
LLM_API_KEY=          # optional for "openai" — a local endpoint needs none;
                      # "gemini" requires one
```

`LLM_API_STYLE=dev` needs none of the other three and reaches nothing. Any other
style is rejected unless it is one an adapter exists for, because naming a style
Orion cannot construct would turn a configuration mistake into a run that appears
to use a real model and does not.

**Retrieval turns on with the configuration, and there are two configurations
that do it.** One is `LLM_ENDPOINT` on `openrouter.ai`, whose `web` plugin is one
of the two routes this build knows how to ask:

```
LLM_API_STYLE=openai
LLM_ENDPOINT=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o
LLM_API_KEY=<your key>
```

The other is the Gemini style, whose Google Search grounding is a `tools` entry
on the same `generateContent` call. One key, one endpoint, and `LLM_ENDPOINT` is
not needed because the style supplies Google's:

```
LLM_API_STYLE=gemini
LLM_MODEL=<a current id, e.g. gemini-2.5-flash>
LLM_API_KEY=<your Google AI Studio key>
```

There is no research endpoint and no research credential for either: retrieval
borrows the same two variables as planning. The two differ in what they return,
and the difference is a property of the providers rather than of Orion.
OpenRouter's citations carry the passage, so findings from that route quote their
sources. Google's grounding returns the pages a search found but **not their
text**, so sources from that route carry a URL and a title and no passage — and a
run's findings say it could not quote them rather than quoting something a page
never contained. Neither route invents evidence where it has none; the Gemini one
is the thinner of the two.

Any *other* OpenAI-compatible endpoint — Groq, Together, vLLM, LM Studio, a local
server — speaks the same protocol but has no such plugin, so it resolves to the
development adapter and a run stops at `search_not_configured` rather than
sending a plugin the endpoint would silently drop. `RESEARCH_SEARCH_MODEL`
optionally names a cheaper model for fetching; it defaults to `LLM_MODEL`, and it
means the same thing for both routes.

The research limits are Phase 5's, and each one bounds a loop over a metered
endpoint. Leaving them all unset gives 5 tasks, 5 sources per task, 20 sources,
50 findings and a 120-second ceiling:

```
RESEARCH_MAX_TASKS=5
RESEARCH_MAX_SOURCES_PER_TASK=5
RESEARCH_MAX_SOURCES=20
RESEARCH_MAX_FINDINGS=50
RESEARCH_MAX_DURATION_MS=120000
```

A malformed limit throws rather than falling back to the default: an operator who
typed `RESEARCH_MAX_SOURCES=abc` and silently got 20 would believe they had set a
ceiling they had not.

## Not implemented

Everything below belongs to later phases and is deliberately absent. None of it
should be described as working:

- **Retrieval against an unverified service.** The `ResearchProvider` seam, the
  search tool, both retrieval adapters — OpenRouter's web plugin and Gemini's
  Google Search grounding — the planner, the extraction, the evaluator and the
  API are all built and tested against a stubbed transport. What no test can
  establish is that a given account and model honour either route, because a
  test that reached the real endpoint would fail on a plane, in CI, and the day
  a key is rotated. Two properties make that safe rather than hopeful: neither
  adapter ever reads the model's prose, only its citations or its grounding
  chunks, and a response carrying neither reports `performedRetrieval: false`.
  An endpoint that silently ignores the plugin, or an account without grounding,
  therefore yields an honest `insufficient` result and cannot put generated text
  into a finding as though it were retrieved. `.env.example` and
  `docs/RESEARCH.md` carry the two `curl` commands that confirm each route
  against a live account. The Gemini route is the one that is additionally
  **unwritten-from-observation** — its `groundingMetadata` shape was taken from
  documentation, so the same fail-safe is what makes shipping it before the live
  check defensible rather than reckless.
- **Search through an endpoint this build has no adapter for.** Two routes exist
  and both are narrow — OpenRouter by host, Gemini by style. `resolveResearchProvider`
  refuses everything else, deliberately: see the environment section above.
- **Quoted findings from a Gemini-retrieved source.** Grounding returns the pages
  a search found and not their text, so those sources carry a URL and a title and
  no passage. Findings resting on them say so rather than quoting a sentence the
  page never contained. The OpenRouter route is the one that produces quoted
  findings.
- **URL fetching.** Orion records a source's URL and never dereferences it. There
  is no fetcher to abuse, and the vetting in `research/url-safety.ts` is written
  as though there were one.
- **An external model call by default.** The OpenAI-compatible adapter exists and
  works, but nothing is configured out of the box: the default is the
  deterministic local adapter, which performs no inference and contacts nothing,
  and every result says so.
- **Tools that reach outside the process.** The default catalogue holds exactly
  one tool, `text.analyze`. The one exception is `research.search`, which is
  registered per research run and never in the default catalogue, so an agent run
  still cannot reach the network. There is no browser automation, scraping,
  external API, shell, code execution, filesystem or database access from a tool,
  no tool timeout, and a step makes at most one tool call.
- **Memory and reports.** No long-term memory, no vector store, no embeddings, no
  cross-run cache of retrieved sources, and no report generation. Task state is
  not memory.
- **Background execution.** A run completes inside the request that started it.
  No scheduler, no queue, no workers, no multi-agent collaboration, and no
  cancel endpoint — `runResearch` accepts a cancellation callback that nothing
  above it can currently set.
- **Authentication and the database schema.** The Supabase clients and the
  conventions for using them exist; no tables, migrations, policies or auth flow
  do. **Executions and research records are stored in process memory only**, so
  they do not survive a restart and are not shared between instances; a read
  after a restart returns `404` rather than reconstructing an answer. This is a
  known deviation, recorded with its consequences in `docs/ARCHITECTURE.md` §10
  and §11.

The workspace's `Start Agent` button runs the real engine and renders what it
returns, and the research form posts to the real endpoint and renders the record
that comes back. Neither simulates progress, and neither shows a step the engine
did not take.

## History

This repository previously held a Python CLI DeFi scoring agent. It was replaced
by this application in a later commit; the previous code remains recoverable in
the repository history.
