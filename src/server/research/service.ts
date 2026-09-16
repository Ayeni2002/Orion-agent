import {
  AgentEngineError,
  createId,
  now,
  EventLog,
  ExecutionStateBuilder,
  receiptError,
  resolveModelProvider,
  toAgentExecutionError,
  ToolExecutor,
  type EventSink,
  type ModelProvider,
} from "@/server/agent";
import { getResearchConfig } from "@/lib/env";
import type { AgentExecutionError, ExecutionProvider, Observation } from "@/types/agent";
import type {
  ResearchCapabilities,
  ResearchConflict,
  ResearchEvidence,
  ResearchFinding,
  ResearchLimitKind,
  ResearchLimits,
  ResearchRecord,
  ResearchRequest,
  ResearchResult,
  ResearchSource,
  ResearchTask,
} from "@/types/research";

import { evaluateResearch } from "./evaluator";
import { extractFindings } from "./findings";
import { normalizeSources, resolveSourceIds } from "./normalize";
import { RESEARCH_TOOL_PERMISSION } from "./permission";
import { createResearchPlan } from "./planner";
import { resolveResearchProvider, type ResearchProvider } from "./provider";
import {
  createResearchToolRegistry,
  RESEARCH_SEARCH_TOOL_ID,
  RESEARCH_SEARCH_TOOL_VERSION,
} from "./tools";

/**
 * The research service: one question in, one record out.
 *
 * §2's dedicated service and §10's execution loop, and the two are the same
 * file because they are the same job. The service *is* the loop: resolve a
 * provider, plan, retrieve task by task, extract what the retrieved text
 * establishes, evaluate, and return everything that happened.
 *
 * **What this deliberately does not build.** §26 of the Phase 5 brief rules out
 * re-implementing what Phases 3 and 4 already provide, and the shape of that
 * restraint is visible in the import list above. There is no second runner — the
 * loop below is the only research-specific control flow and it delegates every
 * mechanism it uses:
 *
 *   - **Planning** goes through the Phase 3 `ModelProvider`, so research is
 *     served by the same adapter the agent engine uses and a `dev` style works
 *     without a key.
 *   - **Retrieval** goes through the Phase 4 `ToolExecutor` and a real
 *     `ToolRegistry`, so a search is permission-checked, schema-validated,
 *     timed and receipted by the machinery that already does those things —
 *     there is no second validation path and no second permission check.
 *   - **Events** go through the Phase 3 `EventLog`, emitting the Phase 3
 *     `AgentEventType` members, so the workspace follows a research run with the
 *     component it already has.
 *   - **State** goes through the Phase 3 `ExecutionStateBuilder`.
 *   - **Errors** are the Phase 3 `AgentExecutionError` and the Phase 3 codes.
 *
 * What is genuinely new is only what research genuinely adds: the domain nouns,
 * the retrieval provider seam, the planner's task shape, finding extraction, and
 * the evaluator's verdict.
 *
 * **It never throws.** Like `runAgent`, a failed run is a returned record with
 * `sufficiency: "failed"` and structured errors attached. A caller needs the
 * partial results of a run that went wrong far more than it needs an exception,
 * and §22 requires exactly that.
 *
 * **Two provider seams are resolved here and nowhere else.** The model provider
 * decides who plans and who reads the retrieved text; the research provider
 * decides who searches. Keeping them separate is what makes §8 structural rather
 * than aspirational: the model adapter has no method that can fetch, and the
 * research adapter has no method that can reason. A run cannot confuse which of
 * them produced a sentence, because no code path can ask either one for the
 * other's work.
 */

/** Stand-in provenance for a run whose research provider could not be resolved. */
const UNRESOLVED_RESEARCH_PROVIDER: ExecutionProvider = {
  id: "unresolved",
  label: "No research provider was resolved",
  model: "none",
  isExternal: false,
};

