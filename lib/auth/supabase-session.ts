import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

export type AuthFlowErrorCode =
  | "staff_identity_unavailable"
  | "session_bootstrap_failed";

export class AuthFlowError extends Error {
  readonly code: AuthFlowErrorCode;

  constructor(code: AuthFlowErrorCode) {
    super(code);
    this.name = "AuthFlowError";
    this.code = code;
  }
}

export async function establishStaffSession(
  admin: SupabaseClient,
  authUserId: string,
): Promise<void> {
  const { data: userData, error: userError } =
    await admin.auth.admin.getUserById(authUserId);

  const email = userData.user?.email;
  if (userError || !email) {
    throw new AuthFlowError("staff_identity_unavailable");
  }

  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({ type: "magiclink", email });

  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    throw new AuthFlowError("session_bootstrap_failed");
  }

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });

  if (verifyError) {
    throw new AuthFlowError("session_bootstrap_failed");
  }
}
