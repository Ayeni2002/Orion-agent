# Orion — Research

How a question becomes a structured, sourced result, and what Orion will not claim
about it.

Read alongside [`ARCHITECTURE.md`](./ARCHITECTURE.md) §11, which states the four
decisions behind this subsystem, and [`TOOL_SYSTEM.md`](./TOOL_SYSTEM.md), which
describes the executor a research run calls through.

## Scope

Phase 5. A research question goes in; a record comes out carrying the plan, the
retrieved sources, the findings, the evidence linking each finding to a passage, any
recorded conflicts, which limits were reached, and the full event log.

**This phase does not add a database, long-term memory, a vector store, embeddings,
scheduled runs, or a background worker.** §20 requires the first four to be absent, and
the last two are absent because a run finishes inside the request that started it — which
is what makes `POST /api/research` able to return a terminal record.

## The run, end to end

1. `POST /api/research` reads the body, capped at 8 KiB, and `researchRequestSchema`
   trims and bounds the question. A request that could carry its own limits, plan,
   sources or verdict is discarded down to `{ question }`.
2. `runResearch` resolves two providers: the Phase 3 `ModelProvider` and the
   `ResearchProvider`.
3. **If retrieval is not configured, the run stops here** — before planning — and
   returns `search_not_configured`. See *What is not configured* below.
4. The planner asks the model provider to restate the question and break it into
   retrieval tasks. A plan longer than `maxTasks` is truncated, and the truncation is
   recorded as a limit reached.
5. Each task calls `research.search` through the Phase 4 `ToolExecutor` under the
   research grant. The executor checks permission, validates the input, calls the
   provider, and returns a receipt.
6. Returned sources are vetted by `parseSourceUrl` and normalised: tracking parameters
   and fragments removed, the domain re-derived from the vetted URL rather than trusted
   from the provider.
7. Sources are deduplicated against this run's own set, and citations of a discarded
   duplicate are rewritten to the kept source.
8. The model provider is asked what the retrieved sources establish, quoting them. Each
   quote is verified against the retrieved text.
9. A deterministic evaluator judges the run: `sufficient`, `insufficient`,
   `conflicting` or `failed`.
10. The record is saved and returned, `201`.

The event log of a successful run reads `execution.created` → `execution.planning` →
`execution.planned` → `execution.started` → per task (`step.started`, `tool.started`,
`tool.completed`, `step.completed`) → `execution.evaluating` → `execution.completed`.
A task whose search is refused emits `tool.failed`; one that yields nothing extractable
emits `step.failed`; a task skipped at a ceiling emits `step.skipped`; a run stopped by
the wall-clock limit or by cancellation ends at `execution.failed` or
`execution.cancelled` with the partial material still attached.

**No new event types were introduced.** The fifteen in `AgentEventType` were enough, and
adding research-specific ones would have made the workspace's activity panel a union of
two vocabularies.

## The domain model

`src/types/research.ts` holds JSON-safe vocabulary only — no functions, no Zod schemas,
because neither survives a round-trip through the API and therefore neither belongs in a
domain-types module. The same seam `src/types/agent.ts` draws.

| Type | What it is |
| --- | --- |
| `ResearchRequest` | The question, verbatim, and when it was asked |
| `ResearchTask` | One retrieval task: question, query, status, the source ids it produced |
| `ResearchSource` | A retrieved document: canonical URL, domain, title, retrieved text, provider |
| `ResearchFinding` | A claim, plus `basis: "source" \| "model"` and the source ids behind it |
| `ResearchEvidence` | The passage: finding id, source id, the quote, the URL |
| `ResearchConflict` | Two or more findings that disagree, with the sources they span |
| `ResearchResult` | The machine-readable outcome: verdict, summary, findings, evidence, sources, conflicts, errors, limits reached |
| `ResearchRecord` | Everything above, plus plan, observations and the event log |
| `ResearchSummary` | The list projection: counts, no material |

The executable half — `ResearchProvider`, its descriptor and request/response shapes —
lives in `src/server/research/provider/provider.ts`, for the reason Phase 4 gives for
`ToolDefinition`.

## The provider abstraction

`ResearchProvider` is the seam between the tool and wherever sources come from:

```
search(request) → { sources, providerId, performedRetrieval }
descriptor       → { id, label, model, isExternal }
isConfigured     → boolean
```

Two implementations exist:

- **`createDevResearchProvider`** — deterministic, contacts nothing, `isConfigured` is
  `false`. This is what `resolveResearchProvider()` returns today.
