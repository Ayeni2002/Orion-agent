import type { ResearchCapabilities, ResearchRecord, ResearchSummary } from "@/types/research";
import { researchRequestSchema } from "@/lib/validation/research";
import { ServiceError } from "../errors";
import {
  getResearch,
  getResearchCapabilities as readResearchCapabilities,
  listResearch,
  runResearch,
  saveResearch,
} from "../research";

/**
 * Research, as the rest of the application sees it.
 *
 * The counterpart of `services/agent.ts`, and it does the same three jobs in the
 * same order: validate at the boundary, run, record. The engine below it returns
 * data and never throws — a research run that failed is a returned record with
 * `sufficiency: "failed"` — so this layer is where "the run failed" becomes an
 * HTTP status, if it becomes one at all.
 *
 * **A failed run is a `201`, not a `500`.** That is the deliberate part. A
 * question that was asked, planned and searched, and whose sources did not
 * settle it, has been answered honestly — the answer is `insufficient` or
 * `conflicting`, and it belongs in the response body with its sources attached.
 * Returning an error status would throw away the retrieved material and tell the
 * caller only that something went wrong, which is both less useful and less
 * true. The only failures that reach `toErrorResponse` are the ones that stopped
 * the run from being a run at all: a malformed request body, and a provider that
 * could not be constructed.
 *
 * **Nothing here accepts research state from a caller.** There is no parameter
 * through which a client could supply a source, a finding or a sufficiency
 * verdict, and therefore no way for a request to assert that work was done. That
 * is the same structural property `services/agent.ts` describes, and it matters
 * more here: a finding is a claim about the world with a URL behind it, and a
 * client able to inject one could manufacture evidence.
 */

/**
 * Runs a research question to completion and returns the record.
 *
 * `input` is `unknown` on purpose — it arrives from a request body and is
 * untrusted until the schema has passed it. The run finishes inside this call:
 * there is no queue and no background worker, so when this resolves the record
 * is terminal and carries its own result.
 *
 * **Cancellation is not exposed, and that is not an omission.** `runResearch`
 * accepts an `isCancelled` callback and checks it between tasks, so the engine
 * can stop a run. Nothing above the engine can currently tell it to, because
 * this call does not return until the run is over and there is no run registry a
 * second request could reach into. Wiring a cancel endpoint to a flag no request
 * can set would be a control that appears to work and does not, so the parameter
 * stays where it is until a phase introduces durable runs.
 */
export async function startResearch(input: unknown): Promise<ResearchRecord> {
  const parsed = researchRequestSchema.safeParse(input);

  if (!parsed.success) {
    throw new ServiceError(
      parsed.error.issues.map((issue) => issue.message).join(" ") ||
        "The research question is not valid.",
      400,
    );
  }

  const record = await runResearch({ question: parsed.data.question });

  // Recorded after the run rather than before, so the store only ever holds
  // records that have finished. A caller reading a list of in-flight runs would
  // be reading a store that cannot answer for them anyway.
  saveResearch(record);

  return record;
}

export function getResearchById(id: string): ResearchRecord {
  const record = getResearch(id);

  if (record === undefined) {
    throw new ServiceError("No research record with that id was found.", 404);
  }

  return record;
}

export function listRecentResearch(): ResearchRecord[] {
  return listResearch();
}

/**
 * A list entry, without the parts that only matter once you open one.
 *
 * The same decision `ExecutionSummary` makes, with more at stake: a full
 * research record carries every source with its retrieved text, every finding,
 * every evidence passage and the whole event log. That is the right size for one
 * record and completely the wrong size for a list of twenty.
 */
export function toResearchSummary(record: ResearchRecord): ResearchSummary {
  return {
    id: record.id,
    question: record.request.question,
    status: record.status,
    ...(record.result === undefined ? {} : { sufficiency: record.result.sufficiency }),
    provider: record.provider,
    sourceCount: record.sources.length,
    findingCount: record.findings.length,
    conflictCount: record.conflicts.length,
    createdAt: record.createdAt,
    ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
    ...(record.result?.summary === undefined ? {} : { summary: record.result.summary }),
  };
}

export function listRecentResearchSummaries(): ResearchSummary[] {
  return listResearch().map(toResearchSummary);
}

/**
 * What the research subsystem can currently do.
 *
 * Delegated to the engine rather than re-derived here, so there is one answer to
 * "is retrieval configured?" and the route that serves it cannot disagree with
 * the run that performs it. Never returns a credential: the capability record
 * carries a provider *descriptor*, which holds an id, a label, a model name and
 * a flag, and no key.
 */
export function getResearchCapabilities(): ResearchCapabilities {
  return readResearchCapabilities();
}
