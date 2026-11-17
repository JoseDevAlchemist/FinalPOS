"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { ReturnReceiptModal } from "@/components/returns/return-receipt";
import { inputClass, primaryButtonClass } from "@/components/manager/form-styles";
import { formatKes } from "@/lib/currency";
import { processReturnWithPin } from "@/lib/returns/pin-actions";
import { processReturn } from "@/lib/returns/actions";
import { refundForQuantity } from "@/lib/returns/refund";
import { returnRequestSchema, type ReturnSale, type ReturnRequest, type ReturnReceipt } from "@/lib/validation/returns";

export function ReturnForm({ sale, requirePin = false, onLockChange }: { sale: ReturnSale; requirePin?: boolean; onLockChange?: (locked: boolean) => void }) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [complete, setComplete] = useState<ReturnReceipt | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [pending, startTransition] = useTransition();
  const attempt = useRef<ReturnRequest | null>(null);
  const busy = useRef(false);
  const pinInput = useRef<HTMLInputElement>(null);
  useEffect(() => { onLockChange?.(pending || uncertain); }, [pending, uncertain, onLockChange]);
  const toast = useToast();
  const router = useRouter();
  const selected = sale.items.map((item) => ({ item, quantity: Number(quantities[item.id] ?? 0) }));
  const total = selected.reduce((sum, { item, quantity }) => sum + refundForQuantity(item, quantity), 0);
  const remaining = sale.items.some((item) => item.quantity > item.returned_quantity && item.color_id);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || complete) return;
    if (!attempt.current) {
      const parsed = returnRequestSchema.safeParse({ clientUuid: crypto.randomUUID(), saleId: sale.id, reason,
        items: selected.filter(({ quantity }) => quantity > 0).map(({ item, quantity }) => ({ sale_item_id: item.id, quantity })),
      });
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the return."); return; }
      attempt.current = parsed.data;
    }
    const payload = attempt.current;
    const approval = new FormData();
    if (requirePin) {
      approval.set("managerPin", pinInput.current?.value ?? "");
      approval.set("request", JSON.stringify(payload));
      if (pinInput.current) pinInput.current.value = "";
    }
    busy.current = true;
    setError("");
    startTransition(async () => {
      try {
        const result = requirePin ? await processReturnWithPin(approval) : await processReturn(payload);
        if (!result.ok) {
          setError(result.error);
          const unresolved = uncertain || result.uncertain;
          setUncertain(unresolved);
          if (!unresolved) attempt.current = null;
          return;
        }
        setComplete(result.receipt);
        setUncertain(false);
        setShowReceipt(true);
        toast.success("Return recorded", `${formatKes(result.receipt.refund_amount)} refund recorded for manual settlement.`);
        router.refresh();
      } catch {
        setUncertain(true);
        setError("Confirmation was lost. Retry this same request before starting another return.");
      } finally { busy.current = false; }
    });
  }

  return <>
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={pending || uncertain || Boolean(complete)} className="space-y-4">
        <legend className="mb-3 font-semibold">Items to return</legend>
        {sale.items.map((item) => {
          const available = item.quantity - item.returned_quantity;
          return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
            <div><p className="font-semibold">{item.name}{item.color_name ? ` · ${item.color_name}` : ""}</p>
              <p className="mt-1 text-sm text-muted">Purchased: {item.quantity} · Already returned: {item.returned_quantity} · Available: {available}</p>
              <p className="text-sm text-muted">Original unit price: {formatKes(item.unit_price)}</p>
              {!item.color_id ? <p className="text-sm text-danger">Original colour missing; inventory review required.</p> : null}
            </div>
            <label className="w-32 text-sm font-semibold">Return quantity for {item.name} {item.color_name ?? ""}
              <input type="number" min={0} max={Math.min(1000, available)} step={1} value={quantities[item.id] ?? "0"}
                disabled={available === 0 || !item.color_id} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))}
                className={inputClass} />
            </label>
          </div>;
        })}
        <label className="block space-y-2 text-sm font-semibold">Reason for Return
          <textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}
            placeholder="Defective, wrong size, customer request…" className={`${inputClass} min-h-24 py-3`} />
        </label>
      </fieldset>
      {requirePin && !complete ? <label className="block space-y-2 text-sm font-semibold">Manager PIN
        <input ref={pinInput} name="managerPin" type="password" inputMode="numeric" autoComplete="off" required minLength={4} maxLength={4} pattern="[0-9]{4}" disabled={pending} className={inputClass} />
        <span className="block text-xs font-normal text-muted">Ask the manager to enter their PIN to authorize this return.</span>
      </label> : null}
      <p className="text-lg font-semibold">Refund: {formatKes(complete?.refund_amount ?? total)}</p>
      <p className="text-sm text-muted">Refunds use original paid amounts after discounts. This records the refund and restocks the selected items; arrange the money separately.</p>
      {!remaining ? <p role="status" className="text-sm text-muted">No items remain available to return.</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-foreground">{error}</p> : null}
      {complete ? <div className="space-y-3">
        <p role="status" className="text-sm font-semibold">Return recorded. Refund due: {formatKes(complete.refund_amount)}.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setShowReceipt(true)} className={primaryButtonClass}>View return receipt</button>
          {remaining ? <button type="button" onClick={() => {
            attempt.current = null;
            setComplete(null); setQuantities({}); setReason(""); setError("");
          }} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">Return more items from this sale</button> : null}
        </div>
      </div> : <button type="submit" disabled={pending || (!remaining && !uncertain)} className={primaryButtonClass}>
        {pending ? "Recording…" : uncertain ? "Retry same return" : "Authorize return & record refund"}
      </button>}
    </form>
    {complete && showReceipt ? <ReturnReceiptModal receipt={complete} onClose={() => setShowReceipt(false)} /> : null}
  </>;
}