- **`createStubResearchProvider`** — test-only, scripted per call, with a call counter
  so a test can assert a provider was *not* reached.

**And nothing else.** No adapter talks to a search service, because no search service's
wire format has been verified against the live service. See *What is not configured*.

`performedRetrieval` is carried rather than inferred from an empty list: "searched and
found nothing" and "did not search" lead to different conclusions, and only one of them
is evidence about the world. A source list that came from a stub or from a development
adapter must not be readable as a search result.

## The research tool

`research.search` (`src/server/research/tools/search.ts`) is the only tool in Orion that
declares `network`. It:

- refuses to run at all when the provider is not configured — it throws rather than
  returning an empty success, because an empty success is indistinguishable downstream
  from a search that looked and found nothing;
- vets every returned URL through `parseSourceUrl`, dropping and counting the ones it
  refuses rather than repairing them;
- re-derives `domain` from the vetted URL, so a provider reporting one host in `domain`
  and another in `url` cannot produce a phishing-shaped source;
- stores the canonical URL, which is what makes deduplication and evidence URLs agree;
- clamps the result count to `MAX_SEARCH_RESULTS` (10) regardless of what the caller
  asked for, and counts rejected and dropped results separately — one is a hostile link,
  the other a usable result excluded by a ceiling;
- truncates an oversized title or passage and marks it `…[truncated]`, so a finding
  cannot quote text that was never fully retrieved.

Its input schema bounds the query at 3–400 characters. That bound is imported by the
planner's schema rather than restated, and a test asserts the identity — two copies would
drift, and the drift would appear as a plan that is valid when written and invalid when
executed.

## Registration and permissions

`research.search` is registered in a **registry constructed per run**, never in the
default catalogue. Two reasons:

- The default catalogue is what `/api/tools` reports and what every agent run resolves
  against. Adding the search tool there would mean an agent run could reach the network,
  which is the opposite of deny-by-default.
- `web.search` is documented Phase 3 behaviour: the deterministic planner names it and
  the engine answers `capability_unavailable`. Registering anything under that id would
  change what an agent run does, so the research tool has an id of its own.

The grant is `RESEARCH_TOOL_PERMISSION = ToolPermission.only("read_only", "network")`,
held in a module of its own so that "where can Orion reach the network?" is answerable by
grep. `DEFAULT_TOOL_PERMISSION` is unchanged. The permission is a constructor argument
to `ToolExecutor`, not a per-call parameter, so no caller can grant itself anything; a
test asserts that the tool under the default grant is refused with
`tool_permission_denied` and that the provider was never called — permission is checked
before validation, so the schema never consumes untrusted input and no request leaves
the process.

## The planner

§7 requires a Zod-validated structure rather than a paragraph, and the schema enforces
that in the shape it refuses: an array of sentences is rejected, and so is any task with
no query. A plan is:

```
{ restatement, tasks: [{ question, query }] }
```

- `restatement` is the model's reading of the question, bounded at 8–1000 characters.
  It is stored on the plan rather than replacing `request.question`, because the
  difference between what was asked and what was understood is exactly what a reader
  needs when a result looks wrong.
- Every task carries a `query` the search tool will accept — the planner cannot emit a
  task that retrieves nothing.
- At most `MAX_RESEARCH_TASKS` (12) tasks in the schema, and at most `maxTasks`
  (default 5) in a run. The schema cap is structural; the limit is the operator's.
- `validateResearchPlan` adds the one check Zod cannot express: two tasks searching for
  the same thing retrieve one source and the run pays for two. Repeats are detected
  after trimming and case folding, and every repeat is reported with its index.

A plan that fails validation fails the run with `planner_failed`. Nothing malformed
reaches the tool.

## LLM integration

The model is reached through the Phase 3 `ModelProvider` and two operations added to it:
`research_plan` and `research_findings`. **The model never executes a tool.** It produces
a plan, and later it produces findings; between those, the engine decides what to call
and the executor decides whether it may. There is no path by which model output names a
tool, an endpoint, or a URL that Orion then fetches — the URLs it sees came from
retrieval, and it can only cite them by index.

Model output is untrusted at every hop: the plan is schema-validated and then
graph-checked, the finding response is schema-validated, and each quote is verified
against the text it claims to come from. A malformed response is an error with a code,
never a partially-trusted object.

### The finding extractor

