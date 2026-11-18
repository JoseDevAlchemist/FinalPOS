import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { exchangeRateSchema } from "@/lib/validation/settings";

const DEFAULT_RATE = 130;
const settingsRow = z.object({ exchange_rate_kes_to_usd: z.number() });

export async function readExchangeRate() {
  const client = await createClient();
  const storefront = await client.from("shop_settings")
    .select("exchange_rate_kes_to_usd").eq("id", "default").maybeSingle();

  // POS-only installations use the original key/value settings table.
  const legacyLayout = storefront.error?.code === "42703" || storefront.error?.code === "PGRST204";
  const result = legacyLayout
    ? await client.from("shop_settings")
      .select("exchange_rate_kes_to_usd").eq("key", "exchange_rate").maybeSingle()
    : storefront;
  const row = settingsRow.safeParse(result.data);
  const rate = row.success
    ? exchangeRateSchema.safeParse({ kes_per_usd: row.data.exchange_rate_kes_to_usd })
    : null;

  return rate?.success
    ? { rate: rate.data.kes_per_usd, canEdit: true }
    : { rate: DEFAULT_RATE, canEdit: false };
}
