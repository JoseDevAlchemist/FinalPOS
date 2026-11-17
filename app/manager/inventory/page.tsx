import { requireManager } from "@/lib/auth/session";
import { listStockMovements } from "@/lib/management/queries";
import { formatEatDateTime } from "@/lib/time";
import Link from "next/link";

export default async function InventoryPage() {
  await requireManager();
  const movements = await listStockMovements();
  return <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
    <header><p className="text-xs font-semibold tracking-widest text-muted uppercase">Inventory</p><h1 className="mt-2 font-serif text-3xl font-semibold">Stock history</h1><p className="mt-2 text-sm text-muted">Latest 100 movements, including sales, opening stock and manager adjustments. Times are East Africa Time.</p></header>
    <Link href="/manager/products" className="inline-block rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-cream">Adjust stock in Products</Link>
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-card">
      <table className="w-full text-left text-sm"><thead className="bg-well text-xs text-muted uppercase"><tr>{["When", "Product / colour", "Change", "Stock after", "Reason", "Staff"].map((title) => <th key={title} scope="col" className="px-4 py-3">{title}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">{movements.map((row) => <tr key={row.id}>
          <td className="whitespace-nowrap px-4 py-3">{formatEatDateTime(row.created_at)}</td>
          <td className="px-4 py-3"><Link href={`/manager/products/${row.product_id}`} className="font-semibold underline-offset-4 hover:underline">{row.products.name}</Link><p className="text-muted">{row.product_colors?.color_name ?? "Removed colour"}</p></td>
          <td className="px-4 py-3 font-semibold">{row.delta > 0 ? "+" : ""}{row.delta}</td><td className="px-4 py-3">{row.quantity_after}</td><td className="max-w-xs break-words px-4 py-3">{row.reason}</td><td className="px-4 py-3">{row.pos_users?.name ?? "System"}</td>
        </tr>)}</tbody>
      </table>
      {movements.length === 0 ? <p className="p-6 text-sm text-muted">No stock movements yet.</p> : null}
    </div>
  </div>;
}
