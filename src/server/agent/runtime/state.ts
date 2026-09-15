import type {
  AgentExecutionError,
  ExecutionState,
  ExecutionStatus,
  Observation,
  StepStatus,
} from "@/types/agent";
import { now } from "../ids";

/**
 * The only thing allowed to mutate `ExecutionState`.
 *
 * Every transition funnels through here so that `updatedAt` cannot fall out of
 * step with the state it describes, and so `completedStepIds` cannot drift from
 * the step statuses it mirrors. Both are easy to get wrong when callers assign
 * to fields directly, and neither failure is visible until something reads the
 * state much later.
 *
 * Steps and observations are recorded together, in one call, for the same
 * reason: an observation is the evidence for a step's outcome, and a state that
 * records one without the other is a state that cannot be explained afterwards.
 */
export class ExecutionStateBuilder {
  private readonly state: ExecutionState;

  constructor(executionId: string, objective: string) {
    const timestamp = now();

    this.state = {
      executionId,
      objective,
      status: "created",
      completedStepIds: [],
      observations: [],
      errors: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  get executionId(): string {
    return this.state.executionId;
  }

  /**
   * A defensive copy of the current state.
   *
   * Shallow-copies the three arrays so a caller cannot mutate the live state
   * through the snapshot. Nested values inside observations are shared, which
   * is safe because the engine only ever writes fresh objects into them.
   */
  snapshot(): ExecutionState {
    return {
      ...this.state,
      completedStepIds: [...this.state.completedStepIds],
      observations: [...this.state.observations],
      errors: [...this.state.errors],
    };
  }

  get status(): ExecutionStatus {
    return this.state.status;
  }

  setStatus(status: ExecutionStatus): void {
    this.state.status = status;

    if (status === "running" && this.state.startedAt === undefined) {
      this.state.startedAt = now();
    }

    this.touch();
  }

  startStep(stepId: string): void {
    this.state.currentStepId = stepId;
    this.touch();
  }

  completeStep(stepId: string, observation: Observation): void {
    if (!this.state.completedStepIds.includes(stepId)) {
      this.state.completedStepIds.push(stepId);
    }

    this.clearCurrentStep(stepId);
    this.state.observations.push(observation);
    this.touch();
  }

  /**
   * Records a step failure.
   *
   * `error` is optional because a step can also be *skipped*, and the two
   * failure-ish outcomes are deliberately distinguished: a failed step was
   * attempted and went wrong, a skipped step never ran. Only the first is an
   * engine error.
   */
  finishStep(
    stepId: string,
    status: Extract<StepStatus, "failed" | "skipped">,
    observation: Observation,
    error?: AgentExecutionError,
  ): void {
    this.clearCurrentStep(stepId);
    this.state.observations.push(observation);

    if (error !== undefined) {
      this.state.errors.push(error);
    }

    this.touch();
  }

  finish(status: Extract<ExecutionStatus, "completed" | "failed" | "cancelled">): void {
    this.state.status = status;
    this.state.currentStepId = undefined;
    this.state.finishedAt = now();
    this.touch();
  }

  addError(error: AgentExecutionError): void {
    this.state.errors.push(error);
    this.touch();
  }

  /**
   * Records an observation about the run itself rather than about a step.
   *
   * Added in Phase 5, and it fills a gap the type had already anticipated:
   * `Observation.stepId` is documented as absent "for observations about the run
   * itself rather than a step", but until now the only way to add an observation
   * was `completeStep` or `finishStep`, both of which require a step id. A
   * research run that stops before it plans anything — because no retrieval is
   * configured — has exactly such an observation to record, and recording it
   * against a fabricated step id would put a non-step into `completedStepIds`.
   *
   * Deliberately does not touch `completedStepIds`: an observation about the run
   * is not a step completion, and conflating them is what this method exists to
   * avoid.
   */
  addObservation(observation: Observation): void {
    this.state.observations.push(observation);
    this.touch();
  }

  private clearCurrentStep(stepId: string): void {
    if (this.state.currentStepId === stepId) {
      this.state.currentStepId = undefined;
    }
  }

  private touch(): void {
    this.state.updatedAt = now();
  }
}