§12 forbids inventing facts the sources do not support. Prose cannot enforce that, so the
contract is a quote per attributed claim, and `verifyQuote` checks it: NFKC-normalised,
typographic variants folded (curly quotes, en and em dashes, NBSP, ellipsis), lowercased,
whitespace collapsed, then a substring test. A fabricated passage does not appear in the
source, and no amount of fluency changes that.

Four outcomes, and the third is the one that matters:

- A quote that verifies → `basis: "source"`, with `ResearchEvidence` recording the
  passage, the finding and the source.
- A claim with no quote at all → accepted as `basis: "model"`. An inference is a
  permitted thing to have; it is a forbidden thing to present as sourced.
- A claim whose quote does *not* verify → **downgraded** to `basis: "model"` and stripped
  of its evidence. The claim is kept and labelled rather than rejected: losing it would
  discard the model's reading, and keeping it unlabelled would be the fabrication §12
  exists to prevent.
- A quote citing a source index that was never supplied → the same downgrade, because
  there is nothing to verify against.

The run counts both downgrades (`unverified`) and claims that arrived with no citation
(`uncited`) in the step's observation, so a reader can see how much of a result is
sourced rather than inferring it from a verdict.

## Free and development providers

`LLM_API_STYLE=dev` is the default and needs no credential, no endpoint and no network.
It is a real, working configuration: planning, retrieval through the development research
provider, normalisation, extraction, evaluation, storage and the API all run, and the
record says plainly which adapter produced it — `descriptor.isExternal` is `false` and
the descriptor label says "deterministic".

The two research operations on the development adapter are constrained in the way §12
requires. `research_plan` emits a fixed three-facet decomposition with the question
echoed verbatim into each query — it performs no inference, so any facet list it produced
by "reading" the question would be a pattern match dressed up as understanding.
`research_findings` copies the opening of each source that has text, labels the copy with
where it came from, and claims nothing else. It does not summarise, interpret, conclude,
or record a conflict, because all four are inference.

That constraint is what makes the adapter honest and also what makes it *not a model*:
every finding it emits is `basis: "source"` by construction, and the quote it supplies is
a real substring of the text it cites. A real model's output can fail the quote check.
This one cannot — which is a statement about the adapter, not about the check.

`RESEARCH_SEARCH_MODEL` optionally names a different model for retrieval than for
planning. There is deliberately **no** research endpoint and **no** research credential:
retrieval uses the same `LLM_ENDPOINT` and `LLM_API_KEY`, because a second copy of one
credential is a second place to rotate it and one of them will eventually be missed.

`RESEARCH_SEARCH_MODEL` **is consumed**, by `resolveResearchProvider`, which is the point
of use `env.ts` documents for it. Absent, retrieval uses `LLM_MODEL`.

## Retrieval: the search adapters

`resolveResearchProvider()` is the single place a research provider is chosen, and it
resolves in one of three ways.

**`LLM_ENDPOINT` on `openrouter.ai`** → `createOpenRouterSearchProvider`, an adapter
speaking OpenRouter's web-search plugin. Retrieval through OpenRouter is a chat
completion with a plugin attached, which is why it needs no endpoint and no credential of
its own:

```json
{ "model": "openai/gpt-4o-mini",
  "messages": [{ "role": "system", "content": "…" }, { "role": "user", "content": "<the query>" }],
  "plugins": [{ "id": "web" }] }
```

The sources come back as `url_citation` entries on the assistant message's
`annotations`, each carrying a `url`, a `title` and the cited passage as `content`. That
passage is what the extractor later quotes, so a citation whose text is dropped is a
citation no finding can rest on.

**`LLM_API_STYLE=gemini`** → `createGeminiSearchProvider`, an adapter speaking Google
Search grounding. Grounding is a `tools` entry on the same `generateContent` call the
model adapter already makes, so this too needs no endpoint and no credential of its own:

```json
{ "contents": [{ "role": "user", "parts": [{ "text": "<the query>" }] }],
  "systemInstruction": { "parts": [{ "text": "…" }] },
  "tools": [{ "google_search": {} }] }
```

The sources come back as `groundingMetadata.groundingChunks[].web`, each carrying a `uri`
and a `title`. **And that is all they carry.** Google returns the pages a search found,
not their text, so a source from this route has no passage — see "What a grounded source
cannot carry" below, which is the most important paragraph in this section.

