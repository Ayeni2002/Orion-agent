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
| 5 | Research intelligence | **Complete** |
| 6 | Reports & deliverables | **Complete** — was roadmapped as Phase 8 |
| 5R | Database & persistence | Not started — was roadmapped as Phase 5 |
| 6R | Real model provider | Partly delivered by Phase 5; see below |
| 7 | Memory & state | Not started |
| 8 | Reports & delivery | Displaced by Phase 6; see below |
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
  adapter arrived in Phase 5; see the note under Phase 6R.
- The original **Phase 4 (Tool system)** was built as Phase 4, against the registry seam
  Phase 3 left in place. That seam turned out to need *evolving* rather than filling:
  Phase 3's `AgentTool` and `executor/registry.ts` were replaced by the fuller
  `ToolDefinition` and `tools/registry.ts`, and the old registry was deleted rather than
  kept alongside. See the Phase 4 section for why.
- The database moved after the engine. Task state is currently held in process memory,
  which `ARCHITECTURE.md` §10 records as a known deviation with its consequences.

### Why Phase 5 is research, not the database

The work in this phase was directed by a Phase 5 brief for a **research intelligence**
layer, not by the roadmap's Phase 5. That is the third divergence in this document, and
it is recorded rather than papered over.

Two things are true at once and both belong here:

- **The database did not get built.** Every deviation `ARCHITECTURE.md` §10 records is
  still in force, and Phase 5 added a *second* instance of it — `research/store.ts` is
  another process-local `Map`. Two stores now depend on a phase that has not happened.
- **The roadmap's Phase 6 partly arrived early.** "Real model provider" was Phase 6, and
  Phase 5 needed one: an OpenAI-compatible adapter now exists
  (`agent/provider/openai-provider.ts`), is selected by `LLM_API_STYLE=openai`, and is
  covered by tests. That is the roadmap's Phase 6 item, delivered as a dependency of
  Phase 5 rather than as its own phase.

What that leaves for Phase 6R is stated in that section. The practical consequence for
Phase 5R is that its urgency went **up**, not down: there is now more in process memory
than there was, and a serverless deployment loses all of it between requests.

Phase 5R keeps the roadmap's original content unchanged. It is retitled rather than
deleted because none of it was decided against — it was simply displaced.

### Why Phase 6 is reports, not the model provider

The work in this phase was directed by a Phase 6 brief for **reports and deliverables**,
not by the roadmap's Phase 6. That is the fourth divergence in this document, and it is
recorded in the same form as the previous three.

Two things are true at once and both belong here:

- **The roadmap's Phase 6 did not get built as its own phase.** "Real model provider" was
  partly delivered by Phase 5 — the OpenAI-compatible adapter exists and is selected by
  `LLM_API_STYLE=openai` — and Phase 6 added one member to its closed `ModelOperation`
  union (`"report"`) rather than building any of it. What remains is listed under
  **Phase 6R** below, unchanged.
- **The roadmap's Phase 8 arrived early.** "Reports & delivery" was Phase 8. Phase 6 of
  this brief asks for report generation, the workspace integration and a print view, all
  of which are now built. What Phase 8 still owns — delivery, export to a file format,
  and the databases and memory the roadmap's ordering assumed would exist by then — is
  noted in that section.

The reordering is again a finding rather than a correction. The roadmap put reports last
because it assumed reports would rest on persisted memory and a live model, and it was
right that they are more useful with both. What it underestimated is that a report can be
*better* without either: built from a research record that already carries verified
quotes and URLs, it is traceable by construction rather than by retrieval, and it is
generatable with no provider at all. The reports subsystem was therefore buildable
against the phase it actually needed — Phase 5 — instead of the two it was scheduled
after.

Two consequences follow, and the second is the one worth stating:

- **Phase 8 is displaced, not cancelled.** Its remaining content is delivery and export,
  and it now depends on Phase 6 rather than the other way round.
