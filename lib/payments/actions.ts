"use server";
import { requireStaff } from "@/lib/auth/session";

export async function initiateMpesaPaymentAction() {
  await requireStaff();
  return { ok: false as const, error: "Use the verified M-Pesa checkout to start a payment." };
}
