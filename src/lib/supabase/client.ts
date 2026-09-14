import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseConfig } from "@/lib/env";

/**
 * Supabase client for use in the browser.
 *
 * Holds only the public anon key, which is designed to be exposed — Row Level
 * Security is what protects the data, not the secrecy of this key. The
 * service-role key must never be referenced from any module reachable by the
 * client bundle.
 *
 * Call this inside a component or event handler rather than at module scope:
 * `getSupabaseConfig()` throws when the environment is unset, and throwing
 * during module evaluation would break the whole page rather than the one
 * feature that needs a database.
 */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = getSupabaseConfig();

  return createBrowserClient(url, anonKey);
}