**Anything else** → the development adapter, whose `isConfigured` is `false`. This
includes `LLM_API_STYLE=dev` and every non-OpenRouter OpenAI-compatible endpoint: Groq,
Together, vLLM, LM Studio, a local server. They all speak `/chat/completions` and none of
them has a `web` plugin this adapter was written for, so for the `openai` style the *host*
is what decides, not the style. The narrowness is the point — a request carrying a plugin
the endpoint drops would be ignored, the model would answer from its own weights, and the
run would be configured, would be reached, and would retrieve nothing. Adding a second
search-capable OpenAI-compatible gateway means adding its host to `OPENROUTER_HOST`
deliberately.

### Why `gemini` needs no host check, and `openai` does

Worth separating, because the asymmetry looks like an inconsistency and is not one.
`openai` names a *protocol* — many vendors, many hosts, exactly one of which has a plugin
this build knows how to ask. So the host is the only thing that can answer the question,
and `isSearchCapableEndpoint()` exists to ask it, along with five tests for lookalike
hosts (`notopenrouter.ai`, `openrouter.ai.evil.example`, `openrouter.ai` in a query
string).

`gemini` names a *protocol* too, but one vendor speaks it, and grounding is not a plugin
that may or may not be present — it is part of the same endpoint and the same credential.
So `style === "gemini"` settles it with no string to inspect and no lookalike to defend
against. This is the case `env.ts` was pointing at when it said retrieval availability
should be *derived rather than declared*: here it falls out of the style rather than out
of a string comparison, which is the stronger form of the same property.

### What a grounded source cannot carry

This is the one place where the Gemini route is materially weaker than the OpenRouter
one, it is a property of the provider rather than a defect in Orion, and a reader who is
not told will read the difference as a bug.

Grounding metadata carries two kinds of thing, and they are not interchangeable:

- `groundingChunks[].web.uri` / `.title` — the pages the search returned. These are
  **evidence**: locators for something that exists outside Orion.
- `groundingSupports[].segment.text` — passages of the *model's own answer*, with
  `groundingChunkIndices` saying which chunk supports each one. This is **generated
  text.**

The second is not read, and the temptation to read it is worth naming because it sits
directly beside the chunk indices and is the only prose in the payload.
`ResearchSource.content` is treated downstream as the text of the source, and
`findings/` requires the extractor to quote it *verbatim*. Copying model prose into that
field would produce a finding quoting a sentence no page ever contained — and the quote
check would **pass**, because the check compares the quote against the `content` the
adapter had just filled in. That is fabricated evidence wearing a citation, which is the
one outcome §12 exists to prevent. `openai`'s adapter discards `message.content` for the
same reason; this one discards `segment.text`.

So a source from the Gemini route carries a URL and a title and **no `content`**. Its
consequence is left visible rather than papered over: the finding extractor has nothing
to quote, so a run over Gemini-retrieved sources reports findings it cannot ground, or
reports the gap. It does not report a quotation from a page it never read. A result that
looks thinner than expected but is true beats one that looks complete and is invented.

The practical difference between the two routes, in one line: OpenRouter returns
citations *with the cited passage*, so findings quote their sources; Gemini returns the
pages, so findings from it are honest about having nothing to quote.

### Two properties that make a wrong wire format fail safe

These apply to both retrieval adapters, and they are the reason each is acceptable to
ship without a live call behind it.

**The model's prose is never read.** `message.content` is not accessed anywhere in the
OpenRouter adapter or its tests, and `candidate.content` is not accessed in the Gemini
one — nor is `groundingSupports[].segment.text`, for the reason directly above. Only
citations and chunks become sources. If an endpoint ignores the search instruction —
drops an unknown field rather than rejecting the request — the model answers from its
own weights, and that answer, *including any URL inside it*, goes in the bin. An endpoint
that silently stops searching cannot therefore put generated text into a result as though
it were retrieved.

**Citations are the evidence that a search happened.** A response with no citations — or,
for Gemini, no grounding chunks — reports `performedRetrieval: false`, even though the
HTTP call succeeded and the payload was well-formed. The two causes of an empty list —
the search was ignored, or it ran and found nothing — are indistinguishable from the
client, and the direction of the error is chosen deliberately: understating a search
yields an honest `insufficient`, overstating one yields a lie. `provider/provider.ts`
defines the flag exactly this way — "a provider that could not search at all returns an
empty array and `performedRetrieval: false`".

For Gemini this property does a second job, and it is why that adapter is shippable
before its payload has been observed. The exact spelling of `groundingMetadata` is the
one thing about that adapter that was written from documentation rather than from a call.
If it has been misread, the adapter finds no chunks, and the run reports that it retrieved
nothing. A wrong guess therefore costs a failed search, never a fabricated source — which
is what `gemini-search-provider.test.ts`'s "what it refuses to read" group pins down, one
unrecognised shape at a time.