- **Phase 5 gained a field after it was complete.** `ResearchResult` gained
  `unresolvedQuestions: string[]`, populated from the extractor's own `gaps`. The value
  was already computed — it reached an event and one observation's `output` — and reading
  it back out of `observations[].output` would have been inspecting an internal shape,
  which is precisely what `Observation.source` and `Observation.toolId` were made
  first-class to avoid. Dropping it would have failed the brief's requirement that
  unresolved questions be preserved in a report. It is additive, it surfaces an existing
  value, and it adds no capability. **Recorded here rather than absorbed silently**,
  because §24 of the phase brief says not to expand the research engine and this does
  touch two Phase 5 files.

One change to a Phase 3 test is recorded for the same reason: `planner/index.test.ts`
holds a `Record<ModelOperation, number>` literal, so the new `"report"` member required
`report: 0` to be added. That is the closed union working as designed — the compiler named
every place that had to decide — and the change is mechanical rather than a rewrite of the
test's intent.

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

## Phase 5 — Research intelligence ✅

**Goal:** a question can be researched against real sources, and the result says what it
is worth — with the plan, the sources, the findings, the evidence and the disagreements
all traceable, and with nothing claimed that was not retrieved.

Delivered:

- **Research domain model** (`src/types/research.ts`) — `ResearchRequest`, `ResearchTask`,
  `ResearchSource`, `ResearchFinding`, `ResearchEvidence`, `ResearchConflict`,
  `ResearchResult`, `ResearchRecord`, `ResearchSummary`, `ResearchLimits`. JSON-safe
  vocabulary only; the executable half lives beside its implementation, as Phase 4
  established.
- **A dedicated research service** (`src/server/research/`) — planner, search tool,
  normaliser, finding extractor, evaluator, run loop, store and capability read. It is a
  layer on the engine, not a second one: planning goes through the Phase 3
  `ModelProvider`, retrieval through the Phase 4 `ToolExecutor`, progress through
  `EventLog` and `ExecutionStateBuilder`, failures through `AgentExecutionError`, and ids
  through `createId`. §26's boundary is enforced by the import list.
- **A research provider abstraction** (`research/provider/`) — `ResearchProvider` with
  `search`, a descriptor and `isConfigured`; a deterministic development adapter, a
  scripted test stub, and one resolution point. `performedRetrieval` is carried rather
  than inferred, so "searched and found nothing" is distinguishable from "did not search".
- **A real web research tool** (`research.search`) — the only tool in Orion that declares
  `network`. It vets every returned URL, re-derives the domain from the vetted URL,
  canonicalises, clamps the result count, truncates with a visible marker, and counts
  refusals separately from drops.
- **Registered through the Phase 4 tool registry** — in a per-run registry, never in the
  default catalogue, because the default is what `/api/tools` reports and what every
  agent run resolves against. `web.search` remains unregistered, so Phase 3's
  `capability_unavailable` path is still live behaviour.
- **Read-only network permissions, denied by default** — `RESEARCH_TOOL_PERMISSION` in a
  module of its own; `DEFAULT_TOOL_PERMISSION` unchanged. Permission is checked before
  input validation, so a refused tool never consumes untrusted input.
- **A research planner** — Zod-validated structured tasks rather than a paragraph, with a
  restatement, per-task queries bounded by the search tool's own contract, and a
  duplicate-query check that Zod cannot express. A plan that fails validation fails the
  run before anything is retrieved.
- **LLM integration through the existing `ModelProvider`** — two new operations,
  `research_plan` and `research_findings`. Model output is untrusted at every hop, and
  **the model never executes a tool**: it produces a plan and later finds words, and the
  engine decides what to call.
- **Free and development provider support** — `LLM_API_STYLE=dev` runs the whole path with
  no credential and no network, and the record says so. `RESEARCH_SEARCH_MODEL` names a
  cheaper retrieval model and is consumed by `resolveResearchProvider`; it defaults to
  `LLM_MODEL`.
- **A real retrieval adapter** — `research/provider/openrouter-search-provider.ts`, a chat
  completion carrying OpenRouter's `web` plugin, whose `url_citation` annotations become
  the run's sources. It is chosen only for an `LLM_ENDPOINT` on `openrouter.ai`; every
  other OpenAI-compatible endpoint keeps the development adapter and stops at
  `search_not_configured`, because it has no such plugin and a request carrying one would
  be silently dropped. No test can confirm that a live account honours the plugin, so the
  adapter is built so that a wrong guess fails safe: it never reads the model's prose, and
  a response with no citations reports `performedRetrieval: false`. See
  `docs/RESEARCH.md` → *Retrieval: the web-search adapter*.
