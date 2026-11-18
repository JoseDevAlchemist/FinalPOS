"use server";
import { z } from "zod";
import { isCardPaymentConfigured } from "@/lib/flutterwave/config";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { prepareCardSchema, cardPaymentSchema } from "@/lib/validation/flutterwave";

export async function prepareCardPayment(input: unknown) {
  await requireStaff();
  if (!isCardPaymentConfigured()) return { ok: false as const, error: "Card payments are not configured.", uncertain: false };
  const parsed = prepareCardSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Review the cart before card payment.", uncertain: false };
  const client = await createClient();
  const { data, error } = await client.rpc("pos_prepare_card_sale", { p_id: parsed.data.client_uuid, p_total: parsed.data.total_kes, p_items: parsed.data.cart_items });
  const payment = cardPaymentSchema.safeParse(data);
  if (error || !payment.success) return { ok: false as const, error: "Could not prepare card payment. Review prices, stock and unresolved payments.", uncertain: !error || !["22023", "23514", "23505", "42501", "PGRST202"].includes(error.code) };
  return { ok: true as const, payment: payment.data };
}
export async function readOpenCardPayment() {
  const staff = await requireStaff();
  const client = await createClient();
  const { data, error } = await client.from("pos_card_payments").select("id,tx_ref,amount,status").eq("staff_id", staff.id)
    .in("status", ["prepared", "pending", "verified", "reconciliation"]).limit(1).maybeSingle();
  if (error) return { ok: false as const };
  return { ok: true as const, payment: data ? cardPaymentSchema.parse(data) : null };
}
export async function markCardOpened(input: unknown) {
  await requireStaff();
  const id = z.string().uuid().parse(input);
  const client = await createClient();
  const { error } = await client.rpc("pos_mark_card_opened", { p_id: id });
  return { ok: !error };
}
export async function cancelPreparedCard(input: unknown) {
  await requireStaff();
  const id = z.string().uuid().parse(input);
  const client = await createClient();
  const { error } = await client.rpc("pos_cancel_prepared_card", { p_id: id });
  return { ok: !error };
}
