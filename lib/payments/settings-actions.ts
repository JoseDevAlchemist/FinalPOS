"use server";

import { revalidatePath } from "next/cache";

import { requireManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { exchangeRateSchema } from "@/lib/validation/settings";

export type SettingsActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateExchangeRateAction(input: unknown): Promise<SettingsActionResult> {
  await requireManager();

  const parsed = exchangeRateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid KES per USD rate." };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("shop_settings")
      .update({ exchange_rate_kes_to_usd: parsed.data.kes_per_usd })
      .eq("key", "exchange_rate")
      .select("exchange_rate_kes_to_usd")
      .single();

    if (error || !data) {
      console.error("[settings] exchange rate update failed", error);
      return { ok: false, error: "Could not save the exchange rate." };
    }

    revalidatePath("/manager");
    revalidatePath("/manager/dashboard");
    revalidatePath("/manager/settings");
    return { ok: true };
  } catch (error) {
    console.error("[settings] exchange rate update failed", error);
    return { ok: false, error: "Could not save the exchange rate." };
  }
}