- **Source normalisation** — `new URL` first, then inspection, then canonicalisation, then
  deduplication. Tracking parameters and fragments removed, parameters sorted, default
  port dropped, unknown parameters kept.
- **A finding and evidence system** — a claim plus `basis: "source" | "model"`, and the
  `Finding → Evidence → Source → URL` chain. Every quote is verified against the
  retrieved text after NFKC normalisation and typographic folding; a quote that does not
  verify demotes its claim instead of being accepted.
- **Deduplication within a run**, with an alias map that rewrites citations of a discarded
  duplicate to the kept source, so dedup cannot silently orphan a finding.
- **Conflicts recorded, never resolved** — the findings that disagree, the sources they
  span, and a description. Nothing decides which side is right.
- **A deterministic evaluator** — `sufficient`, `insufficient`, `conflicting` or `failed`,
  from the recorded facts alone, with every shortfall named in the summary.
- **Explicit, configurable limits** — five ceilings read from the environment, each
  checked before the work it bounds, each recorded when reached, with the partial result
  returned rather than discarded. A malformed limit throws instead of silently defaulting.
- **`POST /api/research`** — a terminal record in the response, plus `GET /api/research`
  for a summary list and `GET /api/research/capabilities` for what the build can do. A
  run that found too little is a `201`, not a `500`.
- **Workspace integration** — the `/research` page posts to the real endpoint and renders
  what came back: the plan, each source with its URL, findings marked sourced or inferred,
  the evidence behind each, recorded conflicts, the limits reached, and the event stream
  read from the record rather than simulated.
- **Documentation** — `docs/RESEARCH.md`, plus `ARCHITECTURE.md` §11 and the environment
  template.
- **Tests** — eleven new files covering URL safety, normalisation and dedup, the plan
  contract, the finder's quote check, the search tool, the evaluator, the service loop,
  the service layer, both API routes and the request schema, with the development
  adapter's two research operations checked against the real consumers' schemas.

**Real retrieval is written but unverified against the live service.** The web-search
adapter (`research/provider/openrouter-search-provider.ts`) exists and is selected by
`resolveResearchProvider()` whenever `LLM_ENDPOINT` points at openrouter.ai; every other
endpoint, including the `dev` default, resolves to the unconfigured development adapter
and stops at `search_not_configured` before planning. What no test establishes is that a
live OpenRouter account returns citations for this request — see `docs/RESEARCH.md` →
*Verifying it live* for the one `curl` that settles it. The design is built so that a
wrong guess fails visibly (`performedRetrieval: false` and an `insufficient` result)
rather than by presenting model prose as a retrieved source. Also absent: URL
fetching (Orion records source URLs and never dereferences one), long-term memory, a
vector store, embeddings, a cross-run source cache, background or scheduled runs, a
cancel endpoint, tool-call timeouts, authentication or rate limiting on the research
endpoints, report generation, and multi-agent behaviour.

**Two changes to earlier phases, recorded rather than glossed over.** `AgentErrorCode`
gained `search_not_configured`, and it was added only after checking that
`capability_unavailable` did not already mean it — it does not, and the two are fixed by
different people. `ModelOperation` gained the two research operations, which is an
addition to Phase 3's provider interface rather than a change to it: the development
adapter's existing `plan`, `execute_step` and `evaluate` cases are untouched.

**Depends on Phases 3–4:** the provider interface and its resolution, the planner's
untrusted-output discipline, the tool registry, the executor pipeline, the receipt, the
permission model, the event log and the state builder. Phase 5 added a layer above them
and changed none of them.

