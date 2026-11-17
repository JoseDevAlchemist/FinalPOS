"use client";

import { Banknote, Smartphone, CreditCard, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { z } from "zod";
import { formatKes } from "@/lib/currency";
import { prepareMpesaSaleAction, cancelMpesaDraftAction } from "@/lib/mpesa/actions";
import { paymentStatusSchema, type PaymentStatus } from "@/lib/validation/mpesa";
import { saleRecordSchema, type SaleRecord, type cashSaleSchema } from "@/lib/validation/sales";
import { FlutterwaveCheckout } from "@/components/pos/flutterwave-checkout";
import { useToast } from "@/components/ui/toast";

type CartItems = z.infer<typeof cashSaleSchema>["cart_items"];
const responseSchema = z.object({ transactionId: z.string().uuid().optional(), status: paymentStatusSchema.optional(), error: z.string().optional(), notStarted: z.boolean().optional() });
const statusSchema = z.object({ status: paymentStatusSchema, sale: saleRecordSchema.nullable() });

export function CheckoutDialog({ open, total, subtotal, cashTendered, onCashChange, submitting, onCashConfirm, onClose, getCartItems, onPaymentLockChange, onComplete }: {
  open: boolean; total: number; subtotal: number; cashTendered: string; onCashChange: (value: string) => void;
  submitting: boolean; onCashConfirm: () => void; onClose: () => void; getCartItems: () => CartItems;
  onPaymentLockChange: (locked: boolean) => void; onComplete: (sale: SaleRecord) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"cash" | "mpesa" | "card">("cash");
  const [cardLocked, setCardLocked] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; });
  const [phone, setPhone] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [switching, startSwitch] = useTransition();
  const draft = useRef<string | null>(null);
  const attempt = useRef<string | null>(null);
  const busy = useRef(false);
  const startedAt = useRef(0);
  const toast = useToast();
  const locked = dispatching || (status !== null && status !== "failed");

  useEffect(() => {
    if (open) dialog.current?.showModal(); else dialog.current?.close();
  }, [open]);

  function finish(sale: SaleRecord) {
    draft.current = null; attempt.current = null;
    setTransactionId(null); setStatus(null); setTimedOut(false); setTab("cash"); setPhone(""); setManualCode("");
    onPaymentLockChange(false);
    toast.success("Payment received", "M-Pesa payment confirmed by the server.");
    onComplete(sale);
  }
  // Keep polling tied to an immutable attempt, without restarting it whenever
  // the parent receives a refreshed catalogue or a new callback identity.
  const finishRef = useRef(finish);
  useEffect(() => { finishRef.current = finish; });

  async function checkStatus(id: string, reconcile = false, signal?: AbortSignal) {
    const response = await fetch(`/api/mpesa/status?transactionId=${id}${reconcile ? "&reconcile=1" : ""}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error("status_unavailable");
    const result = statusSchema.parse(await response.json());
    if (signal?.aborted) return;
    if (result.status === "success" && result.sale) { finishRef.current(result.sale); return; }
    setStatus(result.status);
    onPaymentLockChange(result.status !== "failed");
    if (result.status === "failed") toast.error("Payment not completed", "The provider declined or cancelled the request. You can retry or use cash.");
  }
  const checkRef = useRef(checkStatus);
  useEffect(() => { checkRef.current = checkStatus; });
  useEffect(() => {
    if (!open || !transactionId || status === "failed" || timedOut) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      if (!active) return;
      if (Date.now() - startedAt.current >= 60000) {
        setTimedOut(true);
        toast.error("Payment not confirmed", "The request timed out on this screen. Check status before charging again; a delayed callback may still arrive.");
        return;
      }
      try { await checkRef.current(transactionId ?? "", false, controller.signal); } catch { /* Keep the last confirmed server state while connectivity recovers. */ }
      if (active) timer = setTimeout(poll, 4000);
    }
    void poll();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [open, transactionId, status, timedOut, toast]);

  async function initiate() {
    if (busy.current || locked) return;
    busy.current = true; setDispatching(true); setTimedOut(false); onPaymentLockChange(true);
    let id: string | null = null;
    try {
      draft.current ??= crypto.randomUUID();
      const prepared = await prepareMpesaSaleAction({ client_uuid: draft.current, total_kes: total, cart_items: getCartItems() });
      if (!prepared.ok) { onPaymentLockChange(false); toast.error("Review payment", prepared.error); return; }
      attempt.current = crypto.randomUUID(); id = attempt.current;
      startedAt.current = Date.now();
      const response = await fetch("/api/mpesa/stk-push", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": id },
        body: JSON.stringify({ phoneNumber: phone, amount: prepared.amount, saleId: prepared.saleId }),
      });
      const result = responseSchema.parse(await response.json());
      if (result.notStarted) { setStatus(null); setTransactionId(null); onPaymentLockChange(false); toast.error("Payment not started", result.error ?? "Review the payment details."); return; }
      setTransactionId(result.transactionId ?? id);
      setStatus(result.status ?? "reconciliation");
      onPaymentLockChange(result.status !== "failed");
      if (!response.ok) toast.error("Payment needs attention", result.error ?? "Check status before trying again.");
    } catch {
      if (id) { setTransactionId(id); setStatus("reconciliation"); toast.error("Confirmation unavailable", "Check this payment's status before starting another request."); }
      else { onPaymentLockChange(false); toast.error("Payment not started", "Review the cart and your connection."); }
    } finally { busy.current = false; setDispatching(false); }
  }
  function chooseCash() {
    if (locked || cardLocked) { toast.error("Payment unresolved", "Wait for confirmation or a verified decline before using cash."); return; }
    startSwitch(async () => {
      if (draft.current && !(await cancelMpesaDraftAction(draft.current)).ok) { toast.error("Payment unresolved", "Check the M-Pesa status before using cash."); return; }
      draft.current = null; attempt.current = null; setTransactionId(null); setStatus(null); setTimedOut(false); setTab("cash");
    });
  }
  async function saveManual() {
    if (!transactionId) return;
    try {
      const response = await fetch("/api/mpesa/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactionId, receiptCode: manualCode }) });
      if (!response.ok) throw new Error("manual_failed");
      setStatus("manual_pending"); onPaymentLockChange(true);
      toast.info("Code saved", "Payment remains unverified and needs reconciliation. No paid sale or receipt has been created.");
    } catch { toast.error("Code not saved", "Check the receipt code and your connection."); }
  }
  const changeDue = Math.max((Number(cashTendered) || 0) - total, 0);
  const inputClass = "h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  const buttonClass = "h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-cream hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
  return <dialog ref={dialog} onCancel={(event) => { if (submitting || dispatching || cardBusy) event.preventDefault(); else onClose(); }} aria-label="Checkout"
    className="fixed inset-0 m-auto max-h-[90dvh] w-full max-w-lg overflow-auto rounded-2xl border border-border bg-card p-5 text-foreground shadow-card-lift backdrop:bg-black/50">
    <header className="flex items-center justify-between"><h2 className="font-serif text-xl font-semibold">Checkout</h2><button type="button" disabled={submitting || dispatching || cardBusy} onClick={onClose} aria-label="Close checkout" className="rounded p-2 focus-visible:outline-2 focus-visible:outline-accent"><X aria-hidden="true" className="size-5" /></button></header>
    <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="Payment method">
      <button type="button" aria-pressed={tab === "cash"} disabled={submitting || switching || cardLocked} onClick={chooseCash} className="flex h-12 items-center justify-center gap-2 rounded-lg border border-border aria-pressed:border-primary aria-pressed:bg-primary/10 focus-visible:outline-2 focus-visible:outline-accent"><Banknote aria-hidden="true" className="size-4" />Cash</button>
      <button type="button" aria-pressed={tab === "mpesa"} disabled={submitting || switching || cardLocked} onClick={() => setTab("mpesa")} className="flex h-12 items-center justify-center gap-2 rounded-lg border border-border aria-pressed:border-primary aria-pressed:bg-primary/10 focus-visible:outline-2 focus-visible:outline-accent"><Smartphone aria-hidden="true" className="size-4" />M-Pesa</button>
      <button type="button" aria-pressed={tab === "card"} disabled={submitting || switching || locked} onClick={() => {
        startSwitch(async () => {
          if (draft.current && !(await cancelMpesaDraftAction(draft.current)).ok) { toast.error("Payment unresolved", "Resolve M-Pesa before card payment."); return; }
          draft.current = null; attempt.current = null; setTransactionId(null); setStatus(null); setTab("card");
        });
      }} className="flex h-12 items-center justify-center gap-2 rounded-lg border border-border aria-pressed:border-primary aria-pressed:bg-primary/10 focus-visible:outline-2 focus-visible:outline-accent"><CreditCard aria-hidden="true" className="size-4" />Card</button>
    </div>
    <div className="mt-4 space-y-3 rounded-xl border border-border bg-background p-4 text-sm"><div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{formatKes(subtotal)}</span></div><div className="flex justify-between border-t border-border pt-2 font-semibold"><span>Total</span><span>{formatKes(total)}</span></div></div>
    {tab === "cash" ? <div className="mt-4 space-y-3">
      <label className="block space-y-2 text-sm font-semibold">Cash tendered<input type="number" min={0} step={1} value={cashTendered} onChange={(event) => onCashChange(event.target.value)} className={inputClass} /></label>
      <p className="text-sm text-muted">Change: <span className="font-semibold text-foreground">{formatKes(changeDue)}</span></p>
      <button type="button" onClick={onCashConfirm} disabled={cardLocked || locked || submitting || cashTendered === "" || !Number.isSafeInteger(Number(cashTendered)) || Number(cashTendered) < total} className={`${buttonClass} flex w-full items-center justify-center gap-2`}>{submitting ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}{submitting ? "Confirming…" : "Complete sale"}</button>
    </div> : tab === "mpesa" ? <div className="mt-4 space-y-3">
      <label className="block space-y-2 text-sm font-semibold">M-Pesa phone number<input type="tel" inputMode="tel" autoComplete="tel" placeholder="07… or 01…" value={phone} disabled={locked} onChange={(event) => setPhone(event.target.value)} className={inputClass} /></label>
      <button type="button" onClick={() => void initiate()} disabled={locked || phone.trim().length < 9} className={`${buttonClass} w-full`}>{dispatching ? "Sending request…" : status === "failed" ? "Try again" : "Initiate Payment"}</button>
      {locked ? <div role="status" aria-live="polite" className="rounded-xl border border-border bg-well p-3 text-sm">
        {timedOut || status === "reconciliation" || status === "manual_pending" ? "Payment needs reconciliation. Check status or save the receipt code; do not charge again until it is resolved." : "Waiting for customer to enter PIN..."}
      </div> : null}
      {transactionId ? <button type="button" disabled={dispatching} onClick={() => void checkStatus(transactionId, true).catch(() => toast.error("Status unavailable", "Check your connection and try again."))} className="h-10 w-full rounded-lg border border-border text-sm font-semibold">Check payment status</button> : null}
      {transactionId && (timedOut || status === "failed" || status === "reconciliation" || status === "manual_pending") ? <fieldset className="space-y-2 rounded-xl border border-border p-3"><legend className="px-1 text-sm font-semibold">Manual fallback</legend><label className="block text-sm">M-Pesa receipt code<input maxLength={10} value={manualCode} onChange={(event) => setManualCode(event.target.value.toUpperCase())} className={inputClass} /></label><button type="button" onClick={() => void saveManual()} disabled={manualCode.length !== 10} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">Save unverified code</button><p className="text-xs text-muted">A typed code is not proof of payment. It is saved for reconciliation and does not create a paid receipt.</p></fieldset> : null}
    </div> : null}
    {cardLocked && tab !== "card" ? <p role="status" className="mt-4 text-sm text-muted">A saved card payment needs verification. Open Card to recover it.</p> : null}
    <FlutterwaveCheckout active={tab === "card"} total={total} getCartItems={getCartItems}
      onLockChange={(value) => { setCardLocked(value); onPaymentLockChange(value || locked); }} onBusyChange={setCardBusy}
      onHostedOpen={() => dialog.current?.close()} onHostedClose={() => { if (openRef.current) dialog.current?.showModal(); }}
      onComplete={(sale) => { setCardLocked(false); setCardBusy(false); setTab("cash"); onPaymentLockChange(false); toast.success("Payment received", "Card payment verified by the server."); onComplete(sale); }} />
  </dialog>;
}