A response that is *not* a completion at all — no `choices`, a malformed choice, no
`message` — is a different case and **throws**, because that is an endpoint not speaking
the protocol rather than an empty result, and hiding a misconfiguration behind an
ordinary-looking empty result is the failure this distinction prevents. A thrown
`ResearchProviderError` becomes a `tool_failed` receipt through the Phase 4 executor, so
the run records a failed task and reports `insufficient` rather than crashing.

One consequence is worth stating rather than leaving to be discovered: the executor does
not forward a tool's exception message into the receipt, deliberately, because a tool's
exception can embed whatever it was working on. So a search that fails at runtime reaches
the user as `tool_failed` with `errorName: ResearchProviderError`, and the actionable part
— "The search endpoint returned 429: rate limited" — goes to the server log. In practice
the common configuration failures surface earlier and in full: a bad key or an exhausted
account fails at *planning*, which uses the same endpoint and the same credential, and
`planner_failed` carries the provider's message through.

### Verifying it live

Both wire formats above are the providers' documented APIs. What no test can establish is
that a given account and a given model honour them, because a test that reached a real
endpoint would fail on a plane, in CI, and the day a key is rotated. One command answers
it for each route.

**OpenRouter:**

```
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-4o","messages":[{"role":"user","content":"What is the capital of France?"}],"plugins":[{"id":"web"}]}'
```

A `message.annotations` array containing `url_citation` entries means retrieval is on. If
the response carries prose and no `annotations`, the plugin is not being applied to that
model — and Orion will report `performedRetrieval: false` and an `insufficient` result
rather than presenting the prose as sourced.

**Gemini:**

```
curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" \
  -H "x-goog-api-key: $LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"What is the capital of France?"}]}],"tools":[{"google_search":{}}]}'
```

The key rides in the header here on purpose. Gemini also accepts `?key=`, most examples
show that form, and a URL is copied into proxy logs, access logs and error messages —
`gemini-provider.test.ts` asserts the adapter never builds one.

What to look for is a `candidates[0].groundingMetadata.groundingChunks` array. **This is
the one thing in the whole Gemini route that no test in this repository can confirm**,
because it depends on a live response shape that was written from documentation. Three
outcomes, and each is actionable:

- **Chunks present, with `web.uri` and `web.title`** → retrieval works, and the adapter's
  reading of the payload is right. Run a real question through `/research` and confirm
  sources arrive.
- **Chunks present but spelled differently** (a nested `web.url`, a different container) →
  the adapter finds nothing, reports `performedRetrieval: false`, and the run returns an
  `insufficient` result. The fix is `readChunk` in `research/provider/gemini-search-provider.ts`
  and one case in that file's "what it refuses to read" group. The failure is safe; it is
  also invisible unless someone runs this command, which is why it is written down.
- **No `groundingMetadata` at all**, and prose answering from the model's weights → the
  account or model does not have grounding enabled. Orion reports an `insufficient`
  result rather than presenting the prose as sourced, which is correct and is not a bug
  to fix.

`GET /api/research/capabilities` reports retrieval as **configured** for a Gemini
configuration, because the style settles that question without a call — so it will say
configured in all three outcomes above. The capability answer is about whether Orion has
somewhere to send the request, and it never claims a search succeeded; this command is
what settles that.

## When retrieval is not configured

`resolveResearchProvider()` returns the development adapter, whose `isConfigured` is
`false`. Every run that is not pointed at OpenRouter and is not on the Gemini style
therefore stops at `search_not_configured` **before planning**, with a message naming the
variables to set, and the record is `failed` with that error attached. That covers the
`dev` default and every other OpenAI-compatible endpoint — Groq, Together, vLLM, LM
Studio — because the `web` plugin is what makes this a search and only OpenRouter has it.
`GET /api/research/capabilities` reports the same thing before a question is typed, so a
user does not have to spend a run to learn it.

That is a deliberate stop rather than a degradation. The alternative — a run that appears
to search and reports finding nothing — is indistinguishable from a search that genuinely
found nothing, and §"Do not claim a capability works before it does" rules it out.

The development adapter remains the honest state for a fresh checkout, and it is what
makes the whole test suite credential-free: `vitest.setup.ts` clears the provider
environment before every test file, so a developer who has `LLM_API_STYLE` exported in
their shell gets the same deterministic suite as CI rather than live metered requests.

## Source normalisation and deduplication

Normalisation (`url-safety.ts`, `normalize.ts`) does three jobs in a fixed order:

