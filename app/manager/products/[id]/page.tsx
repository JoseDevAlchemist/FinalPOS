import { ArrowLeft, Barcode } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { QuickRestock } from "@/components/manager/quick-restock";
import { productTotalStock } from "@/lib/products/types";
import { ProductEditForm } from "@/components/manager/product-edit-form";
import { requireManager } from "@/lib/auth/session";
import { getProduct } from "@/lib/products/queries";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireManager();

  const { id } = await params;
  const product = await getProduct(id);

  if (!product) notFound();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/manager/products"
            className="inline-flex items-center gap-2 text-sm font-semibold text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to products
          </Link>
          <h1 className="mt-3 font-serif text-3xl font-semibold tracking-tight text-foreground">
            {product.name}
          </h1>
          <p className="mt-2 text-sm text-muted">
            Published, active products with available stock are eligible for the
            storefront. Saved changes use the shared catalogue.
          </p>
        </div>

        {product.barcode ? (
          <Link
            href={`/print/barcode/${product.id}`}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Barcode aria-hidden="true" className="size-4" />
            Print label
          </Link>
        ) : null}
      </header>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6 shadow-card" aria-label="Product inventory">
        <div>
          <h2 className="font-serif text-xl font-semibold">Stock quantity</h2>
          <p className="mt-1 text-sm text-muted">{productTotalStock(product)} units across all colours. Adjust stock with a reason to keep inventory history.</p>
        </div>
        <QuickRestock productId={product.id} productName={product.name} colors={product.colors} />
      </section>
      <ProductEditForm key={product.id} product={product} />
    </div>
  );
}
