import {
  createId,
  now,
  parseModelJson,
  type ModelProvider,
} from "@/server/agent";
import type { AgentExecutionError } from "@/types/agent";
import type {
  ResearchConflict,
  ResearchEvidence,
  ResearchFinding,
  ResearchSource,
  ResearchTask,
} from "@/types/research";

import { findingsResponseSchema, verifyQuote } from "./schema";

/**
 * Finding extraction: retrieved text in, source-backed claims out.
 *
 * This is where §12 stops being a rule and becomes a property. The model is
 * asked for claims and, for each claim it attributes to a source, a verbatim
 * quote from that source. Each quote is then checked against the text that was
 * actually retrieved — see `verifyQuote`. A quote that is not there means the
 * claim was not supported by the source it named, and the finding is downgraded
 * to `basis: "model"` and loses its evidence rather than being deleted.
 *
 * **Why downgrading rather than rejecting.** A model's own inference is often
 * the most useful sentence in a result — "these three sources together imply X"
 * is real work. What is not acceptable is presenting that inference as though a
 * source stated it. Downgrading keeps the sentence and removes the false
 * attribution, which is the honest outcome for both parties: the reader gets the
 * inference labelled as one, and the run's counts show how many claims rested on
 * retrieved text versus on the model.
 *
 * **Why only quotable sources are numbered.** A source retrieved without body
 * text cannot support a quote, so it is left out of the numbered list the model
 * is given. It is still in the result — it was retrieved, and "Orion read this
 * and it supported nothing" is worth seeing — but offering it as a citation
 * target would be inviting a citation that is guaranteed to fail verification.
 * The consequence is that `sourceIndex` refers to the quotable sources in order,
 * and this module resolves it against the same list it built.
 *
 * **A failure here fails one task, not the run.** Every model call can return
 * unusable output, and §22 requires partial results to survive. So this returns
 * an outcome rather than throwing: the caller records the task's error, keeps
 * the sources that task retrieved, and carries on with the rest of the plan.
 */

export const FINDINGS_INSTRUCTION = [
  "You are given a research question and the text of sources retrieved for it.",
  "State what those sources establish about the question.",
  "",
  "Respond with JSON only, matching exactly this shape:",
  '{"findings":[{"statement":"...","sourceIndex":0,"quote":"..."}],',
  ' "conflicts":[{"description":"...","findingIndices":[0,1]}],',
  ' "gaps":["..."]}',
  "",
  "Rules:",
  "- Each finding states ONE thing. One sentence, one claim.",
  "- The sources are numbered. `sourceIndex` is the number of the source the claim comes from.",
  "- `quote` MUST be copied character for character from that source's text. It is checked against the source automatically; a quote that is not present in the source will be discarded and the claim marked as unsupported.",
  "- If a claim is your own inference rather than something a source states, omit `sourceIndex` and `quote` entirely. It will be recorded as a model inference, which is permitted and visible.",
  "- Use `conflicts` ONLY when two findings you extracted cannot both be true. Name them by their position in your own `findings` list.",
  "- Use `gaps` for anything the question asks that these sources do not establish.",
  "- Never state a fact that is not present in the sources you were given.",
].join("\n");

export interface ExtractFindingsParams {
  task: ResearchTask;
  /** Every source retrieved for this task, in retrieval order. */
  sources: ResearchSource[];
  provider: ModelProvider;
  /**
   * How many more findings the whole run may record.
   *
   * The run-wide budget, not a per-task one. Applied here rather than after the
   * fact so the run stops extracting when it is full, rather than extracting and
   * discarding — and reaching it is reported, because a result truncated at
   * fifty findings means something different from one that found fifty.
   */
  remainingFindingBudget: number;
}

export interface ExtractionResult {
  findings: ResearchFinding[];
  evidence: ResearchEvidence[];
  conflicts: ResearchConflict[];
  /** What the sources did not establish, in the model's words. */
  gaps: string[];
  /** Findings that named a source and a quote, where the quote was not in it. */
  unverifiedFindingCount: number;
  /** Findings that cited nothing at all. Permitted, and counted. */
  uncitedFindingCount: number;
  /** Conflicts dropped because one side was not backed by retrieved text. */
  droppedConflictCount: number;
  /** True when the finding budget ran out mid-extraction. */
  findingBudgetReached: boolean;
}

export type ExtractionOutcome =
  | ({ ok: true } & ExtractionResult)
  | { ok: false; error: AgentExecutionError };

/** A source that has text, paired with the number the model is shown for it. */
interface QuotableSource {
  source: ResearchSource;
  content: string;
}

