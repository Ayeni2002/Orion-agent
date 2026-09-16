# Orion — Reports

How a finished research result becomes a document a person can read, print and
check, and what Orion refuses to put in one.

Read alongside [`RESEARCH.md`](./RESEARCH.md), which describes the record a report
is built from, and [`ARCHITECTURE.md`](./ARCHITECTURE.md) §12, which states the
decisions behind this subsystem.

## Scope

Phase 6. A `ResearchResult` goes in; a `Report` comes out — a title, an ordered
set of sections, the citations behind every finding, the sources those citations
came from, the conflicts the run recorded, the questions it left open, and a
record of how the prose was written.

**This phase does not add a database, an export format, or a background worker.**
Generation is synchronous: `POST /api/reports` returns a terminal document, and
the in-flight state belongs to the UI rather than to a stored record. There is no
PDF generation and no PDF dependency — §16 asks for a print-friendly view, and the
browser's own print dialog is the mechanism.

The generator does not search, retrieve, plan research or call a tool. There is no
import from `@/server/research/tools` anywhere under `src/server/report/`, and no
retrieval provider is resolved. A report generator that could go and look
something up would be a second research engine with its own set of honesty checks.

## The one idea

**The evidence-bearing half of a report is built by the server and is never
model-authored. A model only writes prose, and every prose block declares which
findings it draws on.**

That single division is what §2's architecture, §6's structured output, §7's
separation and §15's deterministic fallback all reduce to. It means:

- the deterministic builder is not a second generator — it is the same report
  minus the prose, so a report with a model and one without cannot disagree about
  what the research found;
- model output is never the source of truth, so §6's "reject invalid output" has
  something to check it *against*;
- a report whose model call fails is still a complete, readable document rather
  than an error page.

| Section | Author | Built from |
| --- | --- | --- |
| Title | server | the question, trimmed — never rewritten |
| Research objective | server | `result.question`, plus the planner's restatement when it differs |
| Key findings | server | `result.findings`, statements verbatim, each with its `basis` |
| Sources and evidence | server | `result.sources` and `result.evidence`, verbatim |
| Conflicting information | server | `result.conflicts` — **omitted entirely when empty** |
| Unresolved questions | server | `result.unresolvedQuestions`, `limitsReached`, `errors` — omitted when all three are empty |
| Executive summary | **model** | prose + `findingIndices[]` |
| Detailed analysis | **model** | `{ heading, body, findingIndices[] }[]` |
| Suggested next steps | **model** | `{ body, findingIndices[] }[]` |

## The grounding contract

§4 asks that every factual statement be traceable, and that no citation, URL or
publication date be invented. Seven mechanisms enforce it. Only the first is an
instruction to the model; the rest are arithmetic.

1. **The instruction states the rules.** `REPORT_INSTRUCTION` tells the model to
   use finding numbers only, to state nothing the findings do not already say, to
   introduce no figure or date that is not in them, and to report a disagreement
   rather than resolve it. This is the weakest of the seven, and it is not relied
   on.
2. **No URL can enter a report from the model, because no field accepts one.**
   `modelReportSchema` asks for integer indices and text. A response supplying a
   `url`, a `sourceId`, a `quote` or a `title` has those fields *stripped* by Zod,
   not merged — asserted in `src/server/report/schema.test.ts`. This is total
   rather than a filter that can be forgotten: the model has no syntax for
   asserting where something came from.
3. **Every citation index must resolve to a finding that exists.** An index with
   nothing behind it is dropped and counted (`droppedCitationCount`), and the
   count is shown to the reader.
4. **Quotes are never model-authored.** Every passage in a report comes from
   `ResearchEvidence.quote`, which Phase 5 already verified against the retrieved
   text with `verifyQuote`. The model is not asked for quotations at all.
5. **Figures in generated prose are grounded by arithmetic.** Every numeric token
   in a section must appear in the brief the model was shown — the finding
   statements, the source titles and domains, and the run's own counts. A sentence
   carrying a figure that is not there is **flagged and counted, not deleted** —
   the same disposition `verifyQuote` gives an unverifiable quote. See *The honesty
   arithmetic* below.
