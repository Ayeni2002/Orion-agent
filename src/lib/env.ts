import { z } from "zod";

import type { ResearchLimits } from "@/types/research";

/**
 * Environment configuration.
 *
 * Every environment value is read here and nowhere else, so a missing or
 * malformed variable fails with one readable message at the point of use
 * instead of as an obscure error deeper inside a client. Nothing here has a
 * default secret — all values come from the environment.
 *
 * `NEXT_PUBLIC_*` variables are inlined into the browser bundle by Next at
 * build time, which only works for literal `process.env.X` property accesses.
 * A computed lookup such as `process.env[name]` is not replaced in client code
 * and would resolve to `undefined` in the browser, so the reads below are
 * deliberately spelled out.
 */

const supabaseConfigSchema = z.object({
  url: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL."),
  anonKey: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required."),
});

export type SupabaseConfig = z.infer<typeof supabaseConfigSchema>;

function readSupabaseConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/**
 * Whether the public Supabase variables are present.
 *
 * Phase 1 renders without a database, so callers that can degrade should use
 * this rather than treating a missing project as a fatal error.
 */
export function isSupabaseConfigured(): boolean {
  return supabaseConfigSchema.safeParse(readSupabaseConfig()).success;
}

/**
 * Supabase configuration, or a readable error naming what is missing.
 *
 * Throws rather than returning a partially-formed client: a client built from
 * a missing URL fails much later, with a message that does not mention the
 * environment.
 */
export function getSupabaseConfig(): SupabaseConfig {
  const parsed = supabaseConfigSchema.safeParse(readSupabaseConfig());

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.message}`)
      .join("\n");

    throw new Error(
      `Supabase is not configured.\n${problems}\n` +
        "Copy .env.example to .env.local and fill in the values.",
    );
  }

  return parsed.data;
}

/**
 * The wire protocol a model endpoint speaks.
 *
 * Naming the *style* rather than the vendor is the point of it. OpenRouter,
 * Groq, Together, vLLM, LM Studio and OpenAI itself all speak the same
 * `/chat/completions` protocol, so any of them is configured by pointing
 * `LLM_ENDPOINT` at it rather than by adding an adapter. A genuinely different
 * protocol — Anthropic's messages API, Gemini's `generateContent` — would be a
 * new member here and a new adapter beside it, not a special case threaded
 * through an existing one.
 *
 * `dev` is the deterministic local adapter: no endpoint, no credential, no
 * network call. It is the default, so a fresh checkout runs with no
 * configuration at all.
 *
 * A style is listed here only once an adapter for it exists. Naming one that
 * Orion cannot construct would turn a configuration mistake into a run that
 * silently produces development output while appearing to be a real inference
 * call, so `getModelProviderConfig` rejects an unknown value loudly instead.
 */
export const SUPPORTED_API_STYLES = ["dev", "openai"] as const;

export type LlmApiStyle = (typeof SUPPORTED_API_STYLES)[number];

const apiStyleSchema = z.enum(SUPPORTED_API_STYLES);
const endpointSchema = z.string().url();

export interface ModelProviderConfig {
  style: LlmApiStyle;
  /** Base URL of the endpoint, without the `/chat/completions` suffix. */
  endpoint?: string;
  model?: string;
  /**
   * Whether an API key is present in the environment — never the key itself.
   *
   * This is what the settings screen and the capabilities endpoint read, and it
   * is deliberately a boolean: a caller can report that Orion is configured
   * without ever holding the credential. The value itself is reachable only
   * through `readModelApiKey` below, which exists so the adapter can hand it
   * straight to its client.
   */
  hasApiKey: boolean;
}

/**
 * The credential, for the one caller that has to send it.
 *
 * This is the single function in the application that returns a secret, and it
 * is separate from `getModelProviderConfig` on purpose. That function's result
 * is spread into descriptors, returned from services and rendered by the
 * settings screen; a credential living on it would travel with every copy. Here
 * the value has exactly one destination — the `Authorization` header of the
 * provider that is about to make a call — and nothing that returns it to a
 * caller can also return an execution.
 *
 * Returns `undefined` when unset, which is legitimate rather than an error: a
 * local endpoint such as vLLM or LM Studio needs no credential.
 */
export function readModelApiKey(): string | undefined {
  const key = process.env.LLM_API_KEY?.trim();
  return key === undefined || key.length === 0 ? undefined : key;
}

/**
 * Model provider configuration.
 *
 * Defaults to the deterministic development adapter when `LLM_API_STYLE` is
 * unset, so a fresh checkout runs without any configuration at all.
 *
 * Configuration problems throw rather than degrade. Each of the three failures
 * below — an unknown style, a missing endpoint, a malformed endpoint — produces
 * a message naming the variable to fix, because the alternative is a run that
 * appears to use a real model and does not.
 */
export function getModelProviderConfig(): ModelProviderConfig {
  const rawStyle = process.env.LLM_API_STYLE?.trim() || "dev";
  const endpoint = process.env.LLM_ENDPOINT?.trim() || undefined;
  const model = process.env.LLM_MODEL?.trim() || undefined;

  const parsedStyle = apiStyleSchema.safeParse(rawStyle);

  if (!parsedStyle.success) {
    throw new Error(
      `LLM_API_STYLE is set to "${rawStyle}", which Orion does not implement. ` +
        `Supported values: ${SUPPORTED_API_STYLES.join(", ")}. ` +
        "Leave it unset to use the deterministic development provider.",
    );
  }

  const style = parsedStyle.data;

  // A remote style without an endpoint has nowhere to send its request, and
  // finding that out at the first tool call rather than at startup would put
  // the failure in the middle of a run.
  if (style !== "dev" && endpoint === undefined) {
    throw new Error(
      `LLM_API_STYLE is "${style}", which needs a remote endpoint, but ` +
        "LLM_ENDPOINT is not set. Set it to the provider's base URL — for " +
        'OpenRouter that is "https://openrouter.ai/api/v1".',
    );
  }

  if (endpoint !== undefined && !endpointSchema.safeParse(endpoint).success) {
    throw new Error(
      `LLM_ENDPOINT is not a valid URL: "${endpoint}". It should be the base ` +
        'URL only, for example "https://openrouter.ai/api/v1".',
    );
  }

  // Required for the same reason the endpoint is, and with no default: a
  // gateway such as OpenRouter addresses models in its own namespace
  // (`openai/gpt-4o`, `anthropic/claude-sonnet-4`), so any value chosen here
  // would be a guess about someone else's catalogue.
  if (style !== "dev" && model === undefined) {
    throw new Error(
      `LLM_API_STYLE is "${style}", which needs a model id, but LLM_MODEL is ` +
        'not set. Set it to the model the endpoint should use — for OpenRouter ' +
        'that looks like "openai/gpt-4o".',
    );
  }

  const apiKey = process.env.LLM_API_KEY;

  return {
    style,
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(model === undefined ? {} : { model }),
    hasApiKey: typeof apiKey === "string" && apiKey.trim().length > 0,
  };
}

/**
 * Reads a positive integer, or falls back to a default.
 *
 * A malformed value throws rather than falling back silently. A limit is a
 * safety control: an operator who typed `RESEARCH_MAX_SOURCES=abc` and got the
 * default back would believe they had set a ceiling they had not, and the
 * failure would appear as an unexpectedly expensive run rather than as a
 * configuration error.
 */
function readLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();

  if (raw === undefined || raw.length === 0) {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${name} must be a positive whole number, but it is set to "${raw}".`,
    );
  }

  return parsed;
}

