import type { AgentErrorCode, AgentExecutionError } from "@/types/agent";
import { ModelProviderError } from "./provider/provider";

/**
 * An engine failure with a machine-readable code.
 *
 * Thrown inside the engine, converted to a plain `AgentExecutionError` before
 * anything crosses a boundary. Keeping the throwable form internal means the
 * planner, executor and evaluator can use ordinary control flow while the
 * outside world only ever sees serializable values.
 */
export class AgentEngineError extends Error {
  readonly code: AgentErrorCode;
  readonly stepId?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AgentErrorCode,
    message: string,
    options?: { stepId?: string; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "AgentEngineError";
    this.code = code;
    this.stepId = options?.stepId;
    this.details = options?.details;
  }
}

/**
 * Message used for any failure the engine did not raise itself.
 *
 * An unexpected error can be anything — a driver error, a fetch failure, a
 * TypeError from a bug. Those messages routinely embed the inputs that produced
 * them, and an input may be a connection string or a header carrying a
 * credential. Since the result is returned to a client, the message is replaced
 * rather than forwarded, and the original goes to the server log where an
 * operator can see it and a browser cannot.
 */
const UNEXPECTED_ERROR_MESSAGE = "The engine encountered an unexpected error.";

/**
 * Converts anything thrown into a structured, client-safe error.
 *
 * Errors the engine raised itself pass their message through: those are written
 * to be safe to display. Everything else is replaced.
 */
export function toAgentExecutionError(error: unknown): AgentExecutionError {
  if (error instanceof AgentEngineError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.stepId === undefined ? {} : { stepId: error.stepId }),
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }

  if (error instanceof ModelProviderError) {
    return { code: "executor_failed", message: error.message };
  }

  // Server-side only. Deliberately not part of the returned value.
  console.error("[agent] unexpected engine error:", error);

  return {
    code: "internal_error",
    message: UNEXPECTED_ERROR_MESSAGE,
    // A class name is a type, never a value, so it is safe to surface and is
    // often enough to tell "a bug in our code" from "the network was down".
    details: { errorName: error instanceof Error ? error.name : typeof error },
  };
}

/** Human-readable one-liner for a failure, used in event messages and summaries. */
export function describeError(error: AgentExecutionError): string {
  return `${error.code}: ${error.message}`;
}
