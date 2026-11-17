import Image from "next/image";
import { formatKes } from "@/lib/currency";
import type { SaleRecord } from "@/lib/validation/sales";

function formatEatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }).format(new Date(value));
}

export function Receipt({ sale }: { sale: SaleRecord }) {
  const shortId = sale.id.slice(0, 8).toUpperCase();
  const method = sale.payment_method === "mpesa" ? "M-Pesa" : sale.payment_method === "card" ? "Card" : "Cash";

  return (
    <article
      id="receipt-print-area"
      className="receipt-paper mx-auto w-[80mm] bg-white px-3 py-4 text-black"
      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
    >
      <header className="text-center">
        <Image
          src="/pedigree-logo.png"
          alt="Pedigree Leather logo"
          width={120}
          height={120}
          unoptimized
          loading="eager"
          className="mx-auto mb-2 h-auto max-w-[120px]"
        />
        <h3 className="text-[15px] leading-tight font-bold tracking-[0.18em] uppercase">
          Pedigree Leather
        </h3>
        <p className="mt-1 text-[11px] leading-tight">
          Handcrafted bags &amp; shoes — Nairobi
        </p>
      </header>

      <div className="my-3 border-t border-dashed border-black" />

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px] leading-5">
        <dt>Receipt</dt>
        <dd className="text-right">{shortId}</dd>
        <dt>Date</dt>
        <dd className="text-right">{formatEatDateTime(sale.created_at)}</dd>
        <dt>Served by</dt>
        <dd className="text-right">{sale.staff_name}</dd>
      </dl>

      <div className="my-3 border-t border-dashed border-black" />

      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left">
            <th scope="col" className="font-normal">
              Item
            </th>
            <th scope="col" className="text-right font-normal">
              Qty
            </th>
            <th scope="col" className="text-right font-normal">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item, index) => (
            <tr key={index} className="align-top">
              <td className="py-1 pr-2">
                {item.name}
                {item.color_name ? ` · ${item.color_name}` : ""}
                <br />
                <span className="text-[10px] opacity-70">
                  @ {formatKes(item.unit_price)}
                </span>
              </td>
              <td className="py-1 text-right tabular-nums">{item.quantity}</td>
              <td className="py-1 text-right tabular-nums">
                {formatKes(item.unit_price * item.quantity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="my-3 border-t border-dashed border-black" />

      <dl className="grid grid-cols-[1fr_auto] gap-x-2 text-[11px] leading-5">
        <dt>Subtotal</dt>
        <dd className="tabular-nums">{formatKes(sale.subtotal)}</dd>

        {sale.discount_amount > 0 ? (
          <>
            <dt>Discount ({sale.discount_percent}%)</dt>
            <dd className="tabular-nums">−{formatKes(sale.discount_amount)}</dd>
          </>
        ) : null}

        <dt className="mt-1 border-t border-black pt-1 text-[13px] font-bold">
          TOTAL
        </dt>
        <dd className="mt-1 border-t border-black pt-1 text-right text-[13px] font-bold tabular-nums">
          {formatKes(sale.total)}
        </dd>
      </dl>

      <div className="my-3 border-t border-dashed border-black" />

      <dl className="grid grid-cols-[1fr_auto] gap-x-2 text-[11px] leading-5">
        <dt>Paid by</dt>
        <dd className="text-right uppercase">{method}</dd>
        {sale.mpesa_receipt ? <><dt>Confirmation</dt><dd className="text-right">{sale.mpesa_receipt}</dd></> : null}

        {sale.payment_method === "cash" && sale.cash_tendered !== null ? (
          <>
            <dt>Tendered</dt>
            <dd className="tabular-nums">{formatKes(sale.cash_tendered)}</dd>
            <dt className="font-bold">Change</dt>
            <dd className="text-right font-bold tabular-nums">
              {formatKes(sale.change_due ?? 0)}
            </dd>
          </>
        ) : null}


      </dl>

      <div className="my-3 border-t border-dashed border-black" />

      <footer className="text-center text-[10px] leading-4">
        <p>Thank you — karibu tena.</p>
        <p className="mt-1 opacity-70">
          Goods exchanged within 14 days with this receipt.
        </p>
        <p className="mt-1 opacity-70">Not a VAT invoice.</p>
      </footer>
    </article>
  );
}

