import "server-only";
import { assertCardVerification } from "@/lib/validation/flutterwave";
export async function verifyFlutterwave(expected: { tx_ref: string; amount: number; transaction_id?: string }) {
  const secret = process.env.FLW_SECRET_KEY;
  if (!secret) throw new Error("card_not_configured");
  const endpoint = expected.transaction_id
    ? `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(expected.transaction_id)}/verify`
    : `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(expected.tx_ref)}`;
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!response.ok) throw new Error("provider_unavailable");
  const payload: unknown = await response.json();
  return assertCardVerification(payload, expected);
}
