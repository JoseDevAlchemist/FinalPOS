import { NextResponse, type NextRequest } from "next/server";
import { readBody } from "@/lib/mpesa/http";
import { c2bLogEntry } from "@/lib/validation/mpesa-c2b";

export async function POST(request: NextRequest) {
  let entry;
  try { entry = c2bLogEntry(await readBody(request)); }
  catch { return NextResponse.json({ ResultCode: 1, ResultDesc: "Invalid confirmation" }, { status: 400 }); }
  // No phone/name/account reference or full provider payload enters logs. An
  // acknowledgement is an observation, not proof of a paid POS sale.
  console.info("[mpesa:c2b]", entry);
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
