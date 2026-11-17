import { NextResponse, type NextRequest } from "next/server";
import { readBody } from "@/lib/mpesa/http";
import { c2bConfirmationSchema } from "@/lib/validation/mpesa-c2b";

export async function POST(request: NextRequest) {
  const parsed = c2bConfirmationSchema.safeParse(await readBody(request).catch(() => null));
  if (!parsed.success) return NextResponse.json({ ResultCode: 1, ResultDesc: "Invalid validation request" }, { status: 400 });
  // Accept delivery to this till; confirmation/reconciliation determines the
  // eventual accounting treatment. Validation does not create a paid sale.
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
