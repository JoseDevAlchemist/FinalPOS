import { requireManager } from "@/lib/auth/session";
import { getExchangeRate } from "@/lib/sales/queries";

import { ExchangeRateForm } from "./exchange-rate-form";

export default async function SettingsPage() {
  await requireManager();
  const rate = await getExchangeRate();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-muted uppercase">Configuration</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Manage store-wide settings such as the KES/USD exchange rate.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-serif text-xl font-semibold text-foreground">Exchange rate</h2>
        <p className="mt-2 text-sm text-muted">
          Used to derive USD display prices. Completed sales keep their historical KES amounts.
        </p>
        <div className="mt-4">
          <ExchangeRateForm initialRate={rate} />
        </div>
      </section>
    </div>
  );
}
