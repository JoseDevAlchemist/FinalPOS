import { createHash } from "node:crypto";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

class RegistrationError extends Error {}

export function c2bRegistrationPayload(callback: string, shortcode: string) {
  const base = new URL(callback);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
    throw new RegistrationError("MPESA_CALLBACK_URL must be an HTTPS URL without credentials, query or fragment.");
  let path = base.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/api/mpesa/callback") path = "/api/mpesa";
  if (path !== "/api/mpesa") throw new RegistrationError("Use the app origin, /api/mpesa, or the existing /api/mpesa/callback URL.");
  // For an API base, these are `${MPESA_CALLBACK_URL}/c2b/...`. Existing STK
  // callback URLs are normalized without changing the STK environment setting.
  base.pathname = path;
  return {
    ShortCode: z.string().regex(/^\d{5,10}$/).parse(shortcode), ResponseType: "Completed",
    ConfirmationURL: `${base.href.replace(/\/$/, "")}/c2b/confirmation`,
    ValidationURL: `${base.href.replace(/\/$/, "")}/c2b/validation`,
  };
}

export function oauthDiagnostics(url: string, key: string, secret: string) {
  const authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
  return { url, Authorization: "Basic [REDACTED]", consumerKey: `${key.slice(0, 4)}...`,
    consumerKeyLength: key.length, consumerSecretLength: secret.length,
    authorizationLength: authorization.length,
    authorizationSha256: createHash("sha256").update(authorization).digest("hex"),
  };
}

export async function registerC2bUrls(environment: NodeJS.ProcessEnv, options: { dryRun?: boolean; production?: boolean; debug?: boolean; fetcher?: typeof fetch } = {}) {
  const config = z.object({ MPESA_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    MPESA_CALLBACK_URL: z.string().min(1), MPESA_CONSUMER_KEY: z.string().trim().min(1), MPESA_CONSUMER_SECRET: z.string().trim().min(1),
    MPESA_SHORTCODE: z.string().optional(), MPESA_C2B_SHORTCODE: z.string().optional(),
  }).parse(environment);
  if (config.MPESA_ENV === "production" && !options.production) throw new RegistrationError("Production URL registration requires --production.");
  const payload = c2bRegistrationPayload(config.MPESA_CALLBACK_URL, config.MPESA_C2B_SHORTCODE || config.MPESA_SHORTCODE || "");
  if (options.dryRun) return { dryRun: true as const, environment: config.MPESA_ENV, payload };
  const host = config.MPESA_ENV === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";
  const fetcher = options.fetcher ?? fetch;
  const oauthUrl = `${host}/oauth/v1/generate?grant_type=client_credentials`;
  const authorization = `Basic ${Buffer.from(`${config.MPESA_CONSUMER_KEY}:${config.MPESA_CONSUMER_SECRET}`).toString("base64")}`;
  if (options.debug) console.log("[mpesa:oauth]", oauthDiagnostics(oauthUrl, config.MPESA_CONSUMER_KEY, config.MPESA_CONSUMER_SECRET));
  const auth = await fetcher(oauthUrl, {
    headers: { Authorization: authorization },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
  });
  if (!auth.ok) throw new RegistrationError(`M-Pesa OAuth was not accepted (HTTP ${auth.status}).`);
  const token = z.object({ access_token: z.string().min(1) }).parse(await auth.json());
  const registration = await fetcher(`${host}/mpesa/c2b/v1/registerurl`, {
    method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
  });
  if (!registration.ok) throw new RegistrationError(`C2B registration was not accepted (HTTP ${registration.status}).`);
  const response = z.object({ ResponseCode: z.coerce.string() }).parse(await registration.json());
  if (response.ResponseCode !== "0") throw new RegistrationError("Safaricom did not accept C2B URL registration.");
  return { dryRun: false as const, environment: config.MPESA_ENV };
}

export function registrationFailureMessage(error: unknown): string {
  if (error instanceof RegistrationError) return error.message;
  if (error instanceof z.ZodError) return "Required configuration or provider response did not match the expected format.";
  const cause = error instanceof Error ? error.cause : undefined;
  const parsed = z.object({ code: z.enum(["EPERM", "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH"]) }).safeParse(cause);
  if (parsed.success) return `Network access was unavailable (${parsed.data.code}).`;
  return "Configuration or network access was unavailable.";
}

async function main() {
  try { loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url))); }
  catch { throw new RegistrationError("Cannot load .env.local from the project root. Ensure the file exists and is readable."); }
  const result = await registerC2bUrls(process.env, { debug: true, dryRun: process.argv.includes("--dry-run"), production: process.argv.includes("--production") });
  if (result.dryRun) console.info(JSON.stringify({ ...result, note: "No credentials printed; no network request made." }, null, 2));
  else console.info(`Safaricom accepted C2B URL registration (${result.environment}). No payment was initiated.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    // Error objects/provider bodies can contain credentials, URLs or personal
    // data. Keep terminal output actionable without echoing those objects.
    console.error(`C2B URL registration did not complete. ${registrationFailureMessage(error)}`);
    process.exitCode = 1;
  });
}
