import { z } from "zod";

export const exchangeRateSchema = z.object({
  kes_per_usd: z.number().finite().positive().max(100000),
}).strict();
