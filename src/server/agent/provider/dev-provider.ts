import { TEXT_ANALYSIS_TOOL_ID } from "../tools/builtin/text-analysis";
import type {
  ModelProvider,
  ModelProviderDescriptor,
  ModelProviderRequest,
  ModelProviderResponse,
} from "./provider";

/**
 * Deterministic development adapter.
 *
 * WHAT THIS IS: a stand-in that lets the engine be built, run and tested end to
 * end without an API key, a network call or a vendor SDK. Given the same
 * request it returns the same response, so a test can assert on engine
 * behaviour without mocking the provider.
 *
 * WHAT THIS IS NOT: an AI. It performs no inference and contacts nothing. Its
 * plan is a fixed analytical skeleton parameterised by the objective text, and
 * its step output is derived from the step description. It must therefore never
 * be presented to a user as if a model produced it — `descriptor.isExternal` is
 * `false`, the descriptor label says "deterministic", and every execution
 * carries that descriptor so the UI can say plainly which one ran. Replacing it
 * with a real provider is a change to `resolveModelProvider` and nothing else.
 *
 * The one thing it does beyond emitting prose is propose a tool call: when the
 * objective both asks for a text measurement and supplies the text, the
 * skeleton gains a step naming `text.analyze` with that text as its input. The
 * adapter proposes; it does not decide — the tool's own schema validates the
 * input and `ToolExecutor` decides whether the run may make the call.
 *
 * Determinism has one wrinkle worth stating: `createdAt`/`timestamp` values are
 * real clock reads, so two runs of the same objective differ in their
 * timestamps while their plans and step outputs are identical. Tests assert on
 * the latter.
 *
 * Phase 5 added two more operations, for the research subsystem: `research_plan`
 * and `research_findings`. Both follow the same rule as the rest of this file —
 * they rearrange text that was handed to them and state nothing they were not
 * given. `research_findings` in particular quotes its sources verbatim rather
 * than summarising them, so the finding extractor's quote check passes for
 * reasons that are structural rather than lucky: an adapter that cannot invent
 * cannot fail an honesty check, and an adapter that cannot fail an honesty check
 * is not a substitute for a model.
 */

export const DEV_PROVIDER_ID = "dev";
export const DEV_MODEL_ID = "orion-dev-deterministic";

/**
 * The capability the planner requests when an objective calls for information
 * from outside Orion.
 *
 * Still nothing registers this, and Phase 4 did not change that — the tool
 * system arrived, but web search was explicitly out of its scope. The engine's
 * behaviour when a plan asks for a capability the runtime cannot supply is real
 * behaviour that has to keep working, and this is the honest way to exercise
 * it: the step fails with `capability_unavailable` and says so, rather than a
 * placeholder quietly returning invented "findings".
 */
export const EXTERNAL_RESEARCH_CAPABILITY = "web.search";

/** Phrases that mean the objective wants external information. */
const EXTERNAL_RESEARCH_TERMS = [
  "web",
  "internet",
  "online",
  "browse",
  "scrape",
  "crawl",
  "search the",
  "google",
  "look up",
];

/**
 * Phrases that mean the objective wants a block of text measured.
 *
 * Phase 4's addition. The adapter may only propose the text analysis tool when
 * the objective both asks for it and actually contains text to measure — see
 * `extractAnalysableText`, which is why "how many words are in this sentence"
 * does not produce a tool step: there is no supplied text, and inventing one
 * would be fabrication.
 */
const TEXT_ANALYSIS_TERMS = [
  "analyze this text",
  "analyse this text",
  "analyze the text",
  "analyse the text",
  "analyze the following",
  "analyse the following",
  "text analysis",
  "word count",
  "character count",
  "sentence count",
  "paragraph count",
  "count the words",
  "count the characters",
  "count the sentences",
  "count the paragraphs",
  "how many words",
  "how many characters",
];

/** Longest objective excerpt echoed into a step description. */
const FOCUS_MAX_LENGTH = 120;