1. **Vet.** `new URL` parses the string first, then the parse is inspected. The order is
   load-bearing: a checker that pattern-matched the raw string would disagree with the
   parser about what a URL means, and the disagreement would be the vulnerability. A
   string that does not parse is rejected rather than repaired.
2. **Canonicalise.** Tracking parameters (`utm_*`, `fbclid` and friends) and the fragment
   are removed, remaining parameters are sorted, and the default port is dropped. Unknown
   parameters are kept, because a query string is often the only thing distinguishing two
   documents on one host.
3. **Deduplicate.** A canonical URL already seen in this run is not added twice. The
   duplicate's id is recorded in an alias map, and every later citation of the discarded
   id is rewritten to the kept one.

The alias map is not bookkeeping. Without it, deduplication would silently orphan
findings: a run would report evidence for a source it no longer holds, and §13's
`Finding → Evidence → Source → URL` chain would be quietly broken while every field was
still populated. `resolveSourceIds` is idempotent, terminates on a cycle, leaves
unresolvable ids alone rather than inventing a target, and preserves order.

Deduplication is **within a run**. There is no cross-run cache, because §20 forbids
long-term memory and because a shared cache would make one run's sources depend on
another's.

## Conflicts

A conflict is recorded, never resolved. `ResearchConflict` names the findings that
disagree, the sources they span, and a one-line description of the disagreement.

Nothing in Orion decides which side is right. Deciding would require judging the sources,
which is a different capability and would need its own evidence. What the run does
instead is make the disagreement visible: the verdict becomes `conflicting` and the
record carries both sides, each with its own quote. A conflict that names fewer than two
findings is refused by the schema, and one whose sides cannot be resolved to real
findings is dropped rather than reported with dangling references.

## The evaluator

`evaluateResearch` is a pure function of the recorded facts — no clock, no provider, no
randomness — which is what makes a verdict reproducible and testable without a provider
at all. Precedence is `failed` > `conflicting` > `sufficient` > `insufficient`.

- **`failed`** — the run was cancelled, produced no tasks, or every task failed. Nothing
  was learned, so there is no partial answer to report.
- **`conflicting`** — a conflict was recorded. Reported even when the run also fell
  short: a verdict naming only the conflict would hide the failure, and one naming only
  the failure would hide the disagreement.
- **`sufficient`** — at least one finding is traced to a retrieved source. A model
  inference alongside a sourced claim does not undo the sourced claim; it is labelled
  where a reader meets it.
- **`insufficient`** — no retrieval, no sources, nothing traceable, a task that failed,
  or a limit that was reached. A run stopped at a ceiling has not finished looking.

Every shortfall is named in the summary, not just the first, and the counts are pluralised
so the text reads as prose rather than as a template.

## Limits and partial results

§22's ceilings are explicit, configurable and read from the environment in one place:

| Variable | Default | What it bounds |
| --- | --- | --- |
| `RESEARCH_MAX_TASKS` | 5 | Retrieval tasks taken from the plan |
| `RESEARCH_MAX_SOURCES_PER_TASK` | 5 | Results kept per search |
| `RESEARCH_MAX_SOURCES` | 20 | Sources retained across the run, after dedup |
| `RESEARCH_MAX_FINDINGS` | 50 | Findings extracted across the run |
| `RESEARCH_MAX_DURATION_MS` | 120000 | Wall-clock ceiling for the loop |

Each is checked before the work it bounds rather than after: a search is pre-sized to the
smaller of the per-task ceiling and the remaining total, so a limit is never exceeded and
then trimmed. Reaching one records *which* one on the result, and the run returns
everything it found — a partial result with its shortfall named, not an error.

A malformed limit throws rather than falling back. An operator who typed
`RESEARCH_MAX_SOURCES=abc` and silently got 20 would believe they had set a ceiling they
had not, and the failure would appear as an unexpectedly expensive run rather than as a
configuration error.

The wall-clock limit is checked between tasks, so it bounds a run rather than interrupting
one mid-request — which means a single slow search can overrun it, and that is recorded
as a gap rather than claimed as a hard deadline.

## The API

| Endpoint | Method | Returns |
| --- | --- | --- |
| `/api/research` | `POST` | `201 { research }` — the finished record |
| `/api/research` | `GET` | `{ research: [summary] }`, most recent first |
| `/api/research/capabilities` | `GET` | The capability record |
| `/api/tools` | `GET` | The default catalogue — **not** including `research.search` |

