/**
 * The model provider seam.
 *
 * The engine talks to models only through `ModelProvider`. Nothing above this
 * file names a vendor, imports a vendor SDK, or knows a wire format — which is
 * the property that lets a real provider be added later without touching the
 * planner, the executor or the evaluator.
 *
 * Phase 3 ships exactly one implementation, the deterministic development
 * adapter in `./dev-provider`. No external provider is implemented, and none is
 * half-implemented behind a flag.
 */

import type { ExecutionProvider } from "@/types/agent";

/**
 * Which part of the engine is asking. Lets an adapter answer appropriately.
 *
 * Phase 5 added the two `research_*` members, and they were added rather than
 * folded into `plan` and `execute_step` for a reason worth recording. Research
 * planning asks a different question from agent planning — "what must be
 * established, and what do I search for to establish it" against "what steps
 * does this objective decompose into" — and finding extraction asks a different
 * question again: what does this retrieved passage actually establish. An
 * adapter that had to tell them apart by inspecting its own `context` bag would
 * be guessing at a distinction the type system can simply state.
 *
 * Phase 6 added `report`, on the same reasoning and with one difference worth
 * stating. The first five operations all ask a model to *produce work* — a plan,
 * a step's output, a verdict, an extraction. `report` asks it to *write prose
 * about work that has already been done and recorded*. That is a weaker ask, and
 * the distinction is enforced rather than described: the report schema accepts
 * finding indices and no other reference to the world, so an adapter answering
 * this operation has nothing to invent with. See `src/types/report.ts`.
 *
 * The cost of each addition is that every adapter must handle the new member,
 * and that is the point of a closed union: the compiler names every one of them
 * rather than letting one silently fall through to `undefined`.
 */
export type ModelOperation =
  | "plan"
  | "execute_step"
  | "evaluate"
  | "research_plan"
  | "research_findings"
  | "report";

export interface ModelProviderRequest {
  operation: ModelOperation;
  /** What the engine wants, in natural language. */
  instruction: string;
  /**
   * Structured context for the call.
   *
   * A real adapter MUST serialise this into the prompt it sends — it is context
   * for the model, not a side channel. A deterministic adapter such as the
   * development one may read these fields directly, which is precisely what
   * makes it reproducible: it never has to re-parse its own prompt to recover
   * the objective, a step description or a set of step outcomes.
   */
  context: Record<string, unknown>;
  responseFormat?: "text" | "json";
  maxOutputTokens?: number;
}

export interface ModelProviderResponse {
  /** Raw model output. When `responseFormat` is "json" this is expected to parse. */
  text: string;
  providerId: string;
  model: string;
  finishReason: "stop" | "length" | "error";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

/**
 * What a provider reports about itself.
 *
 * The same shape as the domain's `ExecutionProvider`, aliased rather than
 * redefined so the two can never drift: what a provider reports is exactly what
 * an execution carries, with nothing added or lost in between.
 */
export type ModelProviderDescriptor = ExecutionProvider;

export interface ModelProvider {
  readonly descriptor: ModelProviderDescriptor;
  generate(request: ModelProviderRequest): Promise<ModelProviderResponse>;
}

/**
 * Raised when a provider cannot produce a response.
 *
 * Carries no provider payload: an upstream SDK error can embed the request that
 * produced it, and that request may contain the credential. The message is
 * written to be safe to log and safe to return.
 */
export class ModelProviderError extends Error {
  readonly providerId: string;

  constructor(providerId: string, message: string) {
    super(message);
    this.name = "ModelProviderError";
    this.providerId = providerId;
  }
}

/**
 * Parses a model response that was requested as JSON.
 *
 * Model output is untrusted input. It is fenced in markdown, prefixed with
 * prose, or truncated often enough that a bare `JSON.parse` at each call site
 * becomes a source of unhandled exceptions. This strips the common wrapping and
 * reports failure as a value the caller must handle, rather than throwing
 * somewhere deeper.
 */
export function parseModelJson(
  response: ModelProviderResponse,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = response.text.trim();

  // Strip a ```json … ``` fence if the model added one.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();

  if (candidate.length === 0) {
    return { ok: false, error: "The model returned an empty response." };
  }

  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    return {
      ok: false,
      error: "The model response was not valid JSON.",
    };
  }
}
