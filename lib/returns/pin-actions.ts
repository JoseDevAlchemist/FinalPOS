"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { findReturnSales } from "@/lib/returns/queries";
import { receiptSearchSchema, returnRequestSchema, returnReceiptSchema, returnSaleSchema } from "@/lib/validation/returns";

export async function lookupReturnReceipt(input: unknown) {
  await requireStaff();
  const parsed = receiptSearchSchema.safeParse(input);
  if (!parsed.success || !parsed.data) return { ok: false as const, error: "Enter the eight-character receipt number or full sale ID." };
  try { return { ok: true as const, sales: await findReturnSales(parsed.data) }; }
  catch { return { ok: false as const, error: "Could not load receipts. Check the connection." }; }
}

export async function loadCashierReturnSale(input: unknown) {
  await requireStaff();
  const id = z.string().uuid().safeParse(input);
  if (!id.success) return { ok: false as const, error: "Choose a valid receipt." };
  const client = await createClient();
  const { data, error } = await client.rpc("pos_staff_return_sale_details", { p_sale_id: id.data });
  const sale = returnSaleSchema.safeParse(data);
  if (error || !sale.success) return { ok: false as const, error: "Could not load this paid receipt. Check the connection and migrations." };
  return { ok: true as const, sale: sale.data };
}

export async function processReturnWithPin(form: FormData) {
  const cashier = await requireStaff();
  // FormData keeps PIN values out of development object-argument diagnostics.
  const pin = z.string().regex(/^\d{4}$/).safeParse(form.get("managerPin"));
  let payload: unknown;
  try { payload = JSON.parse(String(form.get("request"))); } catch { payload = null; }
  const request = returnRequestSchema.safeParse(payload);
  if (!pin.success || !request.success) return { ok: false as const, error: "Check the return and enter a four-digit Manager PIN.", uncertain: false };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("pos_process_return_with_pin", {
      p_cashier_id: cashier.id, p_pin: pin.data, p_client_uuid: request.data.clientUuid,
      p_sale_id: request.data.saleId, p_reason: request.data.reason, p_items: request.data.items,
    });
    if (error) {
      const rejected = ["22023", "22P02", "23514", "42501", "P0002", "PGRST202"].includes(error.code);
      return { ok: false as const, error: rejected ? "Return rejected. Check the receipt, remaining quantities and manager authorization." : "Confirmation unavailable. Retry the same return with the manager.", uncertain: !rejected || /idempotency_mismatch/.test(error.message) };
    }
    const result = z.object({ return_id: z.string().uuid().optional(), error: z.string().optional() }).parse(data);
    if (result.error || !result.return_id) return { ok: false as const, error: result.error === "pin_locked" ? "Too many PIN attempts. Wait 30 seconds and ask the manager to retry." : "Manager PIN was not accepted. Ask an active, linked manager to authorize.", uncertain: false };
    const receipt = await admin.from("pos_returns")
      .select("id,sale_id,processed_by_name,refund_amount,reason,created_at,items:pos_return_items(id,product_name,color_name,quantity,refund_amount)")
      .eq("id", result.return_id).eq("requested_by", cashier.id).single();
    if (receipt.error) throw new Error("Receipt unavailable");
    const saved = returnReceiptSchema.parse(receipt.data);
    for (const path of ["/pos", "/manager", "/manager/returns", "/manager/inventory", "/manager/products"]) revalidatePath(path);
    return { ok: true as const, receipt: saved };
  } catch { return { ok: false as const, error: "Confirmation unavailable. Retry the same return with the manager.", uncertain: true }; }
}
