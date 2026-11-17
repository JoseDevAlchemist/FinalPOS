import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getStaffSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { callbackAddress, callbackToken, initiateStkPush, mpesaConfig, MpesaError, tokenHash } from "@/lib/mpesa/client";
import { sameOrigin, readBody } from "@/lib/mpesa/http";
import { processPayment } from "@/lib/mpesa/service";
import { normalizeMpesaPhone, paymentStatusSchema, stkPushSchema } from "@/lib/validation/mpesa";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const staff = await getStaffSession();
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let input; let id; let phone;
  try {
    input = stkPushSchema.parse(await readBody(request));
    id = z.string().uuid().parse(request.headers.get("idempotency-key"));
    phone = normalizeMpesaPhone(input.phoneNumber);
  } catch { return NextResponse.json({ error: "Enter a valid Kenyan phone number and payment details.", notStarted: true }, { status: 400 }); }
  try { mpesaConfig(); } catch { return NextResponse.json({ error: "M-Pesa is not fully configured. Ask a manager to check the payment settings.", notStarted: true }, { status: 503 }); }
  const admin = createAdminClient();
  const started = await admin.rpc("pos_begin_mpesa_attempt", { p_id: id, p_sale: input.saleId, p_staff: staff.id, p_phone: phone, p_amount: input.amount, p_token_hash: tokenHash(callbackToken(id)) });
  if (started.error) {
    if (/payment_unresolved/.test(started.error.message)) {
      const existing = await admin.from("pos_mpesa_transactions").select("id,status").eq("sale_id", input.saleId).neq("status", "failed").limit(1).maybeSingle();
      const row = z.object({ id: z.string().uuid(), status: paymentStatusSchema }).safeParse(existing.data);
      if (row.success) return NextResponse.json({ transactionId: row.data.id, status: row.data.status, error: "Resolve the existing payment before trying again." }, { status: 409 });
    }
    return NextResponse.json({ error: "Review this cart or resolve its existing payment before trying again.", notStarted: true }, { status: 409 });
  }
  const attempt = z.object({ dispatch: z.boolean(), id: z.string().uuid(), status: paymentStatusSchema, checkoutRequestId: z.string().nullable() }).parse(started.data);
  if (!attempt.dispatch) return NextResponse.json({ transactionId: id, checkout_request_id: attempt.checkoutRequestId, status: attempt.status }, { status: 202 });
  try {
    const response = await initiateStkPush({ phone, amount: input.amount, callbackUrl: callbackAddress(id), reference: input.saleId });
    const attached = await admin.rpc("pos_attach_mpesa_request", { p_id: id, p_merchant: response.MerchantRequestID, p_checkout: response.CheckoutRequestID });
    if (attached.error) throw new MpesaError("uncertain");
    // A fast callback may already be persisted; apply it after the provider ids
    // are known. Query outages leave central evidence for the next status check.
    await processPayment(id).catch(() => undefined);
    return NextResponse.json({ transactionId: id, checkout_request_id: response.CheckoutRequestID, status: "pending" }, { status: 202 });
  } catch (error) {
    const failed = error instanceof MpesaError && error.kind !== "uncertain";
    await admin.rpc("pos_mark_mpesa_dispatch", { p_id: id, p_status: failed ? "failed" : "reconciliation" });
    return NextResponse.json({ transactionId: id, status: failed ? "failed" : "reconciliation", error: failed ? "M-Pesa could not start the request. Try again." : "Payment initiation could not be confirmed. Check status before requesting another payment." }, { status: 502 });
  }
}
