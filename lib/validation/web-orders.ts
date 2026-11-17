import { z } from "zod";

// Current storefront checkout uses pending_payment; older orders use pending.
export const webOrderSchema = z.object({
  id: z.string().uuid(),
  order_number: z.string().trim().min(1).max(100),
  customer_name: z.string().trim().min(1).max(300),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["pending", "pending_payment", "awaiting_payment"]),
});

export const ordersTokenSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.number().int().positive(),
});
