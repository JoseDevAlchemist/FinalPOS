"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { cashSaleSchema, saleRecordSchema, type SaleRecord } from "@/lib/validation/sales";

export type SaleActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

function explain(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message =
    (error as { message?: string } | null)?.message ??
    (error instanceof Error ? error.message : String(error));

  if (/insufficient_stock:?/i.test(message)) {
    const name = message.split(":").slice(1).join(":").trim();
    return name
      ? `${name} does not have enough stock. Refresh the till and try again.`
      : "One of these items does not have enough stock. Refresh the till and try again.";
  }
  if (/price_mismatch|total_mismatch/i.test(message)) {
    return "Prices changed. Refresh the till and review the total before charging.";
  }
  if (/insufficient_cash/i.test(message)) {
    return "Cash tendered is less than the total.";
  }
  if (/cart_empty/i.test(message)) {
    return "The cart is empty.";
  }
  if (/product_unavailable|color_not_found|P0002/i.test(message) || code === "P0002") {
    return "A product or colour is no longer available. Refresh the till and try again.";
  }
  if (/not_authorized|42501/i.test(message) || code === "42501") {
    return "Your session is not allowed to complete sales. Sign in again.";
  }
  if (/PGRST202|function .* does not exist|schema cache/i.test(message) || code === "PGRST202") {
    return "The sales function is missing. Apply the latest Supabase migration.";
  }
  console.error("[sales] create failed", error);
  return "Could not complete the sale. Check your connection and try again.";
}

export async function createSaleAction(input: unknown): Promise<SaleActionResult<SaleRecord>> {
  const staff = await requireStaff();

  const parsed = cashSaleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid sale details.", code: "rejected" };
  }

  try {
    const supabase = await createClient();
    const { data: recorded, error } = await supabase.rpc("pos_record_sale", {
      p_client_uuid: parsed.data.client_uuid,
      p_cashier_id: staff.id,
      p_total_kes: parsed.data.total_kes,
      p_payment_method: "cash",
      p_amount_tendered: parsed.data.cash_tendered,
      p_items: parsed.data.cart_items,
    });

    if (error) {
      const rejected = ["22023", "22P02", "22003", "23514", "P0002", "42501", "PGRST202"].includes(error.code);
      return { ok: false, error: explain(error), code: rejected ? "rejected" : "confirmation_unknown" };
    }

    if (typeof recorded !== "boolean") throw new Error("Unexpected sale RPC response");

    // Read historical values for both a new commit and an idempotent replay.
    const { data, error: receiptError } = await supabase.from("pos_sales")
      .select(`id, client_uuid, staff_name, subtotal, discount_percent,
        discount_amount, total, payment_method, payment_status, cash_tendered,
        change_due, created_at,
        items:pos_sale_items(name, quantity, unit_price, line_total, color_name)`)
      .eq("client_uuid", parsed.data.client_uuid)
      .eq("staff_id", staff.id)
      .single();
    if (receiptError) throw receiptError;
    const sale = saleRecordSchema.parse({ ...data, idempotent: !recorded });
    revalidatePath("/pos");
    revalidatePath("/manager");
    revalidatePath("/manager/dashboard");
    return { ok: true, data: sale };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}