6. **Bounds.** `MAX_REPORT_SECTIONS`, `MAX_SECTION_CITATIONS`,
   `MAX_SUMMARY_CITATIONS`, `MAX_NEXT_STEPS`, and per-string minimum and maximum
   lengths. Per-string violations are hard failures — prose cut mid-sentence is a
   worse document than the deterministic one — while list overflows are
   truncations, because the entries that survive are whole.
7. **URLs are re-vetted at render time** with `parseSourceUrl`, defence in depth
   on top of the search tool's own vetting. A citation whose URL fails vetting is
   rendered as inert text with no anchor.

There is no HTML anywhere in the chain. The `Report` type has no HTML field, the
renderer emits React text nodes, and no `dangerouslySetInnerHTML` appears in the
codebase.

## The honesty arithmetic

`src/server/report/grounding.ts` is the whole of the machine, and its four
functions are exported so a test can assert the arithmetic rather than the
generator.

`collectGroundedNumbers(brief)` reads every numeric token from the text the model
was shown and returns the set of forms each number takes — so `1,200` and `1200`
are the same number, and `0.47` also permits `47`. `0` and `1` are always
permitted, because they are ordinary English. The exemption stops there on purpose:
a check that let every small integer through would catch only conspicuous
fabrications.

`findUngroundedSentences(body, grounded)` splits the prose and returns the
sentences carrying a figure that is in none of them. It is the grader, and the
design decision worth recording is *what it grades against*: the brief the model
was given, not the research result and not the retrieved corpus. Grounding on the
whole corpus would let a fabricated statistic pass whenever it happened to appear
on a page the model was never shown.

`resolveFindingIndices(indices, findings)` resolves each index, drops those with
nothing behind them, and reports how many it dropped. `verifyReportInvariants` is
the §14 quality gate, applied to the assembled document: the objective is the
question that was asked, every citation names a source that was retrieved, every
citation's URL is that source's URL, and no conflict, unresolved question or
retrieved source was dropped on the way through.

## The generation flow

`POST /api/reports` → `createReport` → `generateReportFor` → `generateReport` →
`Report` → `saveReport` → rendered by `ReportRenderer`.

`generateReport` has five exits, and none of them is silent.

| # | Condition | Result |
| --- | --- | --- |
| 1 | `useModel: false` | deterministic, reason recorded |
| 2 | no provider configured | deterministic, reason recorded |
| 3 | the provider reports `isExternal: false` | deterministic, reason recorded |
| 4 | the provider throws | deterministic, reason recorded |
| 5 | the response is unparseable, schema-invalid, or cites no finding | deterministic, reason recorded |
| — | the response survives all of the above | prose used, `mode: "model"` |

**Exit 5's third clause is the one worth stating.** Prose that cites no finding is
prose about nothing that was researched. It may be fluent and it may be plausible,
and there is no way to check a word of it, because the grounding machinery works by
comparing what was written against what it was written *from*. So it is refused
rather than marked. This also makes the deterministic development adapter
structurally incapable of producing a model-mode report: it offers no citations, so
its output is always rejected here, and a report generated with no real provider is
always labelled as one.

**Exit 3 is the same idea applied to the provider seam.** `ModelProviderDescriptor`
carries `isExternal`, and `dev-provider.ts` says of itself that it "must never be
presented to a user as if a model produced it". A report's prose is the part a
reader weighs as judgement, so prose from a deterministic stand-in is never
requested.

Once the prose survives, three things can still be *degraded* without rejecting the
report, and each is counted and surfaced to the reader by
`describeGenerationCorrections`:

- an index did not resolve → the branch is dropped, `droppedCitationCount`;
- a sentence stated an ungrounded figure → it is marked, `ungroundedNumberCount`;
- a list exceeded its cap → the excess is dropped whole, `truncatedSectionCount`.

## The data model

`src/types/report.ts` holds JSON-safe vocabulary only, following the same seam
`src/types/agent.ts` and `src/types/research.ts` draw.

