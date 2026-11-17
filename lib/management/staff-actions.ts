"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createCashierSchema } from "@/lib/validation/staff";

type StaffResult = { ok: true; id: string } | { ok: false; error: string };

// FormData is deliberately used here: this Next.js version logs serialized
// Server Action object arguments in development. FormData's fields are not
// enumerable, so PIN values never enter those framework argument logs.
export async function createCashierAction(form: FormData): Promise<StaffResult> {
  const manager = await requireManager();
  const parsed = createCashierSchema.safeParse({ clientUuid: form.get("clientUuid"), name: form.get("name"), pin: form.get("pin") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the cashier details." };
  const { clientUuid, name, pin } = parsed.data;
  const admin = createAdminClient();
  const email = `pos-${clientUuid}@pedigree.local`;
  const existing = await admin.auth.admin.getUserById(clientUuid);
  let authUser = existing.data.user;
  let created = false;
  if (!authUser) {
    const provisioned = await admin.auth.admin.createUser({
      id: clientUuid, email, email_confirm: true, password: randomBytes(32).toString("base64url"),
      app_metadata: { pos_managed: true, pos_provisioning_actor: manager.id },
    });
    if (provisioned.error) {
      // A concurrent retry may have created the same deterministic Auth id.
      authUser = (await admin.auth.admin.getUserById(clientUuid)).data.user;
      if (!authUser) return { ok: false, error: "Could not provision the staff account. Retry with the same details." };
    } else { authUser = provisioned.data.user; created = true; }
  }
  const metadata = z.object({ pos_managed: z.literal(true), pos_provisioning_actor: z.literal(manager.id) }).safeParse(authUser?.app_metadata);
  if (!authUser || authUser.email !== email || !metadata.success) return { ok: false, error: "That enrollment request belongs to another account." };
  const client = await createClient();
  const { data, error } = await client.rpc("pos_manager_create_cashier", {
    p_client_uuid: clientUuid, p_auth_user_id: authUser.id, p_name: name, p_pin: pin,
  });
  if (error) {
    // Only known database exceptions prove rollback. A network error may have
    // happened after commit, in which case the Auth user must remain intact.
    if (created && ["22023", "23505", "42501", "23503"].includes(error.code)) await admin.auth.admin.deleteUser(authUser.id);
    if (/pin_in_use/.test(error.message)) return { ok: false, error: "That PIN is already assigned to an active staff member. Choose another PIN." };
    return { ok: false, error: "Could not enroll the cashier. Retry with the same name and PIN." };
  }
  const id = z.string().uuid().safeParse(data);
  if (!id.success) return { ok: false, error: "Could not confirm enrollment. Retry with the same details." };
  revalidatePath("/manager/staff");
  return { ok: true, id: id.data };
}
