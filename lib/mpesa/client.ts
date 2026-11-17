import "server-only";
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";

export class MpesaError extends Error {
  constructor(public readonly kind: "not_started" | "rejected" | "uncertain") { super(`mpesa_${kind}`); }
}
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new MpesaError("not_started");
  return value;
}
export function mpesaConfig() {
  const environment = z.enum(["sandbox", "production"]).parse(process.env.MPESA_ENV ?? "sandbox");
  let baseUrl = environment === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
  const testUrl = process.env.MPESA_TEST_BASE_URL;
  if (testUrl) {
    const parsed = new URL(testUrl);
    const database = new URL(required("NEXT_PUBLIC_SUPABASE_URL"));
    if (process.env.NODE_ENV === "production" || environment !== "sandbox" || !["127.0.0.1", "localhost"].includes(database.hostname)
      || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.protocol !== "http:") throw new MpesaError("not_started");
    baseUrl = parsed.origin;
  }
  const callbackUrl = new URL(required("MPESA_CALLBACK_URL"));
  if (callbackUrl.protocol !== "https:" && !(testUrl && ["127.0.0.1", "localhost"].includes(callbackUrl.hostname))) throw new MpesaError("not_started");
  const secret = required("MPESA_CALLBACK_SECRET");
  if (secret.length < 32) throw new MpesaError("not_started");
  return { baseUrl, callbackUrl, secret, key: required("MPESA_CONSUMER_KEY"), consumerSecret: required("MPESA_CONSUMER_SECRET"),
    shortcode: z.string().regex(/^\d{5,10}$/).parse(required("MPESA_SHORTCODE")), passkey: required("MPESA_PASSKEY") };
}
export function callbackToken(id: string): string { return createHmac("sha256", mpesaConfig().secret).update(id).digest("hex"); }
export function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function callbackAddress(id: string): string {
  const url = mpesaConfig().callbackUrl;
  url.searchParams.set("id", id); url.searchParams.set("token", callbackToken(id));
  return url.toString();
}
function darajaPassword() {
  const config = mpesaConfig();
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const timestamp = ["year", "month", "day", "hour", "minute", "second"].map((key) => parts.find((part) => part.type === key)?.value ?? "").join("");
  return { Timestamp: timestamp, Password: Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString("base64"), BusinessShortCode: config.shortcode };
}
let cachedToken: { value: string; expiresAt: number; baseUrl: string } | null = null;
export async function getOAuthToken(): Promise<string> {
  const config = mpesaConfig();
  if (cachedToken && cachedToken.expiresAt > Date.now() && cachedToken.baseUrl === config.baseUrl) return cachedToken.value;
  try {
    const response = await fetch(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${Buffer.from(`${config.key}:${config.consumerSecret}`).toString("base64")}` }, cache: "no-store", signal: AbortSignal.timeout(15000), redirect: "error",
    });
    if (!response.ok) throw new MpesaError("not_started");
    const data = z.object({ access_token: z.string().min(1), expires_in: z.coerce.number().positive().default(3600) }).parse(await response.json());
    cachedToken = { value: data.access_token, expiresAt: Date.now() + Math.max(0, data.expires_in - 60) * 1000, baseUrl: config.baseUrl };
    return data.access_token;
  } catch { throw new MpesaError("not_started"); }
}
export async function initiateStkPush(input: { phone: string; amount: number; callbackUrl: string; reference: string }) {
  const config = mpesaConfig();
  const token = await getOAuthToken();
  try {
    const response = await fetch(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...darajaPassword(), TransactionType: "CustomerPayBillOnline", Amount: input.amount,
        PartyA: input.phone, PartyB: config.shortcode, PhoneNumber: input.phone,
        CallBackURL: input.callbackUrl, AccountReference: input.reference.slice(0, 12), TransactionDesc: "Pedigree POS" }),
      cache: "no-store", signal: AbortSignal.timeout(15000), redirect: "error",
    });
    const raw: unknown = await response.json();
    const code = z.object({ ResponseCode: z.string() }).safeParse(raw);
    if ((response.status >= 400 && response.status < 500) || (code.success && code.data.ResponseCode !== "0")) throw new MpesaError("rejected");
    if (!response.ok) throw new MpesaError("uncertain");
    return z.object({ MerchantRequestID: z.string().min(1).max(150), CheckoutRequestID: z.string().min(1).max(150), ResponseCode: z.literal("0") }).parse(raw);
  } catch (error) { if (error instanceof MpesaError) throw error; throw new MpesaError("uncertain"); }
}
export async function queryStkPush(checkoutId: string) {
  const config = mpesaConfig();
  const response = await fetch(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: "POST", headers: { Authorization: `Bearer ${await getOAuthToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...darajaPassword(), CheckoutRequestID: checkoutId }),
    cache: "no-store", signal: AbortSignal.timeout(15000), redirect: "error",
  });
  if (!response.ok) throw new MpesaError("uncertain");
  return z.object({ MerchantRequestID: z.string().min(1), CheckoutRequestID: z.string().min(1), ResultCode: z.union([z.number().int(), z.string().regex(/^-?\d+$/).transform(Number)]).pipe(z.number().int()) }).parse(await response.json());
}
