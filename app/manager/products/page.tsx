import { Barcode, Pencil, ScanBarcode, Search } from "lucide-react";
import Link from "next/link";

import { QuickRestock } from "@/components/manager/quick-restock";
import { requireManager } from "@/lib/auth/session";
import { formatKes, priceAfterDiscount } from "@/lib/currency";
import { listProducts } from "@/lib/products/queries";
import { productTotalStock } from "@/lib/products/types";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  await requireManager();

  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const products = await listProducts(query);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-muted uppercase">
            Catalogue
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-foreground">
            Products
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Edit prices, barcodes, images and website visibility. Stock changes
            go through the audited restock dialog.
          </p>
        </div>

        <Link href="/manager/products/new" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-cream hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-accent">Add product</Link>

        <Link
          href="/pos"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ScanBarcode aria-hidden="true" className="size-4" />
          Open till
        </Link>
      </header>

      <form
        action="/manager/products"
        method="get"
        className="flex max-w-xl items-center gap-2"
      >
        <label htmlFor="product-search" className="sr-only">
          Search products
        </label>
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          />
          <input
            id="product-search"
            name="q"
            defaultValue={query}
            placeholder="Search by name or barcode"
            className="h-10 w-full rounded-lg border border-border bg-card pr-3 pl-9 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
        </div>
        <button
          type="submit"
          className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-cream transition-colors hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Search
        </button>
      </form>

      {products.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <h2 className="font-serif text-xl font-semibold text-foreground">
            No products found
          </h2>
          <p className="mt-2 text-sm text-muted">
            {query
              ? "Try a different name or barcode."
              : "Create a product to start building the catalogue."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_120px_100px_120px_auto] gap-3 border-b border-border bg-well px-4 py-3 text-xs font-semibold tracking-[0.12em] text-muted uppercase md:grid">
            <span>Product</span>
            <span>Price</span>
            <span>Stock</span>
            <span>Website status</span>
            <span className="text-right">Actions</span>
          </div>

          <ul className="divide-y divide-border">
            {products.map((product) => {
              const totalStock = productTotalStock(product);
              const price = priceAfterDiscount(
                product.basePrice,
                product.discountPercent,
              );

              return (
                <li
                  key={product.id}
                  className="grid gap-4 p-4 md:grid-cols-[minmax(0,1.6fr)_120px_100px_120px_auto] md:items-center md:gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate font-semibold text-foreground">
                        {product.name}
                      </h2>
                      <span className="rounded-full bg-well px-2 py-0.5 text-[0.65rem] font-semibold tracking-wide text-muted uppercase">
                        {product.category}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>/{product.slug}</span>
                      {product.barcode ? (
                        <span className="rounded bg-well px-1.5 py-0.5 font-mono">
                          {product.barcode}
                        </span>
                      ) : (
                        <span>No barcode</span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      {product.colors.map((color) => (
                        <span
                          key={color.id}
                          title={`${color.name}: ${color.stockQuantity}`}
                          className="size-3 rounded-full border border-border"
                          style={{ backgroundColor: color.hex }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="text-sm">
                    <p className="font-semibold text-foreground">
                      {formatKes(price)}
                    </p>
                    {product.discountPercent > 0 ? (
                      <p className="text-xs text-muted line-through">
                        {formatKes(product.basePrice)}
                      </p>
                    ) : null}
                  </div>

                  <p
                    className={`text-sm font-semibold ${totalStock > 0 ? "text-foreground" : "text-danger"}`}
                  >
                    {totalStock} units
                  </p>

                  <div className="flex flex-wrap gap-1.5 text-[0.65rem] font-semibold tracking-wide uppercase">
                    <span
                      className={`rounded-full px-2 py-1 ${product.active ? "bg-success-soft text-foreground" : "bg-well text-muted"}`}
                    >
                      {product.active ? "Active" : "Inactive"}
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 ${product.isWebsitePublished ? "bg-success-soft text-foreground" : "bg-well text-muted"}`}
                    >
                      {product.isWebsitePublished ? "Published" : "Draft"}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                    <Link
                      href={`/manager/products/${product.id}`}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <Pencil aria-hidden="true" className="size-4" />
                      Edit
                    </Link>

                    <QuickRestock
                      productId={product.id}
                      productName={product.name}
                      colors={product.colors.map((color) => ({
                        id: color.id,
                        name: color.name,
                        hex: color.hex,
                        stockQuantity: color.stockQuantity,
                      }))}
                    />

                    {product.barcode ? (
                      <Link
                        href={`/print/barcode/${product.id}`}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <Barcode aria-hidden="true" className="size-4" />
                        Label
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
