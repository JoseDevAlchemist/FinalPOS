import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { callbackToken, tokenHash } from "@/lib/mpesa/client";
import { readBody } from "@/lib/mpesa/http";
import { processPayment } from "@/lib/mpesa/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCallback } from "@/lib/validation/mpesa";

export async function POST(request: NextRequest) {
  let id; let token;
  try {
    id = z.string().uuid().parse(request.nextUrl.searchParams.get("id"));
    token = z.string().regex(/^[0-9a-f]{64}$/).parse(request.nextUrl.searchParams.get("token"));
    const expected = callbackToken(id);
    if (!timingSafeEqual(Buffer.from(token), Buffer.from(expected))) throw new Error("invalid_token");
  } catch { return NextResponse.json({ error: "unauthorized_callback" }, { status: 401 }); }
  let callback;
  try { callback = parseCallback(await readBody(request)); }
  catch { return NextResponse.json({ error: "invalid_callback" }, { status: 400 }); }
  const admin = createAdminClient();
  const stored = await admin.rpc("pos_store_mpesa_callback", { p_id: id, p_token_hash: tokenHash(token), p_checkout: callback.checkout, p_merchant: callback.merchant, p_code: callback.code, p_amount: callback.amount, p_phone: callback.phone, p_receipt: callback.receipt });
  if (stored.error) return NextResponse.json({ error: "callback_not_accepted" }, { status: stored.error.code === "22023" ? 400 : 503 });
  // Durable, deduplicated callback evidence is already saved. If Daraja is
  // temporarily unavailable, authenticated polling can retry verification.
  await processPayment(id).catch(() => undefined);
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
