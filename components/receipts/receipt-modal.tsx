"use client";

import { Printer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DocumentDialog } from "@/components/digital/document-dialog";
import { Receipt } from "@/components/pos/receipt";
import type { SaleRecord } from "@/lib/validation/sales";

export function ReceiptModal({ sale, onClose }: { sale: SaleRecord; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [digitalOpen, setDigitalOpen] = useState(false);
  const printButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    printButton.current?.focus({ preventScroll: true });
    return () => {
      element?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (sale.payment_method !== "card") return;
    const timer = window.setTimeout(() => { try { window.print(); } catch { /* The committed receipt stays available for manual printing. */ } }, 350);
    return () => window.clearTimeout(timer);
  }, [sale.payment_method]);

  return createPortal(
    <div className="print-root">
      <dialog ref={dialog} role="dialog" onCancel={onClose} aria-label="Receipt"
        className="fixed inset-0 m-auto max-h-[90dvh] w-full max-w-md overflow-auto rounded-2xl border border-border bg-card p-4 text-foreground shadow-card-lift backdrop:bg-black/50">
        <header className="flex items-center justify-between pb-3">
          <h2 className="font-serif text-xl font-semibold select-none">Receipt</h2>
          <button type="button" onClick={onClose} aria-label="Close receipt" className="rounded p-2 focus-visible:outline-2 focus-visible:outline-accent"><X aria-hidden="true" className="size-5" /></button>
        </header>
        <div className="no-print mb-4 rounded-xl border border-border bg-well p-4">
          <p className="text-sm font-semibold">Your sale is complete.</p>
          <button type="button" onClick={() => setDigitalOpen(true)} className="mt-3 rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-accent">Send to WhatsApp / Email</button>
        </div>
        <Receipt sale={sale} />
        <button ref={printButton} type="button" onClick={() => window.print()}
          className="no-print mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 font-semibold text-cream focus-visible:outline-2 focus-visible:outline-accent">
          <Printer aria-hidden="true" className="size-4" />Print receipt
        </button>
      </dialog>
      {digitalOpen ? <DocumentDialog kind="receipt" saleId={sale.id} onClose={() => setDigitalOpen(false)} /> : null}
    </div>, document.body,
  );
}
