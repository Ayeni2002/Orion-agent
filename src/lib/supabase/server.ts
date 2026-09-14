import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabaseConfig } from "@/lib/env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Reads and writes the auth cookies through Next's cookie store, which is what
 * lets a session established in a Server Action be visible to the next request
 * — the piece Phase 1 sets up so authentication can be added without
 * restructuring the server layer.
 *
 * Server code must never import the browser client from `./client`, and client
 * code must never import this module: `next/headers` is unavailable in the
 * browser and the import would fail at build time.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. This is expected when a
          // refresh is attempted during render; the middleware that will own
          // session refresh is added with authentication in a later phase.
        }
      },
    },
  });
}