export interface RunResearchParams {
  /** The question, in the user's own words. Untrusted until validated upstream. */
  question: string;
  /** Injected by tests. Resolved from the environment when absent. */
  provider?: ModelProvider;
  /** Injected by tests. Resolved from the environment when absent. */
  researchProvider?: ResearchProvider;
  /** Injected by tests. Read from the environment when absent. */
  limits?: ResearchLimits;
  /** Checked between tasks. Absent means the run cannot be cancelled. */
  isCancelled?: () => boolean;
  /** Observes events as they are emitted. */
  onEvent?: EventSink;
}

/**
 * Accumulates which ceilings the run hit, without duplicates.
 *
 * A `Set` behind two functions rather than a bare array with `.includes()` at
 * each call site, because a limit is reached by a *condition* and conditions can
 * become true repeatedly — every task after the source ceiling is hit would add
 * another copy of the same entry.
 */
class LimitTracker {
  private readonly reached = new Set<ResearchLimitKind>();

  add(kind: ResearchLimitKind): void {
    this.reached.add(kind);
  }

  get any(): boolean {
    return this.reached.size > 0;
  }

  list(): ResearchLimitKind[] {
    // Sorted for a stable result: a caller diffing two runs should not see the
    // order of a Set's insertion as a difference between them.
    return [...this.reached].sort();
  }
}

/** Collapses a statement so two findings saying the same thing compare equal. */
function statementKey(statement: string): string {
  return statement.trim().toLowerCase().replace(/\s+/g, " ");
}

function observation(
  status: Observation["status"],
  message: string,
  extra: Omit<Observation, "id" | "timestamp" | "status" | "message">,
): Observation {
  return {
    id: createId("obs"),
    timestamp: now(),
    status,
    message,
    ...extra,
  };
}

/** `unknown` narrowing for one field of an untrusted tool output. */
function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readSources(value: unknown): ResearchSource[] {
  return Array.isArray(value) ? (value as ResearchSource[]) : [];
}

