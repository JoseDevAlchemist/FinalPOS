"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { ReturnForm } from "@/components/returns/return-form";
import { inputClass, primaryButtonClass } from "@/components/manager/form-styles";
import { lookupReturnReceipt, loadCashierReturnSale } from "@/lib/returns/pin-actions";
import type { ReturnSale } from "@/lib/validation/returns";
import { formatKes } from "@/lib/currency";
import { formatEatDateTime } from "@/lib/time";

type Matches = { id: string; staff_name: string; total: number; created_at: string }[];
export function ReturnDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [sales, setSales] = useState<Matches>([]);
  const [sale, setSale] = useState<ReturnSale | null>(null);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => { const element = dialog.current; const previous = document.activeElement; element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement) previous.focus(); }; }, []);
  return createPortal(<dialog ref={dialog} aria-label="Return with manager approval" onCancel={(event) => { if (locked || pending) event.preventDefault(); else onClose(); }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-auto rounded-2xl border border-border bg-card p-6 text-foreground shadow-overlay backdrop:bg-foreground/40">
    <header className="mb-5 flex items-center justify-between gap-4"><h2 className="font-serif text-2xl font-semibold">Return with Manager Approval</h2><button type="button" disabled={locked || pending} onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent">Close</button></header>
    {!sale ? <>
      <form onSubmit={(event) => { event.preventDefault(); const receipt = new FormData(event.currentTarget).get("receipt"); setError(""); startTransition(async () => {
        try { const result = await lookupReturnReceipt(receipt); if (!result.ok) setError(result.error); else { setSales(result.sales); if (!result.sales.length) setError("No paid sale matches this receipt."); } }
        catch { setError("Receipt lookup unavailable. Try again."); }
      }); }} className="space-y-3">
        <label className="block space-y-2 text-sm font-semibold">Receipt Number<input autoFocus name="receipt" required maxLength={36} className={inputClass} /></label>
        <button type="submit" disabled={pending} className={primaryButtonClass}>{pending ? "Loading…" : "Find receipt"}</button>
      </form>
      <ul className="mt-4 divide-y divide-border">{sales.map((item) => <li key={item.id}><button type="button" disabled={pending} onClick={() => startTransition(async () => {
        try { const result = await loadCashierReturnSale(item.id); if (result.ok) setSale(result.sale); else setError(result.error); }
        catch { setError("Could not load this receipt."); }
      })} className="w-full rounded-lg px-2 py-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent">{item.id.slice(0, 8).toUpperCase()} · {formatEatDateTime(item.created_at)} · {formatKes(item.total)} · {item.staff_name}</button></li>)}</ul>
    </> : <><p className="mb-4 text-sm text-muted">Receipt {sale.id.slice(0, 8).toUpperCase()} · {formatKes(sale.total)}</p><ReturnForm sale={sale} requirePin onLockChange={setLocked} /></>}
    {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}
    {locked ? <p className="mt-4 text-xs text-muted">Confirm this return or retry the same request before closing.</p> : null}
  </dialog>, document.body);
}