/** One step as the adapter emits it. Indices are resolved to real ids by the planner. */
interface DevPlanStep {
  description: string;
  expectedOutput: string;
  dependsOn: number[];
  toolId?: string;
  toolInput?: Record<string, unknown>;
}

/** Collapses whitespace and truncates, so a multi-line objective stays one readable line. */
function summarize(objective: string): string {
  const collapsed = objective.replace(/\s+/g, " ").trim();

  if (collapsed.length <= FOCUS_MAX_LENGTH) {
    return collapsed;
  }

  return `${collapsed.slice(0, FOCUS_MAX_LENGTH - 1).trimEnd()}…`;
}

function wantsExternalResearch(objective: string): boolean {
  const lower = objective.toLowerCase();
  return EXTERNAL_RESEARCH_TERMS.some((term) => lower.includes(term));
}

function wantsTextAnalysis(objective: string): boolean {
  const lower = objective.toLowerCase();
  return TEXT_ANALYSIS_TERMS.some((term) => lower.includes(term));
}

/**
 * Pulls the text to measure out of the objective.
 *
 * Only two shapes are recognised, and both take the text from what the user
 * actually wrote rather than generating any:
 *
 *   1. everything after the first colon — "Analyze this text: <the text>"
 *   2. the first double-quoted run — 'Count the words in "Hello there."'
 *
 * Returns `undefined` when neither is present, and the caller then emits no
 * tool-backed step at all. That is the important part: the alternative —
 * measuring the objective text itself, or a placeholder — would be the adapter
 * inventing its own input, and a tool result computed from invented input is
 * indistinguishable to a reader from a real one.
 */
function extractAnalysableText(objective: string): string | undefined {
  const colonIndex = objective.indexOf(":");

  if (colonIndex !== -1) {
    const afterColon = objective.slice(colonIndex + 1).trim();

    if (afterColon.length > 0) {
      return afterColon;
    }
  }

  // Straight quotes first, then the typographic pair, so a text pasted from a
  // word processor is still recognised.
  const straight = /"([^"]+)"/.exec(objective);
  const curly = /“([^”]+)”/.exec(objective);
  const quoted = (straight ?? curly)?.[1]?.trim();

  return quoted !== undefined && quoted.length > 0 ? quoted : undefined;
}

/**
 * The plan skeleton.
 *
 * Deliberately a linear spine with one optional branch rather than a fully
 * connected graph: the executor's dependency handling is exercised by the
 * branch, and a spine keeps the emitted plan readable to a human checking the
 * engine's output by eye.
 */
function buildPlanSteps(objective: string): DevPlanStep[] {
  const focus = summarize(objective);

  const steps: DevPlanStep[] = [
    {
      description: `Restate the objective in precise terms and define what a satisfactory result looks like: ${focus}`,
      expectedOutput:
        "A restatement of the objective together with explicit success criteria.",
      dependsOn: [],
    },
    {
      description:
        "Identify the information the result depends on, separating what is already known from what is not.",
      expectedOutput: "A list of required facts, each marked known or unknown.",
      dependsOn: [0],
    },
    {
      description:
        "Analyse the objective against its constraints, risks and open questions.",
      expectedOutput: "Constraints, risks and unresolved questions.",
      dependsOn: [1],
    },
  ];

  // The text analysis branch. Emitted only when the objective asks for a
  // measurement AND supplies the text to measure, so the tool step always
  // carries real input the user wrote.
  //
  // Hung off step 2 like the research branch, and for the same reason: it is a
  // leaf. Synthesis does not depend on it, so a refused or failed analysis
  // degrades the result instead of cancelling the run.
  if (wantsTextAnalysis(objective)) {
    const text = extractAnalysableText(objective);

    if (text !== undefined) {
      steps.push({
        description: "Measure the supplied text with the text analysis tool.",
        expectedOutput:
          "Character, word, sentence and paragraph counts for the supplied text.",
        dependsOn: [2],
        toolId: TEXT_ANALYSIS_TOOL_ID,
        toolInput: { text },
      });
    }
  }

  if (wantsExternalResearch(objective)) {
    steps.push({
      description:
        "Gather supporting information from sources outside Orion to fill the gaps identified above.",
      expectedOutput: "Retrieved source material relevant to the objective.",
      dependsOn: [2],
      toolId: EXTERNAL_RESEARCH_CAPABILITY,
    });
  }

  // Synthesis depends on the analytical spine only — not on the research step.
  // So a failed research step degrades the result instead of cancelling the
  // run, which is the behaviour a real engine needs and the one worth testing.
  const synthesisIndex = steps.length;

  steps.push({
    description: "Synthesise the analysis into a recommendation.",
    expectedOutput:
      "A recommendation together with the reasoning that supports it.",
    dependsOn: [0, 1, 2],
  });

  steps.push({
    description:
      "Review the recommendation against the success criteria set out in the first step.",
    expectedOutput:
      "A judgement on whether the objective is met, plus any remaining gaps.",
    dependsOn: [synthesisIndex],
  });

  return steps;
}

