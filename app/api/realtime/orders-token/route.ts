import { getStaffSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET() {
  if (!(await getStaffSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers });
  }

  // getStaffSession verified the Auth user and active staff row first. Only the
  // short-lived user JWT crosses this bridge; refresh credentials stay HttpOnly.
  const client = await createClient();
  const { data: { session }, error } = await client.auth.getSession();
  if (error || !session?.expires_at) {
    return Response.json({ error: "session_unavailable" }, { status: 401, headers });
  }
  return Response.json({
    accessToken: session.access_token,
    expiresAt: session.expires_at,
  }, { headers });
}
