"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { z } from "zod";
import { cancelPreparedCard, markCardOpened, prepareCardPayment, readOpenCardPayment } from "@/lib/flutterwave/actions";
import { cardCustomerSchema, type CardPayment } from "@/lib/validation/flutterwave";
import { saleRecordSchema, type SaleRecord, type cashSaleSchema } from "@/lib/validation/sales";
import { formatKes } from "@/lib/currency";

interface HostedConfig {
  public_key: string; tx_ref: string; amount: number; currency: "KES"; payment_options: "card";
  customer: { email: string; phone_number: string }; customizations: { title: string; description: string; logo: string };
  callback: (payload: unknown) => void; onclose: () => void;
}
declare global { interface Window { FlutterwaveCheckout?: (config: HostedConfig) => { close: () => void } } }
let scriptPromise: Promise<void> | null = null;
export function loadFlutterwaveScript(): Promise<void> {
  if (window.FlutterwaveCheckout) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => { script.remove(); reject(new Error("Card checkout did not load. Check the connection.")); }, 15000);
    script.src = "https://checkout.flutterwave.com/v3.js"; script.async = true;
    script.onload = () => { window.clearTimeout(timer); if (window.FlutterwaveCheckout) resolve(); else { script.remove(); reject(new Error("Card checkout unavailable.")); } };
    script.onerror = () => { window.clearTimeout(timer); script.remove(); reject(new Error("Card checkout did not load.")); };
    document.head.appendChild(script);
  }).catch((error: unknown) => { scriptPromise = null; throw error; });
  return scriptPromise;
}
const verifyResponse = z.object({ success: z.boolean(), sale: saleRecordSchema.optional(), error: z.string().optional() });
export async function checkFlutterwavePayment(payment: { amount: number; txRef: string; transactionId?: string }) {
  const response = await fetch("/api/flutterwave/verify", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction_id: payment.transactionId, tx_ref: payment.txRef, expected_amount: payment.amount }) });
  const payload: unknown = await response.json();
  const result = verifyResponse.parse(payload);
  if (!response.ok || !result.success || !result.sale) throw new Error(result.error ?? "Card payment is not confirmed. Check the same payment again.");
  return result.sale;
}
export async function triggerFlutterwavePayment({ amount, email, phone, txRef, onSuccess, onFailure, onHostedOpen, onHostedClose }: {
  amount: number; email: string; phone: string; txRef: string; onSuccess: (sale: SaleRecord) => void; onFailure: (message: string) => void;
  onHostedOpen?: () => void; onHostedClose?: () => void;
}) {
  await loadFlutterwaveScript();
  const customer = cardCustomerSchema.parse({ email, phone });
  const publicKey = process.env.NEXT_PUBLIC_FLW_PUBLIC_KEY;
  if (!publicKey || !window.FlutterwaveCheckout) throw new Error("Card payments are not configured.");
  let verifying = false;
  let modal: { close: () => void } | undefined;
  onHostedOpen?.();
  try {
    modal = window.FlutterwaveCheckout({ public_key: publicKey, tx_ref: txRef, amount, currency: "KES", payment_options: "card",
      customer: { email: customer.email, phone_number: customer.phone }, customizations: { title: "Pedigree Leather", description: "Secure card payment", logo: new URL("/pedigree-logo.png", window.location.origin).href },
      callback: (payload: unknown) => {
        if (verifying) return;
        verifying = true;
        // Take only the transaction ID. Card details, status and amounts in this
        // browser callback are not evidence and never reach our database/logs.
        const callback = z.object({ transaction_id: z.coerce.string().regex(/^\d+$/).optional(), id: z.coerce.string().regex(/^\d+$/).optional() }).safeParse(payload);
        const transactionId = callback.success ? callback.data.transaction_id ?? callback.data.id : undefined;
        modal?.close(); onHostedClose?.();
        if (!transactionId) { verifying = false; onFailure("Callback unavailable. Check this card payment by reference."); return; }
        void checkFlutterwavePayment({ amount, txRef, transactionId }).then(onSuccess).catch((error: unknown) => {
          verifying = false; onFailure(error instanceof Error ? error.message : "Verification unavailable. Check this payment again.");
        });
      },
      onclose: () => { onHostedClose?.(); if (!verifying) onFailure("Card window closed. Check payment status before starting another payment."); },
    });
  } catch (error) { onHostedClose?.(); throw error; }
}

