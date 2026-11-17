import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { documentSchema, type DigitalKind } from "@/lib/validation/digital";

export async function loadDigitalDocument(kind: DigitalKind, id: string, shareToken?: string) {
  const validId = z.string().uuid().parse(id);
  const client = shareToken ? createAdminClient() : await createClient();
  const projection = kind === "receipt"
    ? "id,share_token,staff_name,customer_name,customer_phone,created_at:sale_created_at,subtotal,discount_amount,total,items,sale_id"
    : "id,share_token,staff_name,customer_name,customer_phone,created_at,subtotal,discount_amount,total,items";
  let query = client.from(kind === "quotation" ? "pos_quotations" : "pos_receipt_documents")
    .select(projection)
    .eq("id", validId);
  if (shareToken) query = query.eq("share_token", z.string().uuid().parse(shareToken));
  const { data, error } = await query.single();
  if (error) throw new Error("Document unavailable");
  // Public loaders are capability-gated; table RLS still denies anonymous reads.
  return documentSchema.parse({ ...z.record(z.string(), z.unknown()).parse(data), kind });
}
