import { z } from "zod";

export const saleCartItemSchema = z.object({
  product_id: z.string().uuid(),
  color_id: z.string().uuid().optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(1000),
});

export const createSaleSchema = z.object({
  client_uuid: z.string().uuid(),
  payment_method: z.enum(["cash", "mpesa", "card"]),
  cash_tendered: z.coerce.number().int().min(0).optional().nullable(),
  discount_percent: z.coerce.number().int().min(0).max(100).default(0),
  mpesa_phone: z.string().trim().optional().nullable(),
  cart_items: z.array(saleCartItemSchema).min(1).max(100),
});

export const cashSaleSchema = z.object({
  client_uuid: z.string().uuid(),
  payment_method: z.literal("cash"),
  cash_tendered: z.number().int().min(0).max(2147483647),
  total_kes: z.number().int().min(0).max(2147483647),
  cart_items: z.array(z.object({
    product_id: z.string().uuid(),
    color_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(1000),
    price_at_sale: z.number().int().min(0).max(2147483647),
  })).min(1).max(100),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const saleRecordSchema = z.object({
  id: z.string().uuid(),
  client_uuid: z.string().uuid(),
  staff_name: z.string(),
  subtotal: z.number().int(),
  discount_percent: z.number().int(),
  discount_amount: z.number().int(),
  total: z.number().int(),
  payment_method: z.enum(["cash", "mpesa", "card"]),
  payment_status: z.enum(["pending", "paid", "failed", "cancelled"]),
  cash_tendered: z.number().int().nullable(),
  change_due: z.number().int().nullable(),
  created_at: z.string(),
  mpesa_receipt: z.string().nullable().optional(),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().int(),
      unit_price: z.number().int(),
      line_total: z.number().int(),
      color_name: z.string().nullable().optional(),
    }),
  ),
  idempotent: z.boolean().optional(),
});

export type SaleRecord = z.infer<typeof saleRecordSchema>;

export const receiptEmailSchema = z.object({
  to: z.string().email(),
  sale: saleRecordSchema,
});
