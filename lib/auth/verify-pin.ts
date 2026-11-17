import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { normalizePin } from "./pin";
import type { PosRole } from "./types";

const staffRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  role: z.enum(["cashier", "manager"]),
  pin_hash: z.string().min(1),
  auth_user_id: z.string().uuid().nullable().optional(),
});

export interface PinMatch {
  id: string;
  name: string;
  role: PosRole;
  authUserId: string | null;
}

export async function findStaffByPin(
  admin: SupabaseClient,
  pin: string,
): Promise<PinMatch | null> {
  const normalized = normalizePin(pin);

  const primary = await admin
    .from("pos_users")
    .select("id, name, role, pin_hash, auth_user_id")
    .eq("active", true)
    .not("pin_hash", "is", null);

  let data: unknown = primary.data;
  let lookupError = primary.error;

  if (lookupError && /auth_user_id/i.test(lookupError.message)) {
    const fallback = await admin
      .from("pos_users")
      .select("id, name, role, pin_hash")
      .eq("active", true)
      .not("pin_hash", "is", null);

    data = fallback.data;
    lookupError = fallback.error;
  }

  if (lookupError) {
    throw new Error(`Staff lookup failed: ${lookupError.message}`);
  }

  const rows = z.array(staffRowSchema).safeParse(data ?? []);
  if (!rows.success) {
    throw new Error("Staff records have an unexpected shape.");
  }

  for (const row of rows.data) {
    if (await bcrypt.compare(normalized, row.pin_hash)) {
      return {
        id: row.id,
        name: row.name,
        role: row.role,
        authUserId: row.auth_user_id ?? null,
      };
    }
  }

  return null;
}
