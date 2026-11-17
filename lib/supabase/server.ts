import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { authCookieOptions } from "./cookie-options";

/**
 * Server-side Supabase client for Pedigree POS 2.0.
 *
 * Carries the staff member's Supabase Auth session from request cookies, so
 * Postgres RLS evaluates policies as that authenticated user. This is the
 * client used by Server Components, Server Actions and Route Handlers.
 *
 * A fresh client is created per call. Caching one would carry a previous
 * request's cookies into the next request — a data leak on the server. The
 * cost of a new client is one object.
 *
 * `cookies()` is async in Next.js 15/16; awaiting it is required.
 *
 * Writes from `setAll` can fail while rendering a Server Component because
 * response headers have already started streaming. That is expected: the
 * session cookie is refreshed by the Proxy (Phase 1) from a server context
 * where writing is allowed. Swallowing the error here is the @supabase/ssr
 * prescription, not a silent privilege escalation.
 *
 * `Database` types will be generated from the shared project in Phase 2; the
 * client is deliberately untyped until the real schema is verified.
 */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill both in.",
    );
  }

  return createServerClient(url, anonKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          /* Called from a Server Component render. The Proxy refreshes the
             session cookie on the next navigation. */
        }
      },
    },
  });
}
