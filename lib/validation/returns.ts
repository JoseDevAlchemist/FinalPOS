import { z } from "zod";

const money = z.number().int().nonnegative().max(2147483647);
export const receiptSearchSchema = z.string().trim().toLowerCase()
  .refine((value) => value === "" || /^[0-9a-f]{8}$/.test(value) || z.string().uuid().safeParse(value).success,
    "Enter the eight-character receipt number or the full sale ID.");
export const returnRequestSchema = z.object({
  clientUuid: z.string().uuid(), saleId: z.string().uuid(),
  reason: z.string().trim().min(1, "Enter a reason for return.").max(500),
  items: z.array(z.object({ sale_item_id: z.string().uuid(), quantity: z.number().int().min(1).max(1000) })).min(1, "Select an item to return.").max(100),
}).superRefine((value, context) => {
  if (new Set(value.items.map((item) => item.sale_item_id)).size !== value.items.length)
    context.addIssue({ code: "custom", message: "Select each sale item once.", path: ["items"] });
});
export const returnSaleSchema = z.object({
  id: z.string().uuid(), staff_name: z.string(), total: money, created_at: z.string(), payment_method: z.string(),
  items: z.array(z.object({
    id: z.string().uuid(), product_id: z.string().uuid(), color_id: z.string().uuid().nullable(),
    name: z.string(), color_name: z.string().nullable(), quantity: z.number().int().positive(), unit_price: money,
    refund_budget: money, returned_quantity: z.number().int().nonnegative(),
  })),
});
export const returnReceiptSchema = z.object({
  id: z.string().uuid(), sale_id: z.string().uuid(), processed_by_name: z.string(),
  refund_amount: money, reason: z.string(), created_at: z.string(),
  items: z.array(z.object({ id: z.string().uuid(), product_name: z.string(), color_name: z.string().nullable(),
    quantity: z.number().int().positive(), refund_amount: money })),
});
export const returnSaleSummarySchema = z.object({
  id: z.string().uuid(), staff_name: z.string(), total: money, created_at: z.string(),
});
export type ReturnRequest = z.infer<typeof returnRequestSchema>;
export type ReturnSale = z.infer<typeof returnSaleSchema>;
export type ReturnReceipt = z.infer<typeof returnReceiptSchema>;