export async function runResearch({
  question,
  provider: injectedProvider,
  researchProvider: injectedResearchProvider,
  limits: injectedLimits,
  isCancelled,
  onEvent,
}: RunResearchParams): Promise<ResearchRecord> {
  const recordId = createId("research");
  const executionId = createId("exec");
  const events = new EventLog(executionId, onEvent);
  const state = new ExecutionStateBuilder(executionId, question);
  const limitTracker = new LimitTracker();

  const request: ResearchRequest = {
    id: createId("rrequest"),
    question,
    createdAt: now(),
  };

  const createdAt = now();

  let researchProvider: ExecutionProvider = UNRESOLVED_RESEARCH_PROVIDER;
  /**
   * Who planned and read, once that is known.
   *
   * Left undefined until the model provider resolves, because guessing a
   * provenance before a provider exists is how a record ends up crediting an
   * adapter that never ran. `ResearchRecord.modelProvider` is optional for
   * exactly this window — a run that failed during configuration has no model
   * provider to name, and saying so is more honest than naming one anyway.
   */
  let modelProviderDescriptor: ExecutionProvider | undefined;

  /** Everything accumulated so far, so the failure path can still return it. */
  const collected = {
    plan: undefined as ResearchRecord["plan"],
    sources: [] as ResearchSource[],
    findings: [] as ResearchFinding[],
    evidence: [] as ResearchEvidence[],
    conflicts: [] as ResearchConflict[],
    /**
     * What the sources did not establish, gathered across tasks.
     *
     * Accumulated here rather than read back out of the extraction observations,
     * because a result's own field should not be reconstructed by inspecting
     * another record's `output`. Deduplicated on the way in: a gap repeated by
     * two tasks is one gap, and listing it twice would overstate how much is
     * missing.
     */
    unresolvedQuestions: [] as string[],
  };

  const baseRecord = (status: ResearchRecord["status"]): ResearchRecord => ({
    id: recordId,
    request,
    ...(collected.plan === undefined ? {} : { plan: collected.plan }),
    status,
    provider: researchProvider,
    ...(modelProviderDescriptor === undefined
      ? {}
      : { modelProvider: modelProviderDescriptor }),
    observations: state.snapshot().observations,
    events: events.list(),
    sources: collected.sources,
    findings: collected.findings,
    evidence: collected.evidence,
    conflicts: collected.conflicts,
    createdAt,
    updatedAt: now(),
    ...(state.snapshot().startedAt === undefined
      ? {}
      : { startedAt: state.snapshot().startedAt }),
    finishedAt: state.snapshot().finishedAt,
  });

  events.emit("execution.created", "Research request created.", {
    data: { question },
  });

  try {
    let modelProvider: ModelProvider;
    let retrieval: ResearchProvider;
    let limits: ResearchLimits;

    try {
      modelProvider = injectedProvider ?? resolveModelProvider();
      retrieval = injectedResearchProvider ?? resolveResearchProvider();
      limits = injectedLimits ?? getResearchConfig().limits;
    } catch (error) {
      throw new AgentEngineError(
        "internal_error",
        error instanceof Error
          ? error.message
          : "The research providers could not be configured.",
      );
    }

    researchProvider = { ...retrieval.descriptor };
    modelProviderDescriptor = { ...modelProvider.descriptor };

    /**
     * §21's clearest case, and the one worth stating rather than throwing.
     *
     * A build with no retrieval configured is a supported state, not a fault:
     * a fresh checkout has it. What must not happen is a run that appears to
     * search and reports finding nothing — so the run stops here, before
     * planning, and says precisely why. `search_not_configured` rather than
     * `capability_unavailable`, because the difference is who fixes it: the
     * first means an operator has a variable to set, the second means this build
     * has no such capability at all.
     */
    if (!retrieval.isConfigured) {
      const error: AgentExecutionError = {
        code: "search_not_configured",
        message:
          "Web search is not configured, so no sources could be retrieved. " +
          "Set LLM_API_STYLE and LLM_ENDPOINT to a provider that supports " +
          "search, then try again.",
        details: { providerId: retrieval.descriptor.id },
      };

      const summary = `The research could not be carried out. ${error.message}`;

      state.addError(error);
      state.finish("failed");
      // An observation about the *run*, not about a step: nothing was planned,
      // so there is no step to attribute it to. Recording it against the
      // record's own id would be a fabricated step id, which is precisely what
      // `addObservation` exists to avoid.
      state.addObservation(observation("failed", summary, { source: "engine" }));

      events.emit("execution.failed", summary, {
        data: { code: error.code, providerId: retrieval.descriptor.id },
      });

      return {
        ...baseRecord("failed"),
        result: {
          requestId: request.id,
          executionId,
          status: "failed",
          sufficiency: "failed",
          summary,
          question,
          findings: [],
          evidence: [],
          sources: [],
          conflicts: [],
          // Empty rather than "everything": nothing was retrieved, so there is
          // no gap the extractor could have reported. `errors` carries why the
          // run stopped, and inventing gap text here would be the service
          // writing prose it did not get from a source.
          unresolvedQuestions: [],
          errors: [error],
          limitsReached: [],
          completedAt: now(),
        },
      };
    }

    state.setStatus("planning");
    events.emit("execution.planning", "Breaking the question into retrieval tasks.");

    const planned = await createResearchPlan({
      request,
      provider: modelProvider,
      maxTasks: limits.maxTasks,
    });

    collected.plan = planned.plan;

    if (planned.truncated) {
      limitTracker.add("max_tasks");
    }

    events.emit(
      "execution.planned",
      `Planned ${planned.plan.tasks.length} retrieval task(s).`,
      {
        data: {
          taskCount: planned.plan.tasks.length,
          proposedTaskCount: planned.proposedTaskCount,
          truncated: planned.truncated,
        },
      },
    );

    state.setStatus("running");

    events.emit("execution.started", "Retrieving sources for each task.", {
      data: { grantedCapabilities: [...RESEARCH_TOOL_PERMISSION.list()] },
    });

    // Constructed here and nowhere else, with the widened grant. A fresh
    // registry per run, holding the Phase 4 catalogue plus the search tool.
    const toolExecutor = new ToolExecutor(
      createResearchToolRegistry({
        provider: retrieval,
        maxResults: limits.maxSourcesPerTask,
      }),
      RESEARCH_TOOL_PERMISSION,
    );

    const aliasBySourceId = new Map<string, string>();
    const sourceById = new Map<string, ResearchSource>();
    const seenStatements = new Set<string>();

    let performedRetrieval = false;
    const deadlineMs = Date.now() + limits.maxDurationMs;
    let cancelled = false;
    /** Index of the first task that did not run, when the loop stops early. */
    let stoppedAt: number | undefined;

    for (const [index, task] of planned.plan.tasks.entries()) {
      if (isCancelled?.() === true) {
        cancelled = true;
        stoppedAt = index;
        break;
      }

      if (Date.now() > deadlineMs) {
        limitTracker.add("max_duration");
        stoppedAt = index;
        break;
      }

      const room = limits.maxSourcesTotal - collected.sources.length;

      if (room <= 0) {
        limitTracker.add("max_sources_total");
        stoppedAt = index;
        break;
      }

      // Sized to the room remaining *before* the call, never filtered after it.
      // A limit applied after retrieval would either discard material already
      // paid for or leave findings citing sources dropped for exceeding a
      // ceiling the model was never told about.
      const requested = Math.max(1, Math.min(limits.maxSourcesPerTask, room));

      task.status = "running";
      task.updatedAt = now();
      state.startStep(task.id);

      events.emit("step.started", `Searching: ${task.query}`, {
        stepId: task.id,
        data: { taskIndex: task.index, query: task.query },
      });

      events.emit("tool.started", `Calling ${RESEARCH_SEARCH_TOOL_ID}.`, {
        stepId: task.id,
        data: { toolId: RESEARCH_SEARCH_TOOL_ID },
      });

      const receipt = await toolExecutor.execute({
        toolId: RESEARCH_SEARCH_TOOL_ID,
        input: { query: task.query, maxResults: requested },
        executionId,
        taskId: task.id,
        // A research task is not a `TaskStep`, so there is no separate step id
        // to use. The task's own id is the step id, which keeps the receipt, the
        // observation and the task addressable by one identifier rather than
        // three that have to be joined to explain what happened.
        stepId: task.id,
        objective: question,
      });

      events.emit(
        receipt.status === "succeeded" ? "tool.completed" : "tool.failed",
        receipt.status === "succeeded"
          ? `${RESEARCH_SEARCH_TOOL_ID} returned.`
          : `${RESEARCH_SEARCH_TOOL_ID} failed.`,
        {
          stepId: task.id,
          data: {
            toolId: RESEARCH_SEARCH_TOOL_ID,
            toolVersion: receipt.toolVersion ?? RESEARCH_SEARCH_TOOL_VERSION,
            status: receipt.status,
          },
        },
      );

      if (receipt.status !== "succeeded") {
        const error = receiptError(receipt);

        task.status = "failed";
        task.error = error;
        task.updatedAt = now();

        const message = `Retrieval failed: ${error.message}`;

        state.finishStep(
          task.id,
          "failed",
          observation("failed", message, {
            stepId: task.id,
            source: "tool",
            toolId: RESEARCH_SEARCH_TOOL_ID,
            error: error.message,
          }),
          error,
        );

        events.emit("step.failed", message, {
          stepId: task.id,
          data: { code: error.code },
        });

        continue;
      }

      const output = receipt.output ?? {};
      const retrieved = readSources(output.sources);
      const droppedSourceCount = readNumber(output.droppedSourceCount);
      const rejectedSourceCount = readNumber(output.rejectedSourceCount);

      if (readBoolean(output.performedRetrieval)) {
        performedRetrieval = true;
      }

      if (droppedSourceCount > 0) {
        limitTracker.add("max_sources_per_task");
      }

      // Deduplicated against everything the run has already seen. Duplicates
      // are aliased rather than dropped, so a citation the model makes to a
      // repeated source still resolves — see `normalize.ts`.
      const normalized = normalizeSources(retrieved, collected.sources);

      for (const [duplicateId, keptId] of normalized.aliasBySourceId) {
        aliasBySourceId.set(duplicateId, keptId);
      }

      for (const source of normalized.accepted) {
        collected.sources.push(source);
        sourceById.set(source.id, source);
      }

      task.sourceIds = resolveSourceIds(
        retrieved.map((source) => source.id),
        aliasBySourceId,
      );

      // The receipt's payload is the source list, and the source list is stored
      // in full on the record. Copying it into an observation as well would
      // double the size of every record to say the same thing twice, so the
      // observation carries the counts and `collected.sources` carries the
      // sources. Nothing the receipt held is lost: the validated input is the
      // task's query, the error is the task's error, and the output is the
      // sources.
      const retrievalSummary =
        `Retrieved ${retrieved.length} source(s) for "${task.query}" ` +
        `(${normalized.accepted.length} new, ${normalized.duplicateCount} already seen` +
        `${rejectedSourceCount > 0 ? `, ${rejectedSourceCount} rejected` : ""}` +
        `${droppedSourceCount > 0 ? `, ${droppedSourceCount} over the per-task ceiling` : ""}).`;

      const remainingFindingBudget = limits.maxFindings - collected.findings.length;

      if (remainingFindingBudget <= 0) {
        limitTracker.add("max_findings");

        task.status = "completed";
        task.updatedAt = now();

        state.completeStep(
          task.id,
          observation("completed", retrievalSummary, {
            stepId: task.id,
            source: "tool",
            toolId: RESEARCH_SEARCH_TOOL_ID,
            output: {
              retrieved: retrieved.length,
              accepted: normalized.accepted.length,
              duplicates: normalized.duplicateCount,
              rejected: rejectedSourceCount,
              dropped: droppedSourceCount,
            },
          }),
        );

        events.emit("step.completed", retrievalSummary, { stepId: task.id });
        continue;
      }

      // Extraction runs over what this task retrieved — including sources
      // already known, because the same document can support a finding for a
      // different question. Citations to duplicates are remapped below.
      const extraction = await extractFindings({
        task,
        sources: retrieved,
        provider: modelProvider,
        remainingFindingBudget,
      });

      if (!extraction.ok) {
        task.status = "failed";
        task.error = extraction.error;
        task.updatedAt = now();

        state.finishStep(
          task.id,
          "failed",
          observation("failed", retrievalSummary, {
            stepId: task.id,
            source: "tool",
            toolId: RESEARCH_SEARCH_TOOL_ID,
            error: extraction.error.message,
          }),
          extraction.error,
        );

        events.emit("step.failed", extraction.error.message, {
          stepId: task.id,
          data: { code: extraction.error.code },
        });

        continue;
      }

      if (extraction.findingBudgetReached) {
        limitTracker.add("max_findings");
      }

      let addedFindings = 0;
      let duplicateFindingCount = 0;

      for (const finding of extraction.findings) {
        const key = statementKey(finding.statement);

        // A statement the run already recorded adds a duplicate claim, not
        // corroboration — two tasks over overlapping sources routinely produce
        // the same sentence, and counting it twice would overstate the support.
        if (seenStatements.has(key)) {
          duplicateFindingCount += 1;
          continue;
        }

        seenStatements.add(key);
        addedFindings += 1;

        collected.findings.push({
          ...finding,
          sourceIds: resolveSourceIds(finding.sourceIds, aliasBySourceId),
        });
      }

      const addedFindingIds = new Set(
        collected.findings.slice(collected.findings.length - addedFindings).map((f) => f.id),
      );

      for (const record of extraction.evidence) {
        if (!addedFindingIds.has(record.findingId)) {
          continue;
        }

        const sourceId = resolveSourceIds([record.sourceId], aliasBySourceId)[0];

        if (sourceId === undefined) {
          continue;
        }

        collected.evidence.push({
          ...record,
          sourceId,
          // Re-pointed at the kept source's URL rather than the duplicate's, so
          // §13's chain terminates on the URL of the source that is actually in
          // the result. The two are equal by canonicalisation, and taking it
          // from the source itself means they cannot disagree.
          url: sourceById.get(sourceId)?.url ?? record.url,
        });
      }

      for (const conflict of extraction.conflicts) {
        collected.conflicts.push({
          ...conflict,
          sourceIds: resolveSourceIds(conflict.sourceIds, aliasBySourceId),
        });
      }

      for (const gap of extraction.gaps) {
        if (!collected.unresolvedQuestions.includes(gap)) {
          collected.unresolvedQuestions.push(gap);
        }
      }

      task.status = "completed";
      task.updatedAt = now();

      const extractionSummary =
        `${retrievalSummary} ${addedFindings} finding(s) recorded` +
        `${extraction.unverifiedFindingCount > 0 ? `, ${extraction.unverifiedFindingCount} claim(s) could not be traced to text in the source they cited and were recorded as model inferences` : ""}` +
        `${extraction.uncitedFindingCount > 0 ? `, ${extraction.uncitedFindingCount} claim(s) cited no source` : ""}` +
        `${duplicateFindingCount > 0 ? `, ${duplicateFindingCount} duplicate statement(s) skipped` : ""}.`;

      state.completeStep(
        task.id,
        observation("completed", extractionSummary, {
          stepId: task.id,
          source: "tool",
          toolId: RESEARCH_SEARCH_TOOL_ID,
          output: {
            retrieved: retrieved.length,
            accepted: normalized.accepted.length,
            duplicates: normalized.duplicateCount,
            rejected: rejectedSourceCount,
            dropped: droppedSourceCount,
            findings: addedFindings,
            sourceBacked: extraction.findings.filter((finding) => finding.basis === "source")
              .length,
            unverified: extraction.unverifiedFindingCount,
            uncited: extraction.uncitedFindingCount,
            conflicts: extraction.conflicts.length,
            droppedConflicts: extraction.droppedConflictCount,
            gaps: extraction.gaps,
          },
        }),
      );

      events.emit("step.completed", extractionSummary, {
        stepId: task.id,
        data: { findings: addedFindings, sources: retrieved.length },
      });
    }

    // Tasks the run never reached are marked skipped rather than left pending.
    // A pending task in a finished record reads as work still in progress, and
    // the evaluator would then be judging a plan that is partly unaccounted for.
    if (stoppedAt !== undefined) {
      for (const task of planned.plan.tasks.slice(stoppedAt)) {
        task.status = "skipped";
        task.updatedAt = now();

        const message = cancelled
          ? "Not run: the research was cancelled."
          : "Not run: the run reached a limit before this task.";

        state.finishStep(
          task.id,
          "skipped",
          observation("skipped", message, { stepId: task.id, source: "engine" }),
        );

        events.emit("step.skipped", message, { stepId: task.id });
      }
    }

    if (cancelled) {
      state.finish("cancelled");
      events.emit("execution.cancelled", "The research was cancelled.");
    } else {
      state.setStatus("evaluating");
      events.emit("execution.evaluating", "Assessing what the sources establish.");
    }

    const evaluation = evaluateResearch({
      question,
      tasks: planned.plan.tasks,
      sources: collected.sources,
      findings: collected.findings,
      evidence: collected.evidence,
      conflicts: collected.conflicts,
      errors: state.snapshot().errors,
      performedRetrieval,
      limitsReached: limitTracker.list(),
      cancelled,
    });

    if (!cancelled) {
      state.finish(evaluation.sufficiency === "failed" ? "failed" : "completed");

      events.emit(
        evaluation.sufficiency === "failed" ? "execution.failed" : "execution.completed",
        evaluation.summary,
        {
          data: {
            sufficiency: evaluation.sufficiency,
            sourceCount: collected.sources.length,
            findingCount: collected.findings.length,
            conflictCount: collected.conflicts.length,
            limitsReached: limitTracker.list(),
          },
        },
      );
    }

    const finished = state.snapshot();
    const status =
      finished.status === "cancelled"
        ? "cancelled"
        : evaluation.sufficiency === "failed"
          ? "failed"
          : "completed";

    const result: ResearchResult = {
      requestId: request.id,
      executionId,
      status,
      sufficiency: evaluation.sufficiency,
      summary: evaluation.summary,
      question,
      findings: collected.findings,
      evidence: collected.evidence,
      sources: collected.sources,
      conflicts: collected.conflicts,
      unresolvedQuestions: collected.unresolvedQuestions,
      errors: evaluation.errors,
      limitsReached: limitTracker.list(),
      completedAt: now(),
    };

    return {
      id: recordId,
      request,
      plan: planned.plan,
      status,
      provider: researchProvider,
      ...(modelProviderDescriptor === undefined
        ? {}
        : { modelProvider: modelProviderDescriptor }),
      observations: finished.observations,
      events: events.list(),
      sources: collected.sources,
      findings: collected.findings,
      evidence: collected.evidence,
      conflicts: collected.conflicts,
      result,
      createdAt,
      updatedAt: now(),
      ...(finished.startedAt === undefined ? {} : { startedAt: finished.startedAt }),
      ...(finished.finishedAt === undefined ? {} : { finishedAt: finished.finishedAt }),
    };
  } catch (error) {
    const executionError = toAgentExecutionError(error);
    const summary = `The research failed. ${executionError.message}`;

    state.addError(executionError);
    state.finish("failed");

    events.emit("execution.failed", summary, {
      data: { code: executionError.code },
    });

    const finished = state.snapshot();

    return {
      ...baseRecord("failed"),
      observations: finished.observations,
      finishedAt: finished.finishedAt,
      result: {
        requestId: request.id,
        executionId,
        status: "failed",
        sufficiency: "failed",
        summary,
        question,
        findings: collected.findings,
        evidence: collected.evidence,
        sources: collected.sources,
        conflicts: collected.conflicts,
        unresolvedQuestions: collected.unresolvedQuestions,
        errors: finished.errors,
        limitsReached: limitTracker.list(),
        completedAt: now(),
      },
    };
  }
}

