import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getStaffSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { sameOrigin, readBody } from "@/lib/mpesa/http";
import { verifyCardSchema, cardPaymentSchema } from "@/lib/validation/flutterwave";
import { verifyFlutterwave } from "@/lib/flutterwave/verify";
import { getSaleReceipt } from "@/lib/sales/receipt";

const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403, headers });
  const staff = await getStaffSession();
  if (!staff) return NextResponse.json({ success: false, error: "Sign in to verify card payment." }, { status: 401, headers });
  const body: unknown = await readBody(request).catch(() => null);
  const parsed = verifyCardSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid payment details." }, { status: 400, headers });
  if (!process.env.FLW_SECRET_KEY) return NextResponse.json({ success: false, error: "Card payments are not configured." }, { status: 503, headers });
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("pos_card_payments").select("id,tx_ref,staff_id,amount,status,provider_transaction_id").eq("tx_ref", parsed.data.tx_ref).single();
    const payment = cardPaymentSchema.extend({ staff_id: z.string().uuid(), provider_transaction_id: z.string().nullable() }).safeParse(data);
    if (error || !payment.success || (payment.data.staff_id !== staff.id && staff.role !== "manager")) return NextResponse.json({ success: false, error: "Payment not found." }, { status: 404, headers });
    const draft = payment.data;
    if (draft.amount !== parsed.data.expected_amount || ["prepared", "cancelled"].includes(draft.status)) return NextResponse.json({ success: false, error: "Payment details do not match the server checkout." }, { status: 409, headers });
    if (draft.status === "completed" && parsed.data.transaction_id && parsed.data.transaction_id !== draft.provider_transaction_id)
      return NextResponse.json({ success: false, error: "Transaction ID does not match this completed payment." }, { status: 409, headers });
    if (draft.status !== "completed") {
      const evidence = await verifyFlutterwave({ tx_ref: draft.tx_ref, amount: draft.amount, transaction_id: parsed.data.transaction_id });
      const finalized = await admin.rpc("pos_finalize_card", { p_id: draft.id, p_transaction_id: evidence.transaction_id, p_tx_ref: evidence.tx_ref, p_amount: evidence.amount });
      if (finalized.error) return NextResponse.json({ success: false, error: "Payment could not be finalized. Retry verification; do not charge again." }, { status: 409, headers });
      if (finalized.data !== "completed") return NextResponse.json({ success: false, reconciliation: true, error: "Card payment verified. Stock needs manager review before the sale can finish. Retry verification after stock is resolved." }, { status: 409, headers });
    }
    const sale = await getSaleReceipt(draft.id);
    for (const path of ["/pos", "/manager", "/manager/dashboard", "/manager/inventory", "/manager/products"]) revalidatePath(path);
    return NextResponse.json({ success: true, sale }, { headers });
  } catch {
    // Never log the provider response: it may contain card metadata/tokens/PII.
    return NextResponse.json({ success: false, error: "Payment is not confirmed. Check the same card payment again before charging." }, { status: 502, headers });
  }
}
