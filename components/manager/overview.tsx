import { AlertTriangle, Banknote, ShoppingBag, TrendingUp } from "lucide-react";

import { requireManager } from "@/lib/auth/session";
import { formatKes } from "@/lib/currency";
import { readExchangeRate } from "@/lib/payments/settings";
import { getDashboardStats } from "@/lib/sales/queries";

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-KE", {
      timeStyle: "short",
      timeZone: "Africa/Nairobi",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default async function ManagerOverview() {
  await requireManager();
  let stats;
  let settings;
  try { [stats, settings] = await Promise.all([getDashboardStats(), readExchangeRate()]); }
  catch { return <div role="alert" className="mx-auto max-w-6xl p-8 text-danger">The overview could not be loaded. Refresh to try again.</div>; }

  const todayTotal = stats?.todayTotal ?? 0;
  const todayCount = stats?.todayCount ?? 0;
  const lowStock = stats?.lowStock ?? [];
  const recentSales = stats?.recentSales ?? [];
  const exchangeRate = settings.rate;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
      <header>
        <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-muted uppercase">Overview</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-foreground">Overview</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Today&apos;s performance and items that need attention.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center gap-2 text-muted">
            <TrendingUp aria-hidden="true" className="size-4" />
            <span className="text-xs font-semibold tracking-wide uppercase">Today&apos;s sales</span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-foreground">{formatKes(todayTotal)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center gap-2 text-muted">
            <ShoppingBag aria-hidden="true" className="size-4" />
            <span className="text-xs font-semibold tracking-wide uppercase">Transactions</span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-foreground">{todayCount}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center gap-2 text-muted">
            <AlertTriangle aria-hidden="true" className="size-4" />
            <span className="text-xs font-semibold tracking-wide uppercase">Low stock</span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-foreground">{stats.lowStockCount}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center gap-2 text-muted">
            <Banknote aria-hidden="true" className="size-4" />
            <span className="text-xs font-semibold tracking-wide uppercase">Exchange rate</span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-foreground">KES {exchangeRate}/$</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <h2 className="font-serif text-xl font-semibold text-foreground">Low stock alerts</h2>
          {lowStock.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No low-stock items right now.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {lowStock.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-semibold text-foreground">{item.name}</p>
                    <p className="text-xs text-muted">{item.color_name}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.stock_quantity <= 0 ? "bg-danger-soft text-danger" : "bg-well text-muted"}`}>
                    {item.stock_quantity} left
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <h2 className="font-serif text-xl font-semibold text-foreground">Recent sales today</h2>
          {recentSales.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No sales recorded today yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {recentSales.map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-semibold text-foreground">{sale.staff_name}</p>
                    <p className="text-xs text-muted">
                      {formatTime(sale.created_at)} · {sale.payment_method.toUpperCase()} · {sale.payment_status}
                    </p>
                  </div>
                  <span className="font-semibold text-foreground">{formatKes(sale.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

