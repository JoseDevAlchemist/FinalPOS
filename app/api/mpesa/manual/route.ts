import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getStaffSession } from "@/lib/auth/session";
import { readBody, sameOrigin } from "@/lib/mpesa/http";
import { receiptCodeSchema } from "@/lib/validation/mpesa";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!await getStaffSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let input;
  try { input = z.object({ transactionId: z.string().uuid(), receiptCode: receiptCodeSchema }).parse(await readBody(request)); }
  catch { return NextResponse.json({ error: "Enter a valid transaction and 10-character receipt code." }, { status: 400 }); }
  const client = await createClient();
  const { error } = await client.rpc("pos_note_manual_mpesa", { p_id: input.transactionId, p_code: input.receiptCode });
  if (error) return NextResponse.json({ error: "The receipt code could not be saved." }, { status: 409 });
  return NextResponse.json({ message: "Receipt code saved for reconciliation. Payment is still unverified." });
}
