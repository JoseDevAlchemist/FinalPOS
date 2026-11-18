import { PosTerminal } from "@/components/pos/pos-terminal";
import { isCardPaymentConfigured } from "@/lib/flutterwave/config";
import { requireStaff } from "@/lib/auth/session";
import { listActiveProducts } from "@/lib/products/queries";

export default async function PosHome() {
  await requireStaff();
  const products = await listActiveProducts();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-muted uppercase">
            Till
          </p>
          <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-foreground">
            New sale
          </h1>
          <p className="mt-1 text-sm text-muted">
            Scan a barcode or search the catalogue. Prices come from the server.
          </p>
        </div>
      </header>

      <PosTerminal products={products} cardEnabled={isCardPaymentConfigured()} />
    </div>
  );
}