| Type | What it is |
| --- | --- |
| `Report` | The document: title, objective, sections, citations, sources, conflicts, unresolved questions, metadata |
| `ReportSection` | `{ id, kind, heading, body?, items?, origin, findingIds, ungroundedSentences? }` |
| `ReportSectionKind` | Closed union of eight: `summary`, `objective`, `findings`, `analysis`, `sources`, `conflicts`, `unresolved`, `next_steps` |
| `ReportSectionOrigin` | `"research"` or `"model"` — which half of the report this section came from |
| `ReportCitation` | `{ findingId, statement, basis, quote?, sourceId?, url?, domain?, sourceTitle?, retrievedAt? }` |
| `ReportSource` | `Omit<ResearchSource, "content">` — the retrieved body text is dropped |
| `ReportMetadata` | `{ researchProvider, modelProvider?, generation }` |
| `ReportGeneration` | `{ mode, reason?, droppedCitationCount, ungroundedNumberCount, truncatedSectionCount }` |
| `ReportStatus` | `"completed" \| "failed"` |
| `ReportGenerationRequest` | `{ researchId, regenerate?, useModel? }` |
| `ReportGenerationResult` | `{ ok: true, report } \| { ok: false, reason, error }` |
| `ReportRefusalReason` | `"not_found" \| "not_ready"` |
| `ReportSummary` | The list projection |

**`ReportCitation` is denormalised on purpose**, for the reason
`ResearchEvidence.url` already gives: a chain with a hop that requires a join is a
chain a reader will skip. It also means a report renders after the research record
it came from has been evicted from its bounded store.

**`ReportStatus` has two members, not four.** §13's `IDLE` and `GENERATING` are
states of a *request*, not of a document, and the record is written once and
terminally — exactly as `research/store.ts` only ever holds finished records. §13
permits this reading in as many words and asks for a simple loading state rather
than an invented percentage; `GenerateReportButton` holds that state as a boolean.

**`ReportSectionKind` being a closed union is load-bearing.** The renderer switches
over it exhaustively with no `default`, so adding a kind is a compile error at the
one place that has to decide how to draw it.

## The API

| Method | Path | Behaviour |
| --- | --- | --- |
| `POST` | `/api/reports` | Generate, or return the report already made for that record. `201` on success — including a report built without a model. `400` invalid request, `404` no such research record, `409` the record has no result, `413` body over 8 KiB |
| `GET` | `/api/reports` | `{ reports: ReportSummary[] }`, newest first |
| `GET` | `/api/reports/[id]` | `{ report }`, or `404` |

Both segments export `dynamic = "force-dynamic"`. The report store is process-local
and empty at build time; captured once, the list endpoint would look correct and
never return a report that had actually been generated.

**A `201` can mean no model wrote anything, and that is not an error.** A report
assembled from the research record is a readable, traceable document, and its
`metadata.generation.mode` and `reason` say how it was written and why. Returning
an error status would discard a usable deliverable to report a condition the body
already describes.

**A report cannot be written, changed or deleted through the API.** `[id]/route.ts`
exports `GET` and nothing else — no `PATCH`, no `DELETE`. A report is written once
by the generator, from a research result, and never afterwards.

**Nothing in a request can reach a report's contents.** The body names a research
record and two preferences. There is no field through which a caller could supply a
section, a citation, a source or a URL, and `[id]/route.test.ts` asserts the
absence of the handlers as well as the stripping of the fields.

## Persistence

§11 asks for reports to be persisted *if the existing persistence architecture
supports it*. It does not. `supabase/server.ts` states that the session middleware
arrives with authentication in a later phase, and no table, migration or repository
exists anywhere in the repo. So reports are held in
`src/server/report/store.ts` — a bounded, process-local `Map` of
`MAX_RETAINED_REPORTS = 25`, newest-first on read — exactly as executions and
research records are.

**A stored report is visible only from the process that produced it, does not
survive a restart, and is not shared between instances.** That is a real limitation
and it is recorded here rather than papered over.