**A `201` can mean "no answer found".** A question that was planned and searched and not
settled has been answered honestly, and the answer is `insufficient` or `conflicting`
with its sources attached. Returning an error status would throw away the retrieved
material and tell the caller only that something went wrong, which is both less useful
and less true. The only failures that reach an error status are the ones that stopped the
run from being a run at all: a malformed body (400), an oversized one (413), and a
provider that could not be constructed (500, with the detail in the server log and a
fixed message to the client).

Both handlers export `dynamic = "force-dynamic"`. `GET` reads a process-local store that
is empty at build time, so a statically rendered route would capture that empty list and
serve it forever — looking correct and never returning a run that happened.

The records live in a process-local store bounded to 20, oldest evicted first. Like the
execution store, this is the persistence deviation recorded in `ARCHITECTURE.md` §10, not
a design: a record is visible only from the process that produced it, and a read that
misses returns 404 rather than reconstructing a record — reconstructing one would mean
inventing research nobody carried out.

## Workspace integration

The `/research` page renders `ResearchConsole`: the form posts to the real endpoint, and
the panel, activity stream and result card render what the endpoint returned. There is no
simulated progress and no client-side timer — a run finishes inside the request, so the
UI shows a pending state while the request is open and the record when it resolves. The
capability notice reads `/api/research/capabilities` rather than assuming, so a build with
no search configured says so before a question is typed.

`provider.isExternal` and `modelProvider` are rendered, because a result produced by the
deterministic adapter must be recognisable as such from the screen alone.

## Error handling

`AgentExecutionError` codes a research run records, verified against the union rather
than assumed:

| Code | Recorded when |
| --- | --- |
| `search_not_configured` | Retrieval is not configured, before planning |
| `planner_failed` | The model provider could not produce a plan |
| `invalid_plan` | A plan was produced and failed its schema or graph check |
| `evaluation_failed` | The finding extraction response failed its schema |
| `internal_error` | A provider could not be constructed, or anything else escaped |
| `tool_permission_denied`, `invalid_tool_input`, `tool_failed`, `capability_unavailable` | Raised by the Phase 4 executor when a search is refused, and recorded on the step |

A limit that was reached is deliberately **not** an error. It travels on
`ResearchResult.limitsReached` as a `ResearchLimitKind`, because reaching a ceiling is not
a malfunction: the run returns what it found and is reported `insufficient`. Recording it
in `errors` as well would give one condition two representations and make a partial
success look like a failure. `AgentErrorCode` declares `research_limit_reached` for a
consumer that needs to treat a limit as an error — a batch runner retrying with a higher
ceiling — but nothing emits it in this phase, and that is stated in the union's own
comment rather than left to be discovered.

Each code is machine-readable, so the workspace branches on it rather than parsing a
message.

A failure is data. `runResearch` never throws: an error becomes a returned record with
`sufficiency: "failed"` and the material gathered so far still attached. Only a malformed
request and an unconstructable provider become exceptions, and they are converted at the
route boundary. A tool that throws becomes a `tool_failed` receipt and fails its step,
not the run.

## Security

Reviewed against the standard failure modes for a system that records URLs and will
eventually dereference them.

**SSRF and internal destinations.** `parseSourceUrl` rejects loopback, RFC 1918,
link-local (including the cloud metadata address `169.254.169.254`), CGNAT, `0.0.0.0`,
IPv6 unique-local (`fc00::/7`) and link-local (`fe80::/10`), the unspecified address,
`localhost`, single-label hosts, and `.local` / `.internal` suffixes. It also rejects the
alternative encodings that reach the same addresses — `http://2130706433/`,
`http://0x7f.1/`, `http://127.1/`, and IPv4-mapped IPv6 such as `http://[::ffff:127.0.0.1]/`.
That last family is the one worth stating: the URL parser serialises an IPv4-mapped
literal into hex hextets, so `[::ffff:127.0.0.1]` arrives as `::ffff:7f00:1` with no
dotted quad in it. A check looking only for a dotted tail accepts loopback. The address is
decoded and the IPv4 rules applied to what it embeds.

This is a recording and rendering guard in this phase, because Orion does not fetch a
source URL. It is written as though it were a fetcher's guard because it is the only
defence that will be in place on the day one is added, and because a URL that reaches a
renderer as a link is already a hazard.

**Scheme and credential handling.** `javascript:`, `data:`, `file:`, `ftp:`, relative
references, and tab-obfuscated schemes are rejected, case-insensitively and after
`new URL` has resolved obfuscation. A URL carrying `user:pass@` or `user@` is **refused,
not stripped** — a stripped credential is still a destination nobody should have been
sent to, and silently repairing a hostile URL hides the fact that the provider sent one.

