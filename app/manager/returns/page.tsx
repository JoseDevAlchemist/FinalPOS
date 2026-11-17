import Link from "next/link";
import { z } from "zod";
import { requireManager } from "@/lib/auth/session";
import { formatKes } from "@/lib/currency";
import { formatEatDateTime } from "@/lib/time";
import { findReturnSales, getReturnSale, listRecentReturns } from "@/lib/returns/queries";
import { receiptSearchSchema } from "@/lib/validation/returns";
import { ReturnForm } from "@/components/returns/return-form";
import { ReturnHistory } from "@/components/returns/return-receipt";
import { inputClass } from "@/components/manager/form-styles";

export default async function ReturnsPage({ searchParams }: {
  searchParams: Promise<{ receipt?: string | string[]; sale?: string | string[] }>;
}) {
  await requireManager();
  const params = await searchParams;
  const search = receiptSearchSchema.safeParse(params.receipt ?? "");
  const selectedId = z.string().uuid().safeParse(params.sale);
  const invalidSale = params.sale !== undefined && !selectedId.success;
  if (!search.success || invalidSale) return <div className="mx-auto max-w-5xl space-y-4 p-6">
    <h1 className="font-serif text-3xl font-semibold">Returns & Refunds</h1>
    <p role="alert" className="text-danger">Enter an eight-character receipt number or full sale ID.</p>
    <Link href="/manager/returns" className="font-semibold underline">Back to returns</Link>
  </div>;

  const data = await Promise.all([
    findReturnSales(search.data), selectedId.success ? getReturnSale(selectedId.data) : Promise.resolve(null),
    listRecentReturns(selectedId.success ? selectedId.data : undefined),
  ]).catch(() => null);
  const [sales, sale, returns] = data ?? [[], null, []];
  const content = data ? <>
      {sale ? <section className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-card">
        <header><h2 className="font-serif text-2xl font-semibold">Receipt {sale.id.slice(0, 8).toUpperCase()}</h2>
          <p className="mt-1 text-sm text-muted">{formatEatDateTime(sale.created_at)} · {sale.staff_name} · Original paid total {formatKes(sale.total)}</p>
          <p className="mt-1 break-all text-xs text-muted">Sale ID: {sale.id}</p>
        </header>
        <ReturnForm key={sale.id} sale={sale} />
      </section> : null}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-serif text-xl font-semibold">{search.data ? "Matching paid sales" : "Recent paid sales"}</h2>
        <p className="mt-1 text-xs text-muted">Up to 50 sales. Select the receipt that matches the date, amount and cashier.</p>
        <ul className="mt-4 divide-y divide-border">{sales.map((item) => <li key={item.id} className="py-3">
          <Link href={`/manager/returns?sale=${item.id}&receipt=${search.data}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg p-2 focus-visible:outline-2 focus-visible:outline-accent">
            <span><span className="font-semibold">{item.id.slice(0, 8).toUpperCase()}</span><span className="ml-3 text-sm text-muted">{formatEatDateTime(item.created_at)} · {item.staff_name}</span></span>
            <span className="font-semibold">{formatKes(item.total)}</span>
          </Link>
        </li>)}</ul>
        {sales.length === 0 ? <p className="mt-4 text-sm text-muted">No paid sales match this receipt.</p> : null}
      </section>
      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-serif text-xl font-semibold">{sale ? "Returns for this receipt" : "Recent returns"}</h2>
        <p className="mt-1 text-xs text-muted">Latest 20 returns. Use history to recover and reprint a recorded return.</p>
        <ReturnHistory returns={returns} />
        {returns.length === 0 ? <p className="mt-4 text-sm text-muted">No returns recorded yet.</p> : null}
      </section>
    </> : <p role="alert" className="rounded-xl bg-danger-soft p-4 text-foreground">Could not load returns. Check the receipt, connection and that the returns migration has been applied.</p>;
  return <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
    <header><p className="text-xs font-semibold tracking-widest text-muted uppercase">Manager authorization</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold">Returns & Refunds</h1>
      <p className="mt-2 text-sm text-muted">Find the original paid receipt, select returned items and record the manual refund.</p>
    </header>
    <form action="/manager/returns" method="get" className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 space-y-2 text-sm font-semibold">Receipt Number
        <input name="receipt" defaultValue={search.data} maxLength={36} placeholder="Eight-character receipt number or sale ID" className={inputClass} />
      </label>
      <button type="submit" className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-cream focus-visible:outline-2 focus-visible:outline-accent">Find sale</button>
    </form>
    {content}
  </div>;
}
