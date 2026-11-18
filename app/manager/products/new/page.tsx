import { requireManager } from "@/lib/auth/session";
import { readExchangeRate } from "@/lib/payments/settings";
import { listProductCategories, supportsUsdPriceOverride } from "@/lib/products/queries";
import { ProductCreateForm } from "@/components/manager/product-create-form";

export default async function NewProductPage() {
  await requireManager();
  const [categories, exchangeRate, supportsOverride] = await Promise.all([listProductCategories(), readExchangeRate(), supportsUsdPriceOverride()]);
  return <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
    <header><p className="text-xs font-semibold tracking-widest text-muted uppercase">Catalogue</p><h1 className="mt-2 font-serif text-3xl font-semibold">Add product</h1></header>
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card"><ProductCreateForm categories={categories} exchangeRate={exchangeRate.rate} supportsOverride={supportsOverride} /></section>
  </div>;
}
