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
