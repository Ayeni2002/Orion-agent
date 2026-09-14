import type { AgentEvent, AgentEventType } from "@/types/agent";
import { createId, now } from "../ids";

/**
 * Called for every event as it is emitted.
 *
 * The seam that makes streaming possible later without changing the engine: a
 * future transport subscribes here, while the engine keeps appending to the log
 * exactly as it does now. Phase 3 passes no sink — events are collected and
 * returned with the execution.
 */
export type EventSink = (event: AgentEvent) => void;

/**
 * Append-only record of what happened during one execution.
 *
 * Append-only is the important property. State can be mutated and overwritten,
 * so it answers "where is this now?"; the event log is never rewritten, so it
 * answers "how did it get here?" — which is the question actually asked when a
 * run produces something surprising. Nothing in the engine may remove or edit
 * an event.
 */
export class EventLog {
  private readonly executionId: string;
  private readonly sink: EventSink | undefined;
  private readonly events: AgentEvent[] = [];

  constructor(executionId: string, sink?: EventSink) {
    this.executionId = executionId;
    this.sink = sink;
  }

  emit(
    type: AgentEventType,
    message: string,
    options?: { stepId?: string; data?: Record<string, unknown> },
  ): AgentEvent {
    const event: AgentEvent = {
      id: createId("evt"),
      executionId: this.executionId,
      type,
      timestamp: now(),
      message,
      ...(options?.stepId === undefined ? {} : { stepId: options.stepId }),
      ...(options?.data === undefined ? {} : { data: options.data }),
    };

    this.events.push(event);
    this.sink?.(event);

    return event;
  }

  /** Copy, so a caller cannot append to the log behind the engine's back. */
  list(): AgentEvent[] {
    return [...this.events];
  }
}
