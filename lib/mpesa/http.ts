import "server-only";
import type { NextRequest } from "next/server";

export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.host === request.headers.get("host");
  } catch { return false; }
}
export async function readBody(request: NextRequest): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > 16384) throw new Error("body_too_large");
  const text = await request.text();
  if (text.length > 16384) throw new Error("body_too_large");
  return JSON.parse(text);
}