**§12's and §21's ownership checks cannot be implemented.** There is no
authentication, therefore no user identity, therefore nothing for a report to
belong to. `POST /api/reports` is unauthenticated exactly as `/api/research` is.
This is blocked on Phase 5R (authentication), which is *Not started*. The
application does not pretend otherwise: there is no check that passes for everyone
dressed up as ownership enforcement. **When authentication lands, report ownership
is the first thing that must be added** — the store is where it goes, and the
service is where it is checked.

## The print view

§16 asks for a clean print-friendly view, and §16 explicitly does not ask for PDF
generation. So:

- chrome — the site header, the sidebar, the mobile nav, the page's own action row
  — carries `data-print="hide"`, and `globals.css` hides it under `@media print`;
- `@page { margin: 18mm 16mm }` sets the paper margin;
- the colour palette is **flattened** rather than re-themed: every background
  becomes white, every shadow is dropped, every text colour becomes black. A second
  token palette for print would drift from the screen one, and flattening costs
  nothing here because the application already refuses to put meaning in colour
  alone — status is always a word beside a tone, so a reader loses nothing when the
  tones go;
- `mark` keeps its highlight under `print-color-adjust: exact`, because an
  ungrounded sentence identified by a *word* is still identified, but the mark is
  the thing a reader scans for;
- heading breaks are avoided after headings and inside blockquotes.

`PrintButton` calls `window.print()`. There is no PDF library, no server-side
renderer, and no second template.

## Workspace integration

§17 asks that a report be generatable from a finished research run, and that only a
research result enter the flow. `ResearchPanel` renders `GenerateReportButton`
under the condition `record.result !== undefined` — the exact condition the report
service refuses on, rather than an approximation of it with a status check.

The button checks `GET /api/reports` on mount and, when a report already exists for
that record, links to it instead of offering to generate one (§22). The server
would reuse the existing document anyway; what the check changes is that the
interface stops *offering* work that will not happen.

## Security

- **No authentication, no authorization, no ownership.** See *Persistence* above.
- **Request validation** at the boundary: `reportRequestSchema` trims and bounds
  the research id and accepts two booleans. Nothing else survives.
- **Model output validation**: `modelReportSchema.safeParse`, with unknown keys
  stripped rather than merged.
- **Safe URL rendering**: `parseSourceUrl` at render time; a URL that fails vetting
  is text, not an anchor. Every external link carries
  `rel="noopener noreferrer"`.
- **No XSS surface**: no HTML field, no `dangerouslySetInnerHTML`, no raw model
  markup rendered anywhere. A URL the model writes into prose lands in a text node.
- **No secret exposure**: a report's `metadata` is rendered to a user, so a
  provider failure is described by `ModelProviderError`'s own safe message or, for
  an unrecognised error, by its kind rather than its text — an unexpected error's
  message could contain a URL with a key in it. `generator.test.ts` asserts that.

## Testing

`src/server/report/*.test.ts`, `src/server/services/reports.test.ts`,
`src/app/api/reports/**/*.test.ts` and `src/lib/reports/*.test.ts`. Every model
call is scripted through `createStubModelProvider`; no test contacts anything, and
the suite passes with no API key present — `vitest.setup.ts` deletes the provider
environment variables before each file.

**`createStubModelProvider` reports `isExternal: false` by default**, so a test
that means to reach the model path must pass `descriptor: { isExternal: true }`.
The generator refuses to ask a non-external provider for prose at all, so a test
that forgot would silently be exercising the deterministic builder.

**There are no render-level UI tests.** The project has no
`@testing-library/react` and no jsdom — every test file is server-side — and §18
forbids new dependencies. So every presentation rule that can be decided without
rendering is extracted into `src/lib/reports/view.ts` and tested there, and the
components above it do layout and nothing else. **This is a real gap**: that a
component draws what the rule says is not covered by anything.

## Not built

Long-term memory; vector store; embeddings; autonomous external actions; email;
browser automation; payments; multi-agent collaboration; queues; background
workers; scheduling; PDF export; any new research provider; any change to the tool
system; any new npm dependency; authentication, ownership checks and durable
persistence (Phase 5R); a second renderer or an HTML template language; a cross-run
report cache (§22 asks for reuse, not for caching infrastructure — the check is one
store lookup).
