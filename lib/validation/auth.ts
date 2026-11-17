import { z } from "zod";

export const pinLoginSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{4}$/, "PIN must be exactly four digits."),
});

export type PinLoginInput = z.infer<typeof pinLoginSchema>;
