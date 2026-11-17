"use server";

import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadDigitalDocument } from "@/lib/digital/queries";
import { quoteRequestSchema, receiptDocumentRequestSchema } from "@/lib/validation/digital";

function documentRequest(form: FormData): unknown {
  try { return JSON.parse(String(form.get("request"))); } catch { return null; }
}

export async function createQuotation(input: FormData) {
  await requireStaff();
  const parsed = quoteRequestSchema.safeParse(documentRequest(input));
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the quote.", uncertain: false };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("pos_create_quotation", { p_client_uuid: parsed.data.clientUuid,
      p_customer_name: parsed.data.customerName, p_customer_phone: parsed.data.customerPhone, p_items: parsed.data.items });
    if (error) return { ok: false as const, error: "Could not save this quote. Check the catalogue and migrations, then retry.", uncertain: !["22023", "22P02", "P0002", "42501", "PGRST202"].includes(error.code) };
    return { ok: true as const, document: await loadDigitalDocument("quotation", z.string().uuid().parse(data)) };
  } catch { return { ok: false as const, error: "Could not confirm the quote. Retry the same details.", uncertain: true }; }
}

export async function createDigitalReceipt(input: FormData) {
  await requireStaff();
  const parsed = receiptDocumentRequestSchema.safeParse(documentRequest(input));
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the customer.", uncertain: false };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("pos_create_receipt_document", { p_client_uuid: parsed.data.clientUuid,
      p_sale_id: parsed.data.saleId, p_customer_name: parsed.data.customerName, p_customer_phone: parsed.data.customerPhone });
    if (error) return { ok: false as const, error: "Could not create the receipt. Check the paid sale and migrations, then retry.", uncertain: !["22023", "22P02", "P0002", "42501", "PGRST202"].includes(error.code) };
    return { ok: true as const, document: await loadDigitalDocument("receipt", z.string().uuid().parse(data)) };
  } catch { return { ok: false as const, error: "Could not confirm the receipt. Retry the same details.", uncertain: true }; }
}