export interface ResearchConfig {
  /**
   * The model used for retrieval, when it differs from the planning model.
   *
   * Optional, and it defaults to `LLM_MODEL` at the point of use. Retrieval and
   * planning have different appetites — a search call is short and a plan is
   * not — so an operator may reasonably want a cheaper model fetching and a
   * stronger one reasoning, without configuring a second endpoint.
   */
  searchModel?: string;
  limits: ResearchLimits;
}

/**
 * Research configuration.
 *
 * Note what is NOT here: an endpoint or a credential. Retrieval through
 * OpenRouter is a chat completion with a search plugin attached, so it uses the
 * same endpoint and the same key as planning — and duplicating them into a
 * second set of variables would create two places to rotate one credential, one
 * of which would eventually be missed.
 *
 * Whether retrieval is *available* is therefore derived rather than declared,
 * and it is derived by `resolveResearchProvider` rather than here: a research
 * run can search exactly when `LLM_ENDPOINT` points at openrouter.ai, whose
 * `web` plugin is the one this build knows how to ask. Every other remote
 * endpoint — Groq, Together, vLLM, LM Studio — speaks the same protocol and has
 * no such plugin, so it resolves to the development adapter and reports itself
 * unconfigured. That is the honest reading: it means a `dev` style reports
 * research as unconfigured, and so does a remote endpoint that cannot search,
 * which is better than a run that appears to search and finds nothing.
 *
 * This function therefore reads no endpoint and makes no decision about
 * retrieval. It returns the *settings* for research; which provider they apply
 * to is one layer up.
 */
export function getResearchConfig(): ResearchConfig {
  const searchModel = process.env.RESEARCH_SEARCH_MODEL?.trim() || undefined;

  return {
    ...(searchModel === undefined ? {} : { searchModel }),
    limits: {
      maxTasks: readLimit("RESEARCH_MAX_TASKS", 5),
      maxSourcesPerTask: readLimit("RESEARCH_MAX_SOURCES_PER_TASK", 5),
      maxSourcesTotal: readLimit("RESEARCH_MAX_SOURCES", 20),
      maxFindings: readLimit("RESEARCH_MAX_FINDINGS", 50),
      maxDurationMs: readLimit("RESEARCH_MAX_DURATION_MS", 120_000),
    },
  };
}
