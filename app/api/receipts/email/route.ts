import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { getStaffSession } from "@/lib/auth/session";
import { emailDocumentSchema } from "@/lib/validation/digital";
import { loadDigitalDocument } from "@/lib/digital/queries";
import { documentPath, documentNumber } from "@/lib/digital/links";
import { renderDigitalEmail } from "@/lib/digital/email";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await getStaffSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const origin = request.headers.get("origin");
  try {
    if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  } catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }
  const parsed = emailDocumentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "email_not_configured" }, { status: 503 });
  try {
    const document = await loadDigitalDocument(parsed.data.kind, parsed.data.documentId);
    const base = process.env.POS_PUBLIC_URL || request.nextUrl.origin;
    const publicUrl = new URL(documentPath(document), base).href;
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "Pedigree POS <onboarding@resend.dev>", to: parsed.data.to,
      subject: `Your Pedigree Leather ${document.kind} ${documentNumber(document)}`,
      html: renderDigitalEmail(document, publicUrl, base),
    }, { idempotencyKey: `document-${document.id}-${parsed.data.requestUuid}` });
    if (result.error) return NextResponse.json({ error: "send_not_confirmed" }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "document_or_email_unavailable" }, { status: 502 }); }
}
