import { z } from "zod";
import { prepareMpesaSchema } from "@/lib/validation/mpesa";
export const prepareCardSchema = prepareMpesaSchema;
export const cardStateSchema = z.enum(["prepared", "pending", "verified", "completed", "reconciliation", "cancelled"]);
export const cardPaymentSchema = z.object({ id: z.string().uuid(), tx_ref: z.string().regex(/^POS-CARD-[0-9a-f-]{36}$/), amount: z.number().int().positive().max(2147483647), status: cardStateSchema });
export type CardPayment = z.infer<typeof cardPaymentSchema>;
export const verifyCardSchema = z.object({ transaction_id: z.coerce.string().regex(/^\d{1,20}$/).optional(), tx_ref: cardPaymentSchema.shape.tx_ref, expected_amount: z.number().int().positive().max(2147483647) });
export const cardCustomerSchema = z.object({ email: z.string().trim().email().max(254), phone: z.string().trim().regex(/^[+\d ()-]{7,24}$/) });
// Strip provider card/token/customer fields immediately; never persist/log them.
export const providerVerificationSchema = z.object({ status: z.literal("success"), data: z.object({
  id: z.number().int().positive().safe(), tx_ref: z.string(), status: z.string(), amount: z.number().finite().nonnegative().max(2147483647), currency: z.string(), payment_type: z.string(),
}) });
export function assertCardVerification(payload: unknown, expected: { tx_ref: string; amount: number; transaction_id?: string }) {
  const verified = providerVerificationSchema.parse(payload).data;
  if (verified.status !== "successful" || verified.tx_ref !== expected.tx_ref || verified.currency !== "KES" || verified.payment_type !== "card"
    || !Number.isSafeInteger(verified.amount) || verified.amount < expected.amount || (expected.transaction_id && String(verified.id) !== expected.transaction_id)) throw new Error("payment_not_verified");
  return { transaction_id: String(verified.id), tx_ref: verified.tx_ref, amount: verified.amount };
}
