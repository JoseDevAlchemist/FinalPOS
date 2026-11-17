import { z } from "zod";
import { cashSaleSchema } from "./sales";

export function normalizeMpesaPhone(value: string): string {
  if (!/^[+\d\s()-]{9,30}$/.test(value)) throw new Error("invalid_phone");
  const digits = value.replace(/\D/g, "");
  const phone = digits.startsWith("0") ? `254${digits.slice(1)}` : /^[17]\d{8}$/.test(digits) ? `254${digits}` : digits;
  if (!/^254[17]\d{8}$/.test(phone)) throw new Error("invalid_phone");
  return phone;
}
export const prepareMpesaSchema = cashSaleSchema.pick({ client_uuid: true, total_kes: true, cart_items: true }).extend({ total_kes: z.number().int().positive().max(2147483647) });
export const stkPushSchema = z.object({ phoneNumber: z.string().max(30), amount: z.number().int().positive().max(2147483647), saleId: z.string().uuid() });
export const receiptCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/, "Enter the 10-character M-Pesa receipt code.");
export const callbackSchema = z.object({ Body: z.object({ stkCallback: z.object({
  MerchantRequestID: z.string().min(1).max(150), CheckoutRequestID: z.string().min(1).max(150),
  ResultCode: z.number().int(),
  CallbackMetadata: z.object({ Item: z.array(z.object({ Name: z.string().max(50), Value: z.union([z.string().max(100), z.number()]).optional() })).max(12) }).optional(),
}) }) });
export type VerifiedCallback = { merchant: string; checkout: string; code: number; amount: number | null; phone: string | null; receipt: string | null };
export function parseCallback(payload: unknown): VerifiedCallback {
  const c = callbackSchema.parse(payload).Body.stkCallback;
  const fields = c.CallbackMetadata?.Item ?? [];
  if (new Set(fields.map((field) => field.Name)).size !== fields.length) throw new Error("duplicate_metadata");
  const get = (name: string) => fields.find((field) => field.Name === name)?.Value;
  return {
    merchant: c.MerchantRequestID, checkout: c.CheckoutRequestID, code: c.ResultCode,
    amount: c.ResultCode === 0 ? z.coerce.number().int().positive().max(2147483647).parse(get("Amount")) : null,
    phone: c.ResultCode === 0 ? normalizeMpesaPhone(String(get("PhoneNumber") ?? "")) : null,
    receipt: c.ResultCode === 0 ? receiptCodeSchema.parse(get("MpesaReceiptNumber")) : null,
  };
}
export const paymentStatusSchema = z.enum(["initiating", "pending", "verified", "success", "failed", "reconciliation", "manual_pending"]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
