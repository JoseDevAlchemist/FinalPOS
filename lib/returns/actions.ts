"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getReturnReceipt } from "@/lib/returns/queries";
import { returnRequestSchema, type ReturnReceipt } from "@/lib/validation/returns";

type ReturnResult = { ok: true; receipt: ReturnReceipt } | { ok: false; error: string; uncertain: boolean };

export async function processReturn(input: unknown): Promise<ReturnResult> {
  await requireManager();
  const parsed = returnRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the return.", uncertain: false };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("pos_process_return", {
      p_client_uuid: parsed.data.clientUuid, p_sale_id: parsed.data.saleId,
      p_reason: parsed.data.reason, p_items: parsed.data.items,
    });
    if (error) {
      const known = ["22023", "22P02", "23514", "22003", "42501", "P0002", "PGRST202"].includes(error.code);
      let message = "Could not confirm this return. Retry the same request before starting another.";
      if (/return_quantity_exceeded|refund_total_exceeded/.test(error.message)) message = "These items were already returned or exceed the remaining sale quantity. Reload the sale.";
      else if (/original_color_missing/.test(error.message)) message = "The original colour is missing. Resolve its inventory record before returning this item.";
      else if (/idempotency_mismatch/.test(error.message)) message = "This request was already recorded with different details. Check return history before starting another.";
      else if (error.code === "42501") message = "Only an active manager can authorize returns.";
      else if (error.code === "PGRST202") message = "Apply the returns migration before processing a return.";
      else if (known) message = "The return was rejected. Check the paid receipt, items, quantities and reason, then reload the sale.";
      return { ok: false, error: message, uncertain: !known || /idempotency_mismatch/.test(error.message) };
    }
    const id = z.string().uuid().parse(data);
    const receipt = await getReturnReceipt(id);
    for (const path of ["/manager/returns", "/manager/products", "/manager/inventory", "/manager", "/manager/dashboard", "/pos"]) revalidatePath(path);
    revalidatePath("/manager/products/[id]", "page");
    return { ok: true, receipt };
  } catch {
    // A lost response or failed receipt read does not imply a rollback. The same
    // UUID/payload must be retried so a committed refund cannot be duplicated.
    return { ok: false, error: "Could not confirm this return. Retry the same request before starting another.", uncertain: true };
  }
}
