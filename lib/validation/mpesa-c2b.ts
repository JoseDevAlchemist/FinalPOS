import { createHash } from "node:crypto";
import { z } from "zod";

export const c2bConfirmationSchema = z.object({
  TransID: z.string().trim().regex(/^[a-z0-9]{8,30}$/i),
  TransTime: z.string().regex(/^\d{14}$/),
  // C2B observations retain the provider's decimal text, never a float or a
  // client-verified sale amount. Sale reconciliation remains separate.
  TransAmount: z.union([z.string(), z.number().finite()]).transform(String)
    .pipe(z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/)).refine((value) => Number(value) > 0),
  BusinessShortCode: z.union([z.string(), z.number().int()]).transform(String).pipe(z.string().regex(/^\d{5,10}$/)),
});

export function c2bLogEntry(payload: unknown) {
  const payment = c2bConfirmationSchema.parse(payload);
  return {
    event: "mpesa_c2b_confirmation_received",
    transactionFingerprint: createHash("sha256").update(payment.TransID).digest("hex").slice(0, 16),
    amountText: payment.TransAmount,
    verified: false,
  };
}