**Rejection is counted, not fatal.** A hostile link among twenty is an ordinary outcome
for a search provider. It is dropped, counted as `rejectedSourceCount`, and the run
continues.

**Credentials.** `LLM_API_KEY` is read by one function, which returns it to exactly one
destination — the `Authorization` header of the provider about to make a call. Everything
else, including the capability endpoint and the provider descriptor, sees
`hasApiKey: boolean`. No key is stored on a record, reachable from a tool, or rendered.
Tests assert that a response body contains no `sk-…` string and no `apiKey` field.

**Input handling.** Model output is untrusted: the plan is schema-validated and
graph-checked, the finding response is schema-validated, quotes are verified. Provider
responses are untrusted: every URL is vetted, the domain is re-derived, text is truncated
with a visible marker. Contexts handed to the development adapter are treated as
untrusted and malformed entries are skipped.

**Resource controls.** Every ceiling in *Limits* above exists so that no loop over a
metered endpoint is unbounded, and the request body is capped at 8 KiB before it is
parsed.

**What is not defended, and is recorded rather than implied.** There is no rate limiting
per caller — a limit is per run, and nothing counts runs per identity. There is no
authentication on `/api/research`. There is no tool-call timeout, so a single slow
provider call is bounded only by whatever the platform does with a long request. And the
source-vetting rules are a denylist of address ranges and suffixes; a denylist is
inherently behind a resolver, so a public hostname that resolves to a private address
would pass. All four matter only once a real adapter is configured, and all four are
listed here so that configuring one is a decision taken with them visible.

## Testing

Eleven new test files, plus additive cases in two existing ones. The split follows
`ARCHITECTURE.md` §9: units assert one rule each, and the integration tests drive the real
planner, registry, executor, normaliser, extractor and evaluator against scripted
providers.

| File | What it holds |
| --- | --- |
| `research/service.test.ts` | The whole loop: not-configured, happy path, untraceable claims, dedup, conflicts, all five limits, cancellation, step failure, extraction failure, provider failure, the tool grant |
| `research/url-safety.test.ts` | §24: schemes, credentials, internal destinations, alternate encodings, the return contract |
| `research/normalize.test.ts` | Dedup within and across tasks, the alias map's invariant, `resolveSourceIds` including a cycle |
| `research/evaluator/index.test.ts` | Each verdict, precedence, determinism, no mutation |
| `research/planner/schema.test.ts` | The plan contract, the query identity, duplicate detection |
| `research/findings/schema.test.ts` | Quotes that match and quotes that do not, folding, the response schema |
| `research/tools/search.test.ts` | What the tool reports, URL vetting, the ceiling, bounds, and the default grant |
| `services/research.test.ts` | Validation, the stored record, the 404, the summary projection |
| `api/research/route.test.ts` | Statuses, the body's exact keys, and what a caller cannot inject |
| `api/research/capabilities/route.test.ts` | The capability record, credential absence, dynamic export |
| `lib/validation/research.test.ts` | The request bounds and what the schema discards |
| `lib/env.test.ts` (additive) | Limit parsing, malformed limits, defaults |
| `provider/dev-provider.test.ts` (additive) | The two research operations, checked against the real consumers' schemas |

**No test requires a credential or a network.** The service and route tests are
deterministic in every environment for a structural reason: `resolveResearchProvider()`
returns an unconfigured provider, so a run stops before planning and no call is made.
Provider behaviour is scripted, so the engine under test is real and only the outside
world is fake.

## Not built

Recorded here so that a later reader does not have to infer it from silence.

- **No real retrieval.** See *What is not configured*.
- **`RESEARCH_SEARCH_MODEL` is parsed but not consumed**, because there is no adapter
  that could consume it. Setting it changes nothing.
- **No URL fetching.** Orion records source URLs; it never dereferences one. So no
  content is fetched from a page, only what a provider returned in its response.
- **No long-term memory, vector store or embeddings** (§20).
- **No cross-run source cache.**
- **No background, scheduled or queued runs**, and no cancel endpoint. `runResearch`
  accepts an `isCancelled` callback, but nothing above it can set one — a control wired
  to a flag no request can reach would appear to work and would not.
- **No authentication or rate limiting** on the research endpoints.
- **No tool-call timeout.**
- **No report generation or export.**
- **No multi-agent behaviour** and no multi-call steps: one task calls one tool.
