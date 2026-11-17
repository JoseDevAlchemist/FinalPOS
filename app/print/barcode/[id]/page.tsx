export const instant = false;

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BarcodeLabel } from "@/components/manager/barcode-label";
import { requireManager } from "@/lib/auth/session";
import { priceAfterDiscount } from "@/lib/currency";
import { getProduct } from "@/lib/products/queries";

export default async function BarcodePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireManager();

  const { id } = await params;
  const product = await getProduct(id);

  if (!product || !product.barcode) notFound();

  return (
    <div className="print-root mx-auto flex min-h-svh w-full max-w-xl flex-col gap-6 px-6 py-10">
      <Link
        href="/manager/products"
        className="no-print inline-flex w-fit items-center gap-2 text-sm font-semibold text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to products
      </Link>

      <BarcodeLabel
        barcode={product.barcode}
        productName={product.name}
        price={priceAfterDiscount(
          product.basePrice,
          product.discountPercent,
        )}
      />
    </div>
  );
}