export function FlutterwaveCheckout({ active, total, getCartItems, onLockChange, onBusyChange, onComplete, onHostedOpen, onHostedClose }: {
  active: boolean; total: number; getCartItems: () => z.infer<typeof cashSaleSchema>["cart_items"];
  onLockChange: (locked: boolean) => void; onBusyChange: (busy: boolean) => void; onComplete: (sale: SaleRecord) => void;
  onHostedOpen: () => void; onHostedClose: () => void;
}) {
  const [payment, setPayment] = useState<CardPayment | null>(null);
  const [email, setEmail] = useState(""); const [phone, setPhone] = useState(""); const [error, setError] = useState("");
  const [uncertainPreparation, setUncertainPreparation] = useState(false);
  const [pending, startTransition] = useTransition(); const [processing, setProcessing] = useState(false);
  const busy = useRef(false); const requestId = useRef<string | null>(null);
  const lifecycle = useRef(0);
  const callbacks = useRef({ onLockChange, onBusyChange, onComplete });
  useEffect(() => { callbacks.current = { onLockChange, onBusyChange, onComplete }; });
  useEffect(() => {
    let disposed = false;
    const version = lifecycle.current;
    void readOpenCardPayment().then((result) => {
      if (disposed || lifecycle.current !== version || !result.ok || !result.payment) return;
      setPayment(result.payment); requestId.current = result.payment.id; callbacks.current.onLockChange(true);
    }).catch(() => { /* Cash/prepare RPCs still enforce the durable card lock. */ });
    return () => { disposed = true; };
  }, []);
  function finish(sale: SaleRecord) {
    lifecycle.current += 1; setUncertainPreparation(false);
    setProcessing(false); busy.current = false; setPayment(null); requestId.current = null; setError(""); setEmail(""); setPhone("");
    callbacks.current.onBusyChange(false); callbacks.current.onLockChange(false); callbacks.current.onComplete(sale);
  }
  function failure(message: string) { setProcessing(false); busy.current = false; callbacks.current.onBusyChange(false); setError(message); }
  function pay() {
    if (busy.current) return;
    const customer = cardCustomerSchema.safeParse({ email, phone });
    if (!customer.success) { setError("Enter the customer's email and phone number."); return; }
    lifecycle.current += 1;
    const operation = lifecycle.current;
    busy.current = true; setError(""); setProcessing(true); onBusyChange(true); onLockChange(true);
    startTransition(async () => {
      let prepared = payment;
      let preparing = false;
      try {
        // Script load failure occurs before any payable reference is opened.
        await loadFlutterwaveScript();
        if (!prepared) {
          requestId.current ??= crypto.randomUUID();
          preparing = true;
          const result = await prepareCardPayment({ client_uuid: requestId.current, total_kes: total, cart_items: getCartItems() });
          if (!result.ok) { setUncertainPreparation(result.uncertain); onLockChange(result.uncertain); failure(result.error); return; }
          prepared = result.payment; setPayment(prepared);
          if (uncertainPreparation) { setUncertainPreparation(false); failure("Card checkout recovered. Continue with Card or cancel this unstarted payment."); return; }
        }
        if (prepared.status !== "prepared") {
          const sale = await checkFlutterwavePayment({ amount: prepared.amount, txRef: prepared.tx_ref });
          if (operation === lifecycle.current) finish(sale);
          return;
        }
        // Once opening is recorded, cancellation/timeout cannot unlock checkout.
        // Verification by reference recovers captures when callbacks are lost.
        const opened = await markCardOpened(prepared.id);
        setPayment({ ...prepared, status: "pending" });
        if (!opened.ok) { failure("Opening was not confirmed. Check this card payment before charging again."); return; }
        await triggerFlutterwavePayment({ amount: prepared.amount, txRef: prepared.tx_ref, email: customer.data.email, phone: customer.data.phone,
          onSuccess: (sale) => { if (operation === lifecycle.current) finish(sale); },
          onFailure: (message) => { if (operation === lifecycle.current) failure(message); }, onHostedOpen, onHostedClose });
      } catch (cause) {
        if (!prepared) { setUncertainPreparation(preparing); onLockChange(preparing); }
        failure(cause instanceof Error ? cause.message : "Card payment is not confirmed. Check its status.");
      }
    });
  }
  const input = "h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent";
  return <div hidden={!active} className="mt-4 space-y-3">
    <p className="text-sm text-muted">Enter contact details below. Card details are entered only in Flutterwave’s secure window.</p>
    <label className="block space-y-2 text-sm font-semibold">Card customer email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={processing || Boolean(payment && payment.status !== "prepared")} className={input} /></label>
    <label className="block space-y-2 text-sm font-semibold">Card customer phone<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={processing || Boolean(payment && payment.status !== "prepared")} className={input} /></label>
    {payment ? <p className="break-words text-sm text-muted">Saved card payment: {formatKes(payment.amount)} · {payment.tx_ref}</p> : null}
    {processing ? <p role="status" className="text-sm font-semibold">Processing Card...</p> : null}
    {(!payment || payment.status === "prepared") ? <button type="button" disabled={pending || processing || !process.env.NEXT_PUBLIC_FLW_PUBLIC_KEY} onClick={pay} className="h-11 w-full rounded-lg bg-primary px-4 font-semibold text-cream focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">{processing ? "Processing Card..." : uncertainPreparation ? "Recover card checkout" : "Pay with Card"}</button> : null}
    {!process.env.NEXT_PUBLIC_FLW_PUBLIC_KEY ? <p className="text-sm text-muted">Card payments are not configured.</p> : null}
    {payment ? <button type="button" disabled={pending || processing || payment.status === "prepared"} onClick={() => {
      if (busy.current) return; busy.current = true; setProcessing(true); onBusyChange(true);
      const operation = lifecycle.current;
      void checkFlutterwavePayment({ amount: payment.amount, txRef: payment.tx_ref }).then((sale) => {
        if (operation === lifecycle.current) finish(sale);
      }).catch((cause: unknown) => { if (operation === lifecycle.current) failure(cause instanceof Error ? cause.message : "Verification unavailable."); });
    }} className="h-10 w-full rounded-lg border border-border text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">Check Card Status</button> : null}
    {payment?.status === "prepared" ? <button type="button" disabled={pending || processing} onClick={() => startTransition(async () => {
      try { const result = await cancelPreparedCard(payment.id); if (!result.ok) { setError("Payment may have started. Check status before using another method."); return; }
        setPayment(null); requestId.current = null; onLockChange(false); setError(""); }
      catch { setError("Cancellation not confirmed. Retry before changing payment method."); }
    })} className="h-10 w-full rounded-lg border border-border text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">Cancel unstarted card payment</button> : null}
    {payment && payment.status !== "prepared" ? <button type="button" disabled={pending || processing} onClick={() => startTransition(async () => {
      try { const recovered = await readOpenCardPayment(); if (recovered.ok && recovered.payment) { setPayment(recovered.payment); setError(""); } }
      catch { setError("Saved checkout is unavailable. Retry verification."); }
    })} className="h-10 w-full rounded-lg border border-border text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">Refresh saved card checkout</button> : null}
    {payment && payment.status !== "prepared" ? <p className="text-xs text-muted">This payment stays locked until server verification. Closing the card window does not prove cancellation.</p> : null}
    {error ? <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-foreground">{error}</p> : null}
  </div>;
}