**Depends on the environment for one thing only:** an `LLM_ENDPOINT` on OpenRouter, whose
`web` plugin is what the retrieval adapter asks. That is configuration rather than code,
so the adapter is written and the endpoint decides whether it runs; see `docs/RESEARCH.md`
→ *Retrieval: the web-search adapter*. What no test establishes is that a given account
and model honour the plugin — a test that reached the real endpoint would fail on a plane,
in CI, and the day a key is rotated — which is why the adapter is built so that a wrong
guess produces an honest `insufficient` rather than fabricated evidence.

---

## Phase 5R — Database & persistence

> **Displaced, not cancelled.** This was Phase 5 in the original roadmap and is
> unchanged below. The work that actually happened as Phase 5 is the section above. See
> *Why Phase 5 is research, not the database*.

**Goal:** the application has a schema, and something is actually stored.

- Supabase project provisioned; migrations under version control from the first one.
- Tables shaped around the domain types: executions, tasks, steps, observations, tool
  executions.
- **Row Level Security enabled on every table at creation time**, with policies written
  alongside the migration — not deferred.
- Authentication, since RLS policy requires an identity to key on.
- The process-local execution store replaced by a repository behind the service. This
  closes the deviation recorded in `ARCHITECTURE.md` §10 — **and Phase 5 added a second
  one**, `research/store.ts`, which this phase must also replace.

**Depends on Phase 3:** there is now state worth persisting, and a bounded, swappable
store to replace. Phase 5 made that two stores rather than one.

---

## Phase 6 — Reports & deliverables ✅