/**
 * The research subsystem's capabilities, for the workspace to read before a run.
 *
 * Reports a configuration failure as data rather than throwing, for the same
 * reason `getEngineCapabilities` does: this feeds a status panel, and a panel
 * that 500s tells the user nothing. Never returns a credential — only the
 * descriptor, which carries none.
 */
export function getResearchCapabilities(): ResearchCapabilities {
  try {
    const provider = resolveResearchProvider();
    const config = getResearchConfig();

    return {
      provider: { ...provider.descriptor },
      searchConfigured: provider.isConfigured,
      toolId: RESEARCH_SEARCH_TOOL_ID,
      grantedCapabilities: RESEARCH_TOOL_PERMISSION.list(),
      limits: config.limits,
    };
  } catch (error) {
    return {
      provider: null,
      searchConfigured: false,
      toolId: RESEARCH_SEARCH_TOOL_ID,
      grantedCapabilities: RESEARCH_TOOL_PERMISSION.list(),
      // Reported with defaults rather than omitted, so the panel has a complete
      // shape to render and does not have to branch on a missing field.
      limits: {
        maxTasks: 0,
        maxSourcesPerTask: 0,
        maxSourcesTotal: 0,
        maxFindings: 0,
        maxDurationMs: 0,
      },
      configurationError:
        error instanceof Error
          ? error.message
          : "The research provider could not be configured.",
    };
  }
}
