"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatKes } from "@/lib/currency";
import { formatEatDateTime } from "@/lib/time";
import type { ReturnReceipt } from "@/lib/validation/returns";

export function ReturnReceiptModal({ receipt, onClose }: { receipt: ReturnReceipt; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const print = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    print.current?.focus({ preventScroll: true });
    return () => { element?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return createPortal(<div className="print-root">
    <dialog ref={dialog} role="dialog" onCancel={onClose} aria-label="Return receipt"
      className="fixed inset-0 m-auto max-h-[90dvh] w-full max-w-md overflow-auto rounded-2xl border border-border bg-card p-4 text-foreground shadow-card-lift backdrop:bg-foreground/40">
      <header className="no-print mb-3 flex items-center justify-between gap-3">
        <h2 className="font-serif text-xl font-semibold select-none">Return Receipt</h2>
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent">Close return receipt</button>
      </header>
      <article className="receipt-paper mx-auto w-[80mm] bg-white px-3 py-4 font-mono text-xs text-black">
        <h3 className="text-center text-base font-bold">PEDIGREE LEATHER</h3>
        <p className="mb-4 text-center font-bold">RETURN RECEIPT</p>
        <dl className="grid grid-cols-[auto_1fr] gap-2 border-y border-dashed border-current py-3">
          <dt>Return</dt><dd className="text-right">RET-{receipt.id.slice(0, 8).toUpperCase()}</dd>
          <dt>Original receipt</dt><dd className="text-right">{receipt.sale_id.slice(0, 8).toUpperCase()}</dd>
          <dt>Date (EAT)</dt><dd className="text-right">{formatEatDateTime(receipt.created_at)}</dd>
          <dt>Manager</dt><dd className="text-right">{receipt.processed_by_name}</dd>
        </dl>
        <table className="my-3 w-full text-left"><thead><tr><th scope="col">Item</th><th scope="col" className="text-right">Qty</th><th scope="col" className="text-right">Refund</th></tr></thead>
          <tbody>{receipt.items.map((item) => <tr key={item.id} className="align-top"><td className="py-2 pr-2">{item.product_name}{item.color_name ? ` · ${item.color_name}` : ""}</td><td className="py-2 text-right">{item.quantity}</td><td className="py-2 text-right">{formatKes(item.refund_amount)}</td></tr>)}</tbody>
        </table>
        <p className="border-y border-dashed border-current py-3 text-right text-sm font-bold">REFUND: {formatKes(receipt.refund_amount)}</p>
        <p className="mt-3 break-words">Reason: {receipt.reason}</p>
        <p className="mt-3">Refund recorded for manual settlement.</p>
        <p className="mt-3 break-all text-[9px]">Return ID: {receipt.id}<br />Sale ID: {receipt.sale_id}</p>
      </article>
      <button ref={print} type="button" onClick={() => window.print()} className="no-print mt-4 h-11 w-full rounded-lg bg-primary font-semibold text-cream focus-visible:outline-2 focus-visible:outline-accent">Print return receipt</button>
    </dialog>
  </div>, document.body);
}

export function ReturnHistory({ returns }: { returns: ReturnReceipt[] }) {
  const [receipt, setReceipt] = useState<ReturnReceipt | null>(null);
  return <>
    <ul className="divide-y divide-border">{returns.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
      <div><p className="font-semibold">RET-{item.id.slice(0, 8).toUpperCase()} · {formatKes(item.refund_amount)}</p><p className="text-muted">Sale {item.sale_id.slice(0, 8).toUpperCase()} · {formatEatDateTime(item.created_at)}</p></div>
      <button type="button" onClick={() => setReceipt(item)} className="rounded-lg border border-border px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-accent">Reprint return receipt</button>
    </li>)}</ul>
    {receipt ? <ReturnReceiptModal receipt={receipt} onClose={() => setReceipt(null)} /> : null}
  </>;
}