> **Verified against this tree.** All three gates named under *Gates* were run and passed:
> `tsc --noEmit` clean, `npm test` at **854/854 across 40 files** (baseline 629/629 across
> 30 before this phase's ten new files), and `npm run build` exit 0 with `/reports`,
> `/reports/[id]`, `/api/reports` and `/api/reports/[id]` all rendering as `ƒ`.
>
> Two gaps remain and are not gate failures — they are absences stated in the section
> below and in `docs/REPORTS.md`. There are no render-level UI tests, and the prose path
> has never been exercised against a live model.

**Goal:** a finished research result becomes a document a person can read, print and
check — ordered, readable, and still traceable, so a reader can answer *where did Orion
get this?* without searching the application.

Delivered:

- **Report domain model** (`src/types/report.ts`) — `Report`, `ReportSection`,
  `ReportCitation`, `ReportSource`, `ReportMetadata`, `ReportStatus`,
  `ReportGenerationRequest`, `ReportGenerationResult`, `ReportSummary`. JSON-safe
  vocabulary only, following the seam `src/types/agent.ts` and `src/types/research.ts`
  draw. `ReportSectionKind` is a closed union of eight, so the renderer switches over it
  exhaustively and adding a kind is a compile error at the one place that must decide how
  to draw it.
- **A dedicated report service** (`src/server/report/`) — generator, deterministic
  builder, grounding, schema, service and store. §2's boundary is enforced by the import
  list: nothing under `src/server/report/` imports from `@/server/research/tools`, no
  retrieval provider is resolved, and the generator cannot search, plan or call a tool.
  A generator that could look something up would be a second research engine with its own
  honesty checks.
- **The one idea, which the rest reduces to** — *the evidence-bearing half of a report is
  built by the server and is never model-authored; a model only writes prose, and every
  prose block declares which findings it draws on.* The title, objective, findings,
  sources, evidence, conflicts and unresolved questions are all assembled from the
  `ResearchResult`, verbatim. Only the executive summary, the detailed analysis and the
  suggested next steps are prose.
- **A grounding contract that is arithmetic rather than instruction** — no URL can enter
  from the model because no field accepts one; every citation index must resolve to a
  finding or is dropped and counted; quotes come only from `ResearchEvidence.quote`, which
  Phase 5 already verified; every numeric token in generated prose must appear in the brief
  the model was shown, or the sentence is flagged and counted; and bounds cap sections,
  headings, bodies and next steps. Only the first of the seven mechanisms is an instruction
  to the model, and it is the weakest. `src/server/report/grounding.ts` is the whole of the
  machine, and its four functions are exported so a test can assert the arithmetic rather
  than the generator.
- **LLM integration through the existing `ModelProvider`** — one new operation, `report`,
  added to the closed `ModelOperation` union. Structured output: the model returns integer
  finding indices and text, `parseModelJson` parses it, `modelReportSchema.safeParse`
  validates it, and unknown keys are **stripped rather than merged**. Malformed output is
  rejected, never silently accepted.
- **The deterministic fallback** (`report/deterministic.ts`) — the same report minus the
  prose, built from the supplied data alone. It is not a second generator: because the
  evidence half is always server-authored, a report with a model and one without cannot
  disagree about what the research found.
- **A three-tier failure policy, none of it silent** — reject the model output and fall
  back to the deterministic report; degrade a claim and keep the report, counting it; or
  fail the report at the service boundary (`404` for no such record, `409` for a record
  with no result).
- **A reusable renderer, separate from generation** (`components/reports/`) — it takes a
  `Report` and knows nothing about how one was produced. §7 is met by that separation, not
  by a renderer per format.
- **The API** — `POST /api/reports` generates or returns the report already made for that
  record, `GET /api/reports` lists summaries newest-first, and `GET /api/reports/[id]`
  returns one document. Both segments are `force-dynamic`. `[id]/route.ts` exports `GET`
  and nothing else: a report is written once by the generator and never afterwards, and a
  test asserts the absence of the write handlers.
- **The Reports pages** — the list renders real records with title, date, status, the
  research it came from, and an empty state that says what to do rather than implying a
  history that does not exist; the detail view makes the source/citation relationship
  obvious, with each finding's statement, its basis, its verified quote and the source it
  came from, and each source's title, domain, retrieval date and related findings.
- **A print view** — chrome carries `data-print="hide"`, `@page` sets the paper margin, and
  the palette flattens to black on white rather than being re-themed. There is no PDF
  generation and no PDF dependency; the browser's own print dialog is the mechanism.
- **Workspace integration** — the research panel offers report generation under exactly
  the condition the service refuses on (`record.result !== undefined`), and links to the
  existing report rather than offering to generate a second one when one already exists.
- **Documentation** — `docs/REPORTS.md`, plus `ARCHITECTURE.md` §12 and this file.
- **Tests** — seven new files covering the report schema, the deterministic builder, the
  model path and its three degradations, the service, the store, the service layer, both
  API routes and the extracted UI logic, alongside the schema tests from earlier in the
  phase. Every model call is scripted through `createStubModelProvider`; no test contacts
  anything.

**Four things a reader should not assume.** Reports are **not persisted**: there is no
database, so `report/store.ts` is a bounded process-local `Map` of 25 that does not
survive a restart and is visible only from the process that produced it. There is **no
ownership enforcement**, and the application does not pretend otherwise — §12's and §21's
ownership checks require a user identity and there is none, which is blocked on Phase 5R;
`POST /api/reports` is unauthenticated exactly as `/api/research` is, and when
authentication lands report ownership is the first thing that must be added. There are
**no render-level UI tests** — the project has no component test infrastructure and §18
forbids new dependencies, so every presentation rule that can be decided without rendering
was extracted into `src/lib/reports/view.ts` and tested there, and that a component draws
what the rule says is covered by nothing. And **the prose path has not been exercised
against a live model**: every test scripts the provider, so what is established is that a
model's response is parsed, checked and rejected or degraded as specified — not that a
given account and model write prose that survives the checks. The design anticipates the
latter being common: a response citing no finding is refused outright, and the report is
still complete when it is.

**Two changes to earlier phases, recorded rather than glossed over.** `ResearchResult`
gained `unresolvedQuestions: string[]`, populated from the extractor's own `gaps` — a
Phase 5 type and a Phase 5 file, added because reading the gaps back out of
`observations[].output` would have meant inspecting an internal shape, and because dropping
them would have failed the requirement that a report preserve the questions a run left
open. And `ModelOperation` gained `"report"`, which is the closed union working as
designed: the compiler named every place that had to decide, including the development
adapter, the test stub, and a `Record<ModelOperation, number>` literal in
`agent/planner/index.test.ts` that needed one mechanical line. The existing `plan`,
`execute_step`, `evaluate`, `research_plan` and `research_findings` cases are untouched.

**Depends on Phases 3–5:** the provider interface, the untrusted-output discipline, the
tool system's non-involvement, and above all the research record — whose findings already
carry their sources, whose evidence already carries a verified quote and a denormalised
URL, and whose conflicts and limits are already recorded rather than resolved. Phase 6
added a layer above that record and changed none of its guarantees.

---

## Phase 6R — Real model provider

> **Renumbered, not cancelled.** This was Phase 6 in the original roadmap and is
> unchanged below. The work that actually happened as Phase 6 is the section above. See
> *Why Phase 6 is reports, not the model provider*.

**Goal:** one real model call, behind the interface that already exists.

> **Partly delivered by Phase 5.** The adapter exists:
> `agent/provider/openai-provider.ts` implements the OpenAI-compatible
> `/chat/completions` protocol, is selected by `LLM_API_STYLE=openai`, and is covered by
> `provider/openai-provider.test.ts` and `lib/env.test.ts`. OpenRouter, Groq, Together,
> vLLM, LM Studio and OpenAI itself are all reachable by pointing `LLM_ENDPOINT` at one
> of them. Phase 5 needed it, so it was built as a dependency rather than as this phase.

What remains for this phase:

- **A live-verified retrieval provider.** `ResearchProvider` now has a real
  implementation — `research/provider/openrouter-search-provider.ts` — but the one thing
  no test can establish is that a given OpenRouter account and model honour the `web`
  plugin, because a test that reached the real endpoint would fail on a plane, in CI, and
  the day a key is rotated. The adapter is built so that a wrong guess fails safe rather
  than fabricating evidence; confirming it against a live account is one `curl`, quoted in
  `docs/RESEARCH.md`.
- Prompt construction kept isolated from the transport, so swapping a vendor does not
  mean rewriting prompts.
- Response parsing that treats model output as untrusted, as the planner already does.
- Provider selection by environment, which is already how resolution works.
- Any second wire protocol — Anthropic's messages API, Gemini's `generateContent` — as a
  new style and a new adapter beside the existing one.

**Depends on Phase 3:** the interface, the resolution point, and the credential
containment in `src/lib/env.ts` are all in place.

---

## Phase 7 — Memory & state

**Goal:** Orion does not rediscover the same things every run.

- Long-term memory distinct from task state, as set out in `ARCHITECTURE.md` §8.
- Retrieval at planning time, and writes at the end of a run.
- Persisted in PostgreSQL behind services, so memory survives a restart.

**Depends on Phases 5R and 6:** there is nothing worth remembering until runs use a real
model and their results are stored. Phase 5 built the layer that will *produce* the
material worth remembering, and deliberately gave it no memory of its own — a research
run's sources are available only from its own record.

---

## Phase 8 — Reports & delivery

> **Displaced, not cancelled.** Phase 6 built the reports subsystem ahead of this section,
> against the research record rather than against persisted memory. What is left here is
> what Phase 6 deliberately did not build.

**Goal:** a result a person can read and act on.

- ~~Structured report generation from the run's artefacts.~~ **Built as Phase 6**, from
  the `ResearchResult` rather than from the raw per-step findings this section assumed: a
  research run's findings already carry their sources, their verified quotes and their
  URLs, so the chain this bullet asks for is traceable by construction. The per-step
  findings remain unmerged and unread by the report layer.
- **Presentation in the workspace** — built as Phase 6. **Export or delivery is not.**
  Phase 6 renders a print-friendly view and stops there: no file format, no PDF, no email,
  no scheduling, no delivery of any kind.
- ~~Every claim in a report traceable to the step or tool execution that produced it.~~
  **Built as Phase 6**, and strengthened: a claim is traceable to a *verified quote in a
  retrieved source*, which is a stronger terminus than the step that produced it.

What this phase still owns, then, is **delivery and export** — and the two things the
original ordering assumed would exist by now: persisted runs (Phase 5R) and memory
(Phase 7). Reports do not depend on either, which is why Phase 6 could arrive first, but
a report that outlives the process that made it does.

**Depends on Phases 5R and 7** for durable reports, and on Phase 6 — which it now follows
rather than precedes — for the document itself.

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