/** Reads a context field as a string, or returns undefined. Context is untrusted. */
function readContextString(
  context: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = context[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/**
 * Bounds the adapter imposes on its own research output.
 *
 * Duplicated from the research schemas rather than imported, and that is a
 * layering decision rather than an oversight: the agent engine does not depend
 * on the research subsystem built on top of it, and an adapter reaching down
 * into `src/server/research/` for a constant would invert that. The duplication
 * is safe because it is checked — the research planner and the finding extractor
 * both validate this adapter's output against their own schemas, so a drift
 * between these numbers and those surfaces as a failed extraction in a test
 * rather than as silently truncated text in a result.
 */
const DEV_STATEMENT_MIN_LENGTH = 8;
const DEV_STATEMENT_MAX_LENGTH = 500;
const DEV_QUOTE_MIN_LENGTH = 8;
const DEV_QUOTE_MAX_LENGTH = 1_000;

/**
 * The facets the deterministic adapter breaks every research question into.
 *
 * Fixed, and deliberately not derived from the question. This adapter performs
 * no inference, so any facet list it produced by "reading" the question would be
 * a pattern match dressed up as understanding. Three stable facets are honest
 * about what is happening and still exercise the loop — several tasks, several
 * queries, several sets of results.
 *
 * Every query must differ from the others: the plan schema refuses duplicate
 * queries, because two tasks searching the same thing retrieve one source and
 * the run pays for two.
 */
const DEV_RESEARCH_FACETS = [
  "background and definitions",
  "current state and recent developments",
  "criticism, limitations and open questions",
] as const;

/**
 * The opening of a source's text, shaped to fit the quote contract.
 *
 * Whitespace is collapsed before measuring, which is safe rather than lossy: the
 * quote check normalises both sides, so a collapsed quote still verifies against
 * the raw source text.
 *
 * The cut is made at a whitespace boundary rather than at an exact offset. A
 * slice taken mid-character can split a sequence that NFKC composes differently
 * depending on where it starts, and a quote that normalises to something the
 * source does not contain would be downgraded to a model inference — the one
 * failure this adapter must not manufacture, because it would make the run's own
 * honesty counters report a problem that does not exist.
 *
 * Returns `undefined` when there is nothing quotable, and the caller then emits
 * no finding for that source. A source with no text cannot support a quote, and
 * a finding resting on one would be exactly the unsupported attribution §12
 * exists to catch.
 *
 * The floor is checked against the whole source before anything is cut, and that
 * ordering is the fix for a real defect rather than a tidy-up. Without it, a
 * source reading "Hi." produced the quote "Hi." — three characters, below the
 * extractor's own `QUOTE_MIN_LENGTH`, so the response failed schema validation
 * and the *entire* extraction failed with it. One stub page was enough to turn a
 * run's findings into an error. A source with nothing long enough to quote now
 * yields no finding, which is the outcome this function's contract already
 * promised for an unquotable source.
 */
function excerpt(content: string): string | undefined {
  const collapsed = content.replace(/\s+/g, " ").trim();

  if (collapsed.length < DEV_QUOTE_MIN_LENGTH) {
    return undefined;
  }

  // Prefer a complete opening sentence, but only when it is long enough to
  // quote. A stub like "Home." is not a passage, so the raw opening is used
  // instead — it is still verbatim, which is the only property that matters.
  const sentence = /^.*?[.!?](?=\s|$)/.exec(collapsed)?.[0]?.trim();
  const candidate =
    sentence !== undefined && sentence.length >= DEV_QUOTE_MIN_LENGTH
      ? sentence
      : collapsed;

  if (candidate.length <= DEV_QUOTE_MAX_LENGTH) {
    return candidate;
  }

  const boundary = candidate.lastIndexOf(" ", DEV_QUOTE_MAX_LENGTH);
  const cut = candidate
    .slice(0, boundary > 0 ? boundary : DEV_QUOTE_MAX_LENGTH)
    .trim();

  return cut.length >= DEV_QUOTE_MIN_LENGTH ? cut : undefined;
}

/** Truncates a statement at a word boundary. A statement is not quoted, so this is free to shorten it. */
function clampStatement(statement: string): string {
  const collapsed = statement.replace(/\s+/g, " ").trim();

  if (collapsed.length <= DEV_STATEMENT_MAX_LENGTH) {
    return collapsed;
  }

  const boundary = collapsed.lastIndexOf(" ", DEV_STATEMENT_MAX_LENGTH);

  return collapsed
    .slice(0, boundary > 0 ? boundary : DEV_STATEMENT_MAX_LENGTH)
    .trim();
}

/** One numbered source as the finding extractor supplies it. Context is untrusted. */
interface DevContextSource {
  index: number;
  url: string;
  title?: string;
  content?: string;
}

function readContextSources(value: unknown): DevContextSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sources: DevContextSource[] = [];

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const { index, url, title, content } = record;

    // The sign matters as much as the type. `extractedFindingSchema` declares
    // `sourceIndex` as a non-negative integer, so an entry numbered -1 was
    // accepted here and then rejected by the extractor — turning one malformed
    // entry in the context into a failed extraction for the whole run. The
    // filter now matches the contract it feeds.
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0
    ) {
      continue;
    }

    sources.push({
      index,
      url: typeof url === "string" ? url : "",
      ...(typeof title === "string" && title.trim().length > 0
        ? { title: title.trim() }
        : {}),
      ...(typeof content === "string" ? { content } : {}),
    });
  }

  return sources;
}

