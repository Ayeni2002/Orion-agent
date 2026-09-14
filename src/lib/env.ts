import { z } from "zod";

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
 * Model providers Orion knows how to construct.
 *
 * Only the deterministic development adapter is implemented. Naming a real
 * provider here without implementing it would turn a configuration mistake
 * into a run that silently produces development output while appearing to be
 * a real inference call, so unsupported values are rejected loudly instead.
 */
export const SUPPORTED_MODEL_PROVIDERS = ["dev"] as const;

export type ModelProviderId = (typeof SUPPORTED_MODEL_PROVIDERS)[number];

const modelProviderSchema = z.object({
  provider: z.enum(SUPPORTED_MODEL_PROVIDERS),
  model: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
});

export interface ModelProviderConfig {
  provider: ModelProviderId;
  model?: string;
  baseUrl?: string;
  /**
   * Whether an API key is present in the environment — never the key itself.
   *
   * This module is the only one permitted to read `process.env`, and the key
   * is read *only* to compute this boolean. Nothing outside can obtain the
   * value, which is what makes "never expose model credentials" a property of
   * the code rather than a rule someone has to remember. If a future phase
   * needs the credential, it should be passed straight into that provider's
   * client and never returned from a function like this one.
   */
  hasApiKey: boolean;
}

/**
 * Model provider configuration.
 *
 * Defaults to the development adapter when `ORION_LLM_PROVIDER` is unset, so a
 * fresh checkout runs without any configuration at all.
 */
export function getModelProviderConfig(): ModelProviderConfig {
  const rawProvider = process.env.ORION_LLM_PROVIDER?.trim() || "dev";
  const model = process.env.ORION_LLM_MODEL?.trim() || undefined;
  const baseUrl = process.env.ORION_LLM_BASE_URL?.trim() || undefined;

  const parsed = modelProviderSchema.safeParse({
    provider: rawProvider,
    model,
    baseUrl,
  });

  if (!parsed.success) {
    throw new Error(
      `ORION_LLM_PROVIDER is set to "${rawProvider}", which Orion does not ` +
        `implement. Supported values: ${SUPPORTED_MODEL_PROVIDERS.join(", ")}. ` +
        "Leave it unset to use the deterministic development provider.",
    );
  }

  const apiKey = process.env.ORION_LLM_API_KEY;

  return {
    ...parsed.data,
    hasApiKey: typeof apiKey === "string" && apiKey.trim().length > 0,
  };
}
