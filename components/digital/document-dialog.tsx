"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { DocumentTemplate } from "@/components/digital/document-template";
import { inputClass, primaryButtonClass } from "@/components/manager/form-styles";
import { createDigitalReceipt, createQuotation } from "@/lib/digital/actions";
import { whatsappLink } from "@/lib/digital/links";
import type { DigitalDocument, DigitalKind } from "@/lib/validation/digital";

interface QuoteLine { product_id: string; color_id: string; quantity: number }
export function DocumentDialog({ kind, saleId, items, onClose }: {
  kind: DigitalKind; saleId?: string; items?: QuoteLine[]; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const attempt = useRef<{ clientUuid: string; customerName: string; customerPhone: string; items: QuoteLine[]; saleId: string } | null>(null);
  const emailAttempt = useRef<{ to: string; id: string } | null>(null);
  const [document, setDocument] = useState<DigitalDocument | null>(null);
  const [error, setError] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => { const element = dialog.current; const previous = window.document.activeElement; element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement) previous.focus(); }; }, []);
  return createPortal(<div className="digital-print-root">
    <dialog ref={dialog} aria-label={kind === "quotation" ? "Digital quotation" : "Digital receipt"}
      onCancel={(event) => { if (pending) event.preventDefault(); else onClose(); }}
      className="fixed inset-0 m-auto max-h-[95dvh] w-[calc(100%-1rem)] max-w-5xl overflow-auto rounded-3xl border border-border bg-background p-3 text-foreground shadow-overlay backdrop:bg-foreground/50 sm:p-6">
      <header className="no-print mb-5 flex items-center justify-between gap-4"><h2 className="font-serif text-2xl font-semibold">{kind === "quotation" ? "Create Quote" : "Digital Receipt"}</h2><button type="button" disabled={pending} onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent">Close document</button></header>
      {!document ? <form onSubmit={(event) => { event.preventDefault(); const fields = new FormData(event.currentTarget);
        attempt.current ??= { clientUuid: crypto.randomUUID(), customerName: String(fields.get("customerName") ?? ""), customerPhone: String(fields.get("customerPhone") ?? ""), items: items ?? [], saleId: saleId ?? "" };
        const request = attempt.current; setError("");
        startTransition(async () => { try {
          const form = new FormData();
          form.set("request", JSON.stringify(request));
          const result = kind === "quotation" ? await createQuotation(form) : await createDigitalReceipt(form);
          if (result.ok) { setDocument(result.document); setUncertain(false); }
          else { setError(result.error); setUncertain(result.uncertain); if (!result.uncertain) attempt.current = null; }
        } catch { setError("Confirmation unavailable. Retry the same details."); setUncertain(true); } });
      }} className="mx-auto max-w-xl space-y-5 rounded-2xl border border-border bg-card p-6">
        <p className="text-sm text-muted">Prepare a personal {kind === "quotation" ? "quotation" : "receipt"} to share with your customer.</p>
        <fieldset disabled={pending || uncertain} className="space-y-4">
          <label className="block space-y-2 text-sm font-semibold">Customer Name<input autoFocus name="customerName" required maxLength={200} className={inputClass} /></label>
          <label className="block space-y-2 text-sm font-semibold">Customer Phone<input name="customerPhone" type="tel" required maxLength={24} placeholder="0712 345 678" className={inputClass} /></label>
        </fieldset>
        <button type="submit" disabled={pending} className={primaryButtonClass}>{pending ? "Preparing…" : uncertain ? "Retry same document" : "Prepare document"}</button>
      </form> : <>
        <DocumentTemplate document={document} />
        <div className="no-print mx-auto mt-6 max-w-4xl space-y-4 rounded-2xl border border-border bg-card p-5">
          <a href={whatsappLink(document, window.location.origin)} target="_blank" rel="noopener noreferrer" className={`${primaryButtonClass} inline-flex items-center`}>Send to WhatsApp</a>
          <p className="text-xs text-muted">WhatsApp opens with the customer’s number and a message. Review and send it there. Anyone with the document link can view it.</p>
          <form onSubmit={(event) => { event.preventDefault(); const to = String(new FormData(event.currentTarget).get("email") ?? "");
            if (emailAttempt.current?.to !== to) emailAttempt.current = { to, id: crypto.randomUUID() };
            const requestUuid = emailAttempt.current.id; setEmailStatus("");
            startTransition(async () => { try {
              const response = await fetch("/api/receipts/email", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: document.kind, documentId: document.id, to, requestUuid }) });
              if (!response.ok) { setEmailStatus(response.status === 503 ? "Email service is not configured yet. Use WhatsApp to share this document." : "Email was not confirmed. Retry to check the same request."); return; }
              setEmailStatus("Email accepted for delivery."); emailAttempt.current = null;
            } catch { setEmailStatus("Email confirmation unavailable. Retry the same address."); } });
          }} className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 space-y-2 text-sm font-semibold">Customer Email<input name="email" type="email" required maxLength={254} className={inputClass} /></label>
            <button type="submit" disabled={pending} className="h-10 rounded-lg border border-primary px-4 text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-accent">{pending ? "Sending…" : "Send via Email"}</button>
          </form>
          {emailStatus ? <p role="status" className="text-sm text-muted">{emailStatus}</p> : null}
        </div>
      </>}
      {error ? <p role="alert" className="mx-auto mt-4 max-w-xl text-sm text-danger">{error}</p> : null}
    </dialog>
  </div>, window.document.body);
}
