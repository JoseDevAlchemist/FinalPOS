"use server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { prepareMpesaSchema } from "@/lib/validation/mpesa";

export async function prepareMpesaSaleAction(input: unknown) {
  await requireStaff();
  const parsed = prepareMpesaSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Review the cart and total before payment." };
  const client = await createClient();
  const { data, error } = await client.rpc("pos_prepare_mpesa_sale", { p_id: parsed.data.client_uuid, p_total: parsed.data.total_kes, p_items: parsed.data.cart_items });
  const result = z.object({ saleId: z.string().uuid(), amount: z.number().int().positive() }).safeParse(data);
  if (error || !result.success) return { ok: false as const, error: "Prices or stock changed, or this payment draft already has different details. Refresh and review the cart." };
  return { ok: true as const, ...result.data };
}
export async function cancelMpesaDraftAction(id: unknown) {
  await requireStaff();
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false as const };
  const client = await createClient();
  const { error } = await client.rpc("pos_cancel_mpesa_draft", { p_id: parsed.data });
  return { ok: !error };
}
