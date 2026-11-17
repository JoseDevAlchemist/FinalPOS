import { NextResponse, type NextRequest } from "next/server";

import { getStaffSession } from "@/lib/auth/session";
import { getProductByBarcode } from "@/lib/products/queries";
import { barcodeLookupSchema } from "@/lib/validation/products";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const staff = await getStaffSession();
  if (!staff) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = barcodeLookupSchema.safeParse(
    request.nextUrl.searchParams.get("code"),
  );

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_barcode" }, { status: 400 });
  }

  try {
    const product = await getProductByBarcode(parsed.data);
    if (!product) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json(
      { product },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[barcode] lookup failed", error);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
}
