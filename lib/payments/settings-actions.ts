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
    const { error } = await supabase.rpc("pos_manager_update_exchange_rate", {
      p_rate: parsed.data.kes_per_usd,
    });

    if (error) {
      console.error("[settings] exchange rate update failed", error);
      return { ok: false, error: "Could not save the exchange rate." };
    }

    revalidatePath("/manager");
    revalidatePath("/manager/dashboard");
    revalidatePath("/manager/settings");
    revalidatePath("/manager/products/new");
    return { ok: true };
  } catch (error) {
    console.error("[settings] exchange rate update failed", error);
    return { ok: false, error: "Could not save the exchange rate." };
  }
}
