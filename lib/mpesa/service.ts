import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { paymentStatusSchema } from "@/lib/validation/mpesa";
import { queryStkPush } from "./client";

export const attemptSchema = z.object({ id: z.string().uuid(), sale_id: z.string().uuid(), amount: z.number().int(), status: paymentStatusSchema,
  merchant_request_id: z.string().nullable(), checkout_request_id: z.string().nullable(),
  callback_merchant_id: z.string().nullable(), callback_checkout_id: z.string().nullable(), callback_result_code: z.number().int().nullable() });
export async function readAttempt(id: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("pos_mpesa_transactions").select("id,sale_id,amount,status,merchant_request_id,checkout_request_id,callback_merchant_id,callback_checkout_id,callback_result_code").eq("id", id).single();
  if (error) throw new Error("attempt_unavailable");
  return attemptSchema.parse(data);
}
export async function processPayment(id: string, reconcileWithoutCallback = false) {
  const attempt = await readAttempt(id);
  if (attempt.status === "success" || (attempt.status === "failed" && attempt.callback_result_code !== 0)) return attempt.status;
  const checkout = attempt.checkout_request_id ?? attempt.callback_checkout_id;
  const merchant = attempt.merchant_request_id ?? attempt.callback_merchant_id;
  if (!checkout || !merchant || (attempt.callback_result_code === null && !reconcileWithoutCallback)) return attempt.status;
  const result = await queryStkPush(checkout);
  if (result.CheckoutRequestID !== checkout || result.MerchantRequestID !== merchant) throw new Error("provider_mismatch");
  const admin = createAdminClient();
  if (!attempt.checkout_request_id) {
    const attached = await admin.rpc("pos_attach_mpesa_request", { p_id: id, p_merchant: merchant, p_checkout: checkout });
    if (attached.error) throw new Error("provider_attachment_failed");
  }
  const { data, error } = await admin.rpc("pos_apply_mpesa_callback", { p_id: id, p_provider_code: result.ResultCode });
  if (error) throw new Error("payment_confirmation_failed");
  const status = paymentStatusSchema.parse(data);
  if (status === "success") {
    revalidatePath("/pos"); revalidatePath("/manager"); revalidatePath("/manager/dashboard"); revalidatePath("/manager/inventory");
  }
  return status;
}