function jsonResponse(value: unknown, model: string): ModelProviderResponse {
  return {
    text: JSON.stringify(value, null, 2),
    providerId: DEV_PROVIDER_ID,
    model,
    finishReason: "stop",
  };
}

export function createDevModelProvider(
  model: string = DEV_MODEL_ID,
): ModelProvider {
  const descriptor: ModelProviderDescriptor = {
    id: DEV_PROVIDER_ID,
    label: "Deterministic development adapter (no external model)",
    isExternal: false,
    model,
  };

  function respond(request: ModelProviderRequest): ModelProviderResponse {
    switch (request.operation) {
      case "plan": {
        const objective = readContextString(request.context, "objective") ?? "";
        return jsonResponse({ steps: buildPlanSteps(objective) }, model);
      }

      case "execute_step": {
        const description =
          readContextString(request.context, "stepDescription") ?? "the step";
        const objective =
          readContextString(request.context, "objective") ?? "the objective";

        return jsonResponse(
          {
            summary: `Produced output for: ${summarize(description)}`,
            notes: [
              "Generated by the deterministic development adapter, not a language model.",
              `Assessed against the objective: ${summarize(objective)}`,
            ],
          },
          model,
        );
      }

      case "evaluate": {
        const outcomes = request.context.stepOutcomes;
        const counts = Array.isArray(outcomes)
          ? {
              completed: outcomes.filter((o) => o === "completed").length,
              failed: outcomes.filter((o) => o === "failed").length,
              skipped: outcomes.filter((o) => o === "skipped").length,
            }
          : { completed: 0, failed: 0, skipped: 0 };

        return jsonResponse(
          {
            summary:
              `${counts.completed} step(s) completed, ${counts.failed} failed, ` +
              `${counts.skipped} skipped. Generated by the deterministic ` +
              "development adapter, not a language model.",
            confidence: counts.failed > 0 ? "low" : "medium",
          },
          model,
        );
      }

      /**
       * Phase 5's first research operation: a question in, retrieval tasks out.
       *
       * The shape is what the research planner's schema requires, and the values
       * are what it is possible to produce without inference: a fixed
       * decomposition of whatever was asked, with the question text echoed
       * verbatim into each query rather than interpreted. Nothing here states a
       * fact about the subject — §7's rule that a plan says what to look up and
       * never what is true applies to this adapter too, and applies most of all
       * to it, since a deterministic adapter has no way to be right.
       */
      case "research_plan": {
        const question =
          readContextString(request.context, "question") ?? "the research question";
        const focus = summarize(question);

        return jsonResponse(
          {
            restatement:
              `A fixed ${DEV_RESEARCH_FACETS.length}-part decomposition of: ${focus}. ` +
              "Produced by the deterministic development adapter, which does not read the question.",
            tasks: DEV_RESEARCH_FACETS.map((facet) => ({
              question: `Establish the ${facet} relevant to: ${focus}`,
              query: `${focus} ${facet}`,
            })),
          },
          model,
        );
      }

      /**
       * Phase 5's second research operation: retrieved text in, findings out.
       *
       * This one is worth reading carefully, because it is the adapter most able
       * to produce something that *looks* like research and is not. It does not
       * summarise, interpret or conclude. It copies the opening of each source
       * that has text, labels the copy with where it came from, and claims
       * nothing else — so every finding it emits is `basis: "source"` by
       * construction, and the quote it supplies is a real substring of the text
       * it cites. A real model's output can fail that check; this one cannot,
       * which is precisely why it is not a model.
       *
       * Sources with no content produce no finding, because there would be
       * nothing to quote. And the gap it reports is the truthful one: it does
       * not judge whether these sources answer the question, because judging
       * that is inference and this adapter does not infer.
       */
      case "research_findings": {
        const question =
          readContextString(request.context, "question") ?? "the question";
        const sources = readContextSources(request.context.sources);
        const findings: Array<{
          statement: string;
          sourceIndex: number;
          quote: string;
        }> = [];

        for (const source of sources) {
          const quote = source.content === undefined ? undefined : excerpt(source.content);

          if (quote === undefined) {
            continue;
          }

          const label =
            source.title ?? (source.url.length > 0 ? source.url : `source ${source.index}`);
          const statement = clampStatement(`${label} contains: ${quote}`);

          if (statement.length < DEV_STATEMENT_MIN_LENGTH) {
            continue;
          }

          findings.push({ statement, sourceIndex: source.index, quote });
        }

        return jsonResponse(
          {
            findings,
            gaps: [
              clampStatement(
                "The deterministic development adapter copies text out of each source " +
                  `without interpreting it, so it does not judge whether these sources answer the question: ${summarize(question)}`,
              ),
            ],
          },
          model,
        );
      }
    }
  }

  return {
    descriptor,
    // Returns a resolved promise rather than being declared `async`: the body
    // is synchronous, and a promise resolved synchronously still lets a future
    // external adapter — which really is async — drop in behind this interface.
    generate: (request) => Promise.resolve(respond(request)),
  };
}
