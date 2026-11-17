import { z } from "zod";

export const createCashierSchema = z.object({
  clientUuid: z.string().uuid(),
  name: z.string().trim().min(2, "Enter the cashier's full name.").max(100),
  pin: z.string().regex(/^\d{4}$/, "Use exactly four digits for the PIN."),
});
