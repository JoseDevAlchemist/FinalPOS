import { NextResponse, type NextRequest } from "next/server";

import { PIN_LENGTH } from "@/lib/auth/pin";
import {
  clearFailedAttempts,
  getLockoutSeconds,
  registerFailedAttempt,
} from "@/lib/auth/rate-limit";
import {
  AuthFlowError,
  establishStaffSession,
} from "@/lib/auth/supabase-session";
import { findStaffByPin } from "@/lib/auth/verify-pin";
import { createAdminClient } from "@/lib/supabase/admin";
import { pinLoginSchema } from "@/lib/validation/auth";

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const address = forwarded?.split(",")[0]?.trim();
  return address && address.length > 0 ? address : "local";
}

function tooManyAttempts(seconds: number): NextResponse {
  return NextResponse.json(
    { error: "rate_limited", retryAfterSeconds: seconds },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host = request.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const key = clientKey(request);
  const lockout = getLockoutSeconds(key);
  if (lockout > 0) return tooManyAttempts(lockout);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = pinLoginSchema.safeParse(payload);
  if (!parsed.success || parsed.data.pin.length !== PIN_LENGTH) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const match = await findStaffByPin(admin, parsed.data.pin);

    if (!match) {
      const lockedFor = registerFailedAttempt(key);
      if (lockedFor > 0) return tooManyAttempts(lockedFor);
      return NextResponse.json({ error: "invalid_pin" }, { status: 401 });
    }

    if (!match.authUserId) {
      return NextResponse.json(
        { error: "staff_not_linked" },
        { status: 403 },
      );
    }

    await establishStaffSession(admin, match.authUserId);
    clearFailedAttempts(key);

    return NextResponse.json({
      staff: {
        name: match.name,
        role: match.role,
      },
    });
  } catch (error) {
    if (error instanceof AuthFlowError) {
      return NextResponse.json(
        { error: "login_unavailable" },
        { status: 503 },
      );
    }

    console.error(
      "PIN login failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json({ error: "login_unavailable" }, { status: 503 });
  }
}
