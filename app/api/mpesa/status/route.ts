import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getStaffSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { processPayment, readAttempt } from "@/lib/mpesa/service";
import { getSaleReceipt } from "@/lib/sales/receipt";

export async function GET(request: NextRequest) {
  if (!await getStaffSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = z.string().uuid().safeParse(request.nextUrl.searchParams.get("transactionId"));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const client = await createClient();
  const allowed = await client.from("pos_mpesa_transactions").select("id").eq("id", parsed.data).maybeSingle();
  if (allowed.error) return NextResponse.json({ error: "status_unavailable" }, { status: 503 });
  if (!allowed.data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    await processPayment(parsed.data, request.nextUrl.searchParams.get("reconcile") === "1").catch(() => undefined);
    const attempt = await readAttempt(parsed.data);
    const sale = attempt.status === "success" ? await getSaleReceipt(attempt.sale_id) : null;
    return NextResponse.json({ status: attempt.status, sale }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "status_unavailable" }, { status: 503 }); }
}
