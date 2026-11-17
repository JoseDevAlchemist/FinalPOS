import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

async function signOut(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const url = new URL("/login", request.url);
  return NextResponse.redirect(url, 303);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return signOut(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return signOut(request);
}
