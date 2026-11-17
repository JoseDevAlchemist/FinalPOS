/* eslint-disable @next/next/no-img-element -- Documents use stored public images without an image proxy. */
import { formatKes } from "@/lib/currency";
import { formatEatDateTime } from "@/lib/time";
import { documentNumber } from "@/lib/digital/links";
import type { DigitalDocument } from "@/lib/validation/digital";

export function DocumentTemplate({ document }: { document: DigitalDocument }) {
  const quote = document.kind === "quotation";
  return <article className="digital-document mx-auto w-full max-w-4xl overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-card-lift">
    <header className="relative overflow-hidden bg-primary px-6 py-8 text-cream sm:px-12 sm:py-12">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div><img src="/pedigree-logo.png" width={80} height={80} alt="Pedigree Leather" className="mb-5 size-20 rounded-2xl bg-cream object-contain p-2" />
          <p className="text-xs font-semibold tracking-[0.3em] text-accent-ink uppercase">Crafted in Kenya. Carried everywhere.</p>
          <h1 className="mt-3 font-serif text-4xl font-semibold sm:text-5xl">{quote ? "Your Quotation" : "Your Receipt"}</h1>
        </div>
        <div className="max-w-xs text-left sm:text-right"><span className="inline-block rounded-full border border-accent/50 px-4 py-2 text-xs font-semibold tracking-widest text-accent-ink uppercase">{quote ? "Made for you" : "Payment confirmed"}</span>
          <p className="mt-5 break-all font-mono text-xs text-cream/80">{documentNumber(document)}</p>
          <p className="mt-2 text-sm text-cream/80">{formatEatDateTime(document.created_at)} EAT</p>
        </div>
      </div>
    </header>
    <div className="px-6 py-8 sm:px-12 sm:py-10">
      <div className="grid gap-6 border-b border-border pb-8 sm:grid-cols-2">
        <div><p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">Prepared for</p><h2 className="mt-2 break-words font-serif text-3xl font-semibold">{document.customer_name}</h2></div>
        <div className="sm:text-right"><p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">Served with care by</p><p className="mt-3 font-semibold">{document.staff_name}</p><p className="mt-1 text-sm text-muted">Pedigree Leather · Nairobi</p></div>
      </div>
      <div className="divide-y divide-border">{document.items.map((item, index) => <div key={index} className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-4 py-6 sm:grid-cols-[80px_minmax(0,1fr)_auto]">
        {item.image_url ? <img src={item.image_url} referrerPolicy="no-referrer" alt={item.name} width={80} height={80} loading="lazy" className="size-14 rounded-xl border border-border bg-well object-cover sm:size-20" />
          : <div aria-hidden="true" className="grid size-14 place-items-center rounded-xl border border-border bg-well sm:size-20"><span className="size-7 rounded-full border border-border" style={{ backgroundColor: item.color_hex ?? undefined }} /></div>}
        <div className="min-w-0"><h3 className="break-words font-semibold sm:text-lg">{item.name}</h3>
          {item.color_name ? <p className="mt-2 flex items-center gap-2 text-sm text-muted"><span aria-hidden="true" className="size-3 shrink-0 rounded-full border border-border" style={{ backgroundColor: item.color_hex ?? undefined }} />{item.color_name}</p> : null}
          <p className="mt-2 text-sm text-muted">{item.quantity} × {formatKes(item.unit_price)}</p>
        </div><p className="col-start-2 font-semibold tabular-nums sm:col-start-auto sm:text-right">{formatKes(item.line_total)}</p>
      </div>)}</div>
      <dl className="ml-auto mt-4 max-w-sm space-y-3 rounded-2xl bg-well p-6">
        <div className="flex justify-between gap-4 text-sm text-muted"><dt>Subtotal</dt><dd>{formatKes(document.subtotal)}</dd></div>
        {document.discount_amount > 0 ? <div className="flex justify-between gap-4 text-sm text-muted"><dt>Discount</dt><dd>−{formatKes(document.discount_amount)}</dd></div> : null}
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-border pt-4"><dt className="font-semibold">{quote ? "Quoted total" : "Total paid"}</dt><dd className="font-serif text-3xl font-semibold text-primary">{formatKes(document.total)}</dd></div>
      </dl>
      {quote ? <p className="mt-5 text-right text-xs text-muted">Quotation only. Availability and pricing are confirmed at purchase.</p> : null}
    </div>
    <footer className="border-t border-border bg-well/50 px-6 py-8 text-center sm:px-12">
      <p className="font-serif text-2xl font-semibold text-primary">{quote ? "Something beautiful is waiting for you." : "Thank you for shopping with us."}</p>
      <p className="mt-2 text-sm text-muted">Made to last. Chosen with care.</p><p className="mt-4 text-xs font-semibold tracking-[0.3em] text-primary uppercase">Karibu Tena</p>
    </footer>
  </article>;
}
