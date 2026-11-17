import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client for Pedigree POS 2.0.
 *
 * Runs under the anon/publishable key, so RLS applies in full. It must never
 * see the service-role key.
 *
 * Auth cookies are HttpOnly and owned by the server. Use Route Handlers or
 * Server Actions for sign-in, sign-out and session refresh; this client is for
 * public catalogue reads and other anon-safe work.
 *
 * The client is memoised on `globalThis` so React Fast Refresh, remounts and
 * route transitions never create a second GoTrue instance ("Multiple
 * GoTrueClient instances") with an independent auth state.
 *
 * `Database` types will be generated from the shared project
 * (`supabase gen types typescript`) in Phase 2. Until then the client is
 * untyped on purpose: inventing a schema here would hide mismatches with the
 * storefront-owned database.
 */

const globalForSupabase = globalThis as typeof globalThis & {
  __pedigreePosBrowserClient?: SupabaseClient;
};

/** Test seam: lets a test install a stub instead of opening a connection. */
export function setBrowserClientForTests(
  client: SupabaseClient | undefined,
): void {
  globalForSupabase.__pedigreePosBrowserClient = client;
}

export function createClient(): SupabaseClient {
  const existing = globalForSupabase.__pedigreePosBrowserClient;
  if (existing) return existing;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill both in.",
    );
  }

  const client = createBrowserClient(url, anonKey);
  if (process.env.NODE_ENV !== "production") {
    globalForSupabase.__pedigreePosBrowserClient = client;
  }

  return client;
}
