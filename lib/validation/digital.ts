import { z } from "zod";

export const customerPhoneSchema = z.string().trim().transform((value) => {
  const clean = value.replace(/[\s()+-]/g, "");
  if (/^0[17]\d{8}$/.test(clean)) return `254${clean.slice(1)}`;
  return clean;
}).pipe(z.string().regex(/^[1-9]\d{7,14}$/, "Use a valid phone number with country code, e.g. 254712345678."));
export const digitalKindSchema = z.enum(["receipt", "quotation"]);
export const digitalCustomerSchema = z.object({
  clientUuid: z.string().uuid(), customerName: z.string().trim().min(1).max(200), customerPhone: customerPhoneSchema,
});
export const quoteRequestSchema = digitalCustomerSchema.extend({
  items: z.array(z.object({ product_id: z.string().uuid(), color_id: z.string().uuid(), quantity: z.number().int().min(1).max(1000) })).min(1).max(100),
});
export const receiptDocumentRequestSchema = digitalCustomerSchema.extend({ saleId: z.string().uuid() });
const money = z.number().int().nonnegative().max(2147483647);
const image = z.string().max(2048).refine((value) => /^https?:\/\//i.test(value) || (value.startsWith("/") && !value.startsWith("//"))).nullable().catch(null);
export const documentSchema = z.object({
  id: z.string().uuid(), kind: digitalKindSchema, sale_id: z.string().uuid().optional(), share_token: z.string().uuid(),
  staff_name: z.string(), customer_name: z.string(), customer_phone: customerPhoneSchema,
  created_at: z.string(), subtotal: money, discount_amount: money, total: money,
  items: z.array(z.object({ name: z.string(), color_name: z.string().nullable(), color_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().catch(null),
    image_url: image, quantity: z.number().int().positive(), unit_price: money, line_total: money })),
});
export const emailDocumentSchema = z.object({ kind: digitalKindSchema, documentId: z.string().uuid(), to: z.string().email(), requestUuid: z.string().uuid() });
export type DigitalDocument = z.infer<typeof documentSchema>;
export type DigitalKind = z.infer<typeof digitalKindSchema>;
