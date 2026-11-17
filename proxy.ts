import { NextResponse, type NextRequest } from "next/server";

import { refreshSession } from "@/lib/supabase/proxy";

const PROTECTED_PREFIXES = ["/pos", "/manager", "/print"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function carryCookies(target: NextResponse, source: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { response, user } = await refreshSession(request);
  const { pathname } = request.nextUrl;

  if (isProtected(pathname) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return carryCookies(NextResponse.redirect(url), response);
  }

  if (pathname === "/login" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/pos";
    url.search = "";
    return carryCookies(NextResponse.redirect(url), response);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