export async function extractFindings({
  task,
  sources,
  provider,
  remainingFindingBudget,
}: ExtractFindingsParams): Promise<ExtractionOutcome> {
  const quotable: QuotableSource[] = [];

  for (const source of sources) {
    if (source.content !== undefined && source.content.trim().length > 0) {
      quotable.push({ source, content: source.content });
    }
  }

  const response = await provider.generate({
    operation: "research_findings",
    instruction: FINDINGS_INSTRUCTION,
    context: {
      question: task.question,
      // Numbered from zero, and only the ones a quote could come from. `content`
      // is already capped by the search tool, so this context is bounded.
      sources: quotable.map(({ source }, index) => ({
        index,
        url: source.url,
        ...(source.title === undefined ? {} : { title: source.title }),
        content: source.content,
      })),
    },
    responseFormat: "json",
  });

  const parsed = parseModelJson(response);

  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        code: "evaluation_failed",
        message: `The finding extraction step did not return usable output. ${parsed.error}`,
      },
    };
  }

  const validated = findingsResponseSchema.safeParse(parsed.value);

  if (!validated.success) {
    return {
      ok: false,
      error: {
        code: "evaluation_failed",
        message:
          "The finding extraction step returned output that did not match the required shape.",
        details: {
          issues: validated.error.issues.slice(0, 10).map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        },
      },
    };
  }

  const timestamp = now();
  const findings: ResearchFinding[] = [];
  const evidence: ResearchEvidence[] = [];
  let unverifiedFindingCount = 0;
  let uncitedFindingCount = 0;
  let findingBudgetReached = false;

  const budget = Math.max(0, remainingFindingBudget);

  for (const extracted of validated.data.findings) {
    if (findings.length >= budget) {
      findingBudgetReached = true;
      break;
    }

    const cited =
      extracted.sourceIndex === undefined || extracted.quote === undefined
        ? undefined
        : quotable[extracted.sourceIndex];

    // A claim earns `basis: "source"` only by passing the check. Everything else
    // — no citation offered, an index out of range, or a quote absent from the
    // source it named — is recorded as the model's own inference.
    const verified = cited !== undefined && verifyQuote(cited.content, extracted.quote ?? "");

    if (extracted.sourceIndex !== undefined && extracted.quote !== undefined && !verified) {
      unverifiedFindingCount += 1;
    } else if (cited === undefined) {
      uncitedFindingCount += 1;
    }

    const findingId = createId("finding");
    const sourceIds = verified && cited !== undefined ? [cited.source.id] : [];

    findings.push({
      id: findingId,
      statement: extracted.statement,
      taskId: task.id,
      basis: verified ? "source" : "model",
      sourceIds,
      createdAt: timestamp,
    });

    if (verified && cited !== undefined && extracted.quote !== undefined) {
      evidence.push({
        id: createId("evidence"),
        findingId,
        sourceId: cited.source.id,
        quote: extracted.quote,
        url: cited.source.url,
        createdAt: timestamp,
      });
    }
  }

  const { conflicts, droppedConflictCount } = buildConflicts({
    extracted: validated.data.conflicts ?? [],
    findings,
    timestamp,
  });

  return {
    ok: true,
    findings,
    evidence,
    conflicts,
    gaps: validated.data.gaps ?? [],
    unverifiedFindingCount,
    uncitedFindingCount,
    droppedConflictCount,
    findingBudgetReached,
  };
}

/**
 * Turns the model's conflict claims into conflict records, or drops them.
 *
 * **A conflict requires both sides to be source-backed.** This is the rule that
 * keeps §16's explicit representation from becoming noise. Two model inferences
 * that appear to disagree are not evidence of a disagreement in the sources —
 * they are two unsupported sentences, and presenting their incompatibility as a
 * finding about the world would manufacture a controversy out of nothing. A
 * conflict is only recorded when every finding it names survived verification
 * and the sources on each side are real.
 *
 * Indices are resolved against the findings that were actually created, which
 * also disposes of a conflict whose side fell outside the finding budget: the
 * index no longer resolves, and the conflict is dropped rather than recorded
 * with a dangling reference.
 */
function buildConflicts({
  extracted,
  findings,
  timestamp,
}: {
  extracted: ReadonlyArray<{ description: string; findingIndices: number[] }>;
  findings: ResearchFinding[];
  timestamp: string;
}): { conflicts: ResearchConflict[]; droppedConflictCount: number } {
  const conflicts: ResearchConflict[] = [];
  let droppedConflictCount = 0;

  for (const candidate of extracted) {
    const named = candidate.findingIndices
      .map((index) => findings[index])
      .filter((finding): finding is ResearchFinding => finding !== undefined);

    // Distinct, because a model that names the same finding twice has not
    // described a disagreement between two things.
    const distinct = [...new Map(named.map((finding) => [finding.id, finding])).values()];

    const grounded =
      distinct.length >= 2 && distinct.every((finding) => finding.basis === "source");

    if (!grounded) {
      droppedConflictCount += 1;
      continue;
    }

    conflicts.push({
      id: createId("conflict"),
      findingIds: distinct.map((finding) => finding.id),
      description: candidate.description,
      sourceIds: [...new Set(distinct.flatMap((finding) => finding.sourceIds))],
      createdAt: timestamp,
    });
  }

  return { conflicts, droppedConflictCount };
}
