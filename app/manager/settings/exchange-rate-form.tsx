"use client";

import { useState } from "react";

import { useToast } from "@/components/ui/toast";
import { updateExchangeRateAction } from "@/lib/payments/settings-actions";

export function ExchangeRateForm({ initialRate }: { initialRate: number }) {
  const [rate, setRate] = useState(String(initialRate));
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await updateExchangeRateAction({ kes_per_usd: Number(rate) });
      if (!result.ok) {
        toast.error("Could not save", result.error);
        return;
      }
      toast.success("Exchange rate updated.");
    } catch {
      toast.error("Could not save", "Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-foreground">Exchange Rate (1 USD = ? KES)</span>
        <input
          type="number"
          min="0.000001"
          max={100000}
          step="any"
          required
          disabled={saving}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className="h-11 w-40 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      <button
        type="submit"
        disabled={saving}
        className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-cream transition-colors hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save rate"}
      </button>
    </form>
  );
}
