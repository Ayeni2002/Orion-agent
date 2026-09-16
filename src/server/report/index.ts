/**
 * The report subsystem.
 *
 * Public surface of everything under `src/server/report`. Callers outside it —
 * services, routes, tests — import from here rather than reaching into
 * subdirectories, so the internal layout stays free to change. The same rule
 * `research/index.ts` and `agent/index.ts` state for the layers beneath it.
 *
 * **The shape of this subsystem, in one paragraph.** A finished
 * `ResearchResult` goes in. The sections that carry evidence — the objective, the
 * findings, the sources and their verified quotes, the conflicts, the questions
 * the run left open — are built from the record by `./deterministic`, which never
 * composes a sentence of its own. A model may write the three sections that are
 * *about* the evidence rather than part of it: an executive summary, the analysis,
 * and suggested next steps. It writes them from a numbered brief of the findings
 * and refers to them by index and by nothing else, because there is no field in
 * its response schema through which a URL, a source name or a quotation could
 * arrive. What it writes is then checked against the brief it was given — every
 * index must resolve to a finding that exists, and every figure must be one it was
 * shown — and a response that fails, or that cites nothing at all, is discarded in
 * favour of the deterministic document with the reason recorded. The result is one
 * `Report`, stored bounded and process-local like every other engine artefact.
 *
 * **What is not here.** No retriever, no search tool, no research planner, no
 * second model seam, no HTML template, no renderer. The first three are Phase 5's
 * and are read through `@/server/research`; the model seam is Phase 3's and is
 * imported from `@/server/agent`; the renderer is a React component and lives in
 * `src/components/reports/`. §2 of the Phase 6 brief requires report generation to
 * be a service of its own and not a branch inside the runner, the executor or the
 * research service, and the import list below is how that is enforced rather than
 * promised — this subsystem reaches *down* into what it was built on and nothing
 * reaches sideways into it.
 *
 * **What is exported and what is not.** The service, the store, the generator and
 * the grounding checks — the last two because a test that exercises the honesty
 * arithmetic directly is a test about the arithmetic, and the same reasoning
 * `research/index.ts` gives for exporting `parseSourceUrl`. The deterministic
 * builder is exported because it is the answer to two separate brief sections:
 * §15's fallback, and the server-authored half of every report a model wrote the
 * prose for.
 */

export { generateReportFor, toReportSummary, type GenerateReportForParams } from "./service";

export {
  clearReports,
  findReportByResearchId,
  getReport,
  listReports,
  MAX_RETAINED_REPORTS,
  saveReport,
} from "./store";

export { generateReport, buildFindingBrief, REPORT_INSTRUCTION, type GenerateReportParams } from "./generator";

export {
  buildCitations,
  buildDeterministicReport,
  buildNextSteps,
  buildServerSections,
  deriveTitle,
  MAX_REPORT_TITLE_LENGTH,
  toReportSources,
} from "./deterministic";

/**
 * The grounding arithmetic, exported for the tests that are about it.
 *
 * §4's requirement is that every statement in a report be traceable, and these
 * four functions are the whole of the machine that enforces it. A test that
 * drives them through `generateReport` would be testing the generator; a test
 * that calls `findUngroundedSentences` with a figure and a set is testing the
 * claim that a fabricated statistic is caught, which is the claim worth being
 * able to make on its own.
 *
 * `splitSentences` is not among them because it does not live here. It is in
 * `@/lib/reports/text`, beside the renderer's own use of it, for the reason that
 * file gives: the two must split identically or the mark lands on the wrong
 * sentence.
 */
export {
  collectGroundedNumbers,
  findUngroundedSentences,
  resolveFindingIndices,
  verifyReportInvariants,
  type CitationResolution,
} from "./grounding";

/**
 * The model-output contract, exported so a test can assert the bounds directly.
 *
 * The bounds are the reason: `MAX_REPORT_SECTIONS` and `MAX_NEXT_STEPS` are
 * applied as truncations by the generator, and a test needs to be able to say
 * "twelve sections in, eight out, four counted" without restating the number.
 */
export {
  MAX_NEXT_STEPS,
  MAX_REPORT_SECTIONS,
  MAX_SECTION_CITATIONS,
  MAX_SUMMARY_CITATIONS,
  modelReportSchema,
  type ModelNextStep,
  type ModelReport,
  type ModelReportSection,
} from "./schema";
