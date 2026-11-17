export function authCookieOptions() {
  const secure =
    process.env.NODE_ENV === "production" &&
    (process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("https://") ?? false);

  return {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    secure,
  };
}
