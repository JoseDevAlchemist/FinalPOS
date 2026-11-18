"use client";

import {
  Monitor,
  Minus,
  Plus,
  ScanBarcode,
  Search,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";


import { useRouter } from "next/navigation";
import { ReturnDialog } from "@/components/pos/return-dialog";
import { DocumentDialog } from "@/components/digital/document-dialog";
import { CheckoutDialog } from "@/components/pos/checkout-dialog";
import { ProductVisual } from "@/components/pos/product-visual";
import { ReceiptModal } from "@/components/receipts/receipt-modal";
import { useToast } from "@/components/ui/toast";
import { useCustomerDisplay } from "@/hooks/use-customer-display";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { formatKes, priceAfterDiscount } from "@/lib/currency";
import { createSaleAction } from "@/lib/sales/actions";
import { buildCartItems, selectedProductColor, type CartLine } from "@/lib/sales/cart";
import {
  colorPrimaryImage,
  type CatalogueProduct,
} from "@/lib/products/types";
import type { SaleRecord } from "@/lib/validation/sales";

export function PosTerminal({ products, cardEnabled }: { products: CatalogueProduct[]; cardEnabled: boolean }) {
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedColors, setSelectedColors] = useState<Record<string, string>>({});
  const [category, setCategory] = useState("all");
  const attempt = useRef<{ uuid: string; payload: string } | null>(null);
  const busy = useRef(false);
  const [, startTransition] = useTransition();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [cashTendered, setCashTendered] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<SaleRecord | null>(null);
  const toast = useToast();
  const router = useRouter();
  const [paymentLocked, setPaymentLocked] = useState(false);
  function finishMpesa(sale: SaleRecord) {
    setCheckoutOpen(false); setCart([]); setCashTendered(""); setPaymentLocked(false); setReceipt(sale);
    router.refresh();
  }

  const byId = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return products.filter(
      (product) =>
        (category === "all" || product.category === category) &&
        (!term || product.name.toLocaleLowerCase().includes(term) ||
        !!product.barcode?.toLocaleLowerCase().includes(term)),
    );
  }, [products, search, category]);

  const subtotal = cart.reduce((total, line) => {
    const product = byId.get(line.productId);
    if (!product) return total;
    return (
      total +
      priceAfterDiscount(product.basePrice, product.discountPercent) *
        line.quantity
    );
  }, 0);

  const total = subtotal;
  const { status: displayStatus, connect, paint } = useCustomerDisplay();
  useEffect(() => { paint(total); }, [total, paint]);

  async function connectDisplay() {
    try { await connect(); }
    catch (error) { toast.error("Display unavailable", error instanceof Error ? error.message : "Reconnect the display and try again."); }
  }

  function addToCart(product: CatalogueProduct, quantity = 1) {
    if (paymentLocked) { toast.error("Payment unresolved", "Reopen checkout to resolve the existing payment before changing this cart."); return; }
    const color = selectedProductColor(product, selectedColors[product.id]);
    if (!color || color.stockQuantity <= 0) {
      toast.error("Out of stock", "Select a colour with available stock.");
      return;
    }
    const existing = cart.find((line) => line.productId === product.id && line.colorId === color.id);
    if ((existing?.quantity ?? 0) + quantity > color.stockQuantity) {
      toast.error("Not enough stock", `${product.name} (${color.name}) has ${color.stockQuantity} available.`);
      return;
    }
    setCart((current) => {
      const line = current.find((entry) => entry.productId === product.id && entry.colorId === color.id);
      if (!line) return [...current, { productId: product.id, colorId: color.id, quantity }];
      return current.map((entry) =>
        entry.productId === product.id && entry.colorId === color.id
          ? { ...entry, quantity: Math.min(color.stockQuantity, entry.quantity + quantity) }
          : entry,
      );
    });
    toast.success("Added to cart", `${product.name} · ${color.name}`);
  }

  function setQuantity(productId: string, colorId: string, quantity: number) {
    if (paymentLocked) return;
    const product = byId.get(productId);
    const color = product?.colors.find((entry) => entry.id === colorId);
    if (!product || !color) return;
    if (quantity <= 0) {
      setCart((current) => current.filter((line) => line.productId !== productId || line.colorId !== colorId));
      return;
    }
    if (quantity > color.stockQuantity) {
      toast.error("Not enough stock", `${product.name} (${color.name}) has ${color.stockQuantity} available.`);
      return;
    }
    setCart((current) => current.map((line) =>
      line.productId === productId && line.colorId === colorId ? { ...line, quantity } : line,
    ));
  }

  function handleScan(code: string) {
    const product = products.find((entry) => entry.barcode === code);
    if (!product) {
      toast.error("Barcode not found", `No loaded product uses ${code}.`);
      return;
    }
    addToCart(product);
  }

  useBarcodeScanner({ onScan: handleScan, minLength: 3, paused: checkoutOpen || !!receipt || returnOpen || quoteOpen });

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const term = search.trim();
    if (!term) return;

    const exact = products.find(
      (product) =>
        product.barcode?.toLocaleLowerCase() === term.toLocaleLowerCase() ||
        product.name.toLocaleLowerCase() === term.toLocaleLowerCase(),
    );

    if (exact) {
      addToCart(exact);
      setSearch("");
      return;
    }

  }

  async function completeSale() {
    if (paymentLocked) { toast.error("Payment unresolved", "Resolve M-Pesa before charging cash."); return; }
    if (busy.current || cart.length === 0) return;
    const tendered = Number(cashTendered);
    if (!Number.isSafeInteger(tendered) || tendered < total) {
      toast.error("Insufficient cash", "Enter a whole KES amount covering the total.");
      return;
    }
    let cartItems: ReturnType<typeof buildCartItems>;
    try {
      cartItems = buildCartItems(cart, byId);
    } catch (error) {
      toast.error("Stock changed", error instanceof Error ? error.message : "Review the selected colours and quantities.");
      return;
    }
    const details = {
      payment_method: "cash",
      cash_tendered: tendered,
      total_kes: total,
      cart_items: cartItems,
    };
    const fingerprint = JSON.stringify(details);
    if (attempt.current && attempt.current.payload !== fingerprint) {
      toast.error("Checkout awaiting confirmation", "Retry the original cart and tendered amount before changing this sale.");
      return;
    }
    attempt.current ??= { uuid: crypto.randomUUID(), payload: fingerprint };
    busy.current = true;
    setSubmitting(true);
    try {
      const result = await createSaleAction({ ...details, client_uuid: attempt.current.uuid });
      if (!result.ok) {
        if (result.code === "rejected") attempt.current = null;
        toast.error("Sale failed", result.error);
        return;
      }
      attempt.current = null;
      setCheckoutOpen(false);
      setCart([]);
      setCashTendered("");
      setReceipt(result.data);
      toast.success("Sale completed", `Receipt ${result.data.id.slice(0, 8).toUpperCase()}`);
    } catch {
      toast.error("Confirmation unavailable", "Retry with the same cart and cash amount to safely check this sale.");
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }


  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="flex min-w-0 flex-col gap-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void connectDisplay()} disabled={displayStatus !== "disconnected"}
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60">
              <Monitor aria-hidden="true" className="size-4" />
              {displayStatus === "connected" ? "Display connected" : displayStatus === "connecting" ? "Connecting…" : "Connect Display"}
            </button>
            <span role="status" className="sr-only">Customer display {displayStatus}</span>
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                form="pos-search-form"
                placeholder="Search products or type a barcode"
                aria-label="Search products or type a barcode"
                className="h-11 w-full rounded-lg border border-border bg-background pr-3 pl-9 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </div>

            <button
              type="submit"
              form="pos-search-form"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-cream transition-colors hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Search aria-hidden="true" className="size-4" />
              Find
            </button>
          </div>

          <form id="pos-search-form" onSubmit={submitSearch} />

          <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-muted">
            <ScanBarcode aria-hidden="true" className="size-4" />
            Scanner ready — scan anywhere outside the search field.
          </div>
        </div>

        <div className="flex gap-2" aria-label="Product categories">
          {[["all", "All products"], ["bag", "Bags"], ["shoe", "Shoes"]].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={category === value}
              onClick={() => setCategory(value)}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground aria-pressed:bg-primary aria-pressed:text-cream focus-visible:outline-2 focus-visible:outline-accent">
              {label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
            <h2 className="font-serif text-xl font-semibold text-foreground">
              No matching products
            </h2>
            <p className="mt-2 text-sm text-muted">
              Check the spelling, or clear the search to see the full catalogue.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((product) => {
              const selectedColor = selectedProductColor(product, selectedColors[product.id]);
              const stock = selectedColor?.stockQuantity ?? 0;
              const image = colorPrimaryImage(selectedColor);
              const price = priceAfterDiscount(product.basePrice, product.discountPercent);

              return (
                <article
                  key={product.id}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card"
                >
                  <div className="flex gap-3">
                    <ProductVisual name={product.name} colorName={selectedColor?.name}
                      colorHex={selectedColor?.hex} imageUrl={image} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="truncate font-semibold text-foreground">
                          {product.name}
                        </h2>
                        <span className="rounded-full bg-well px-2 py-0.5 text-[0.6rem] font-semibold tracking-wide text-muted uppercase">
                          {product.category}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        {formatKes(price)}
                      </p>
                      {product.discountPercent > 0 ? (
                        <p className="text-xs text-muted">
                          {product.discountPercent}% off{" "}
                          <span className="line-through">{formatKes(product.basePrice)}</span>
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <fieldset className="flex flex-wrap items-center gap-1">
                      <legend className="sr-only">{product.name} colour</legend>
                      {product.colors.map((color) => (
                        <label key={color.id} title={`${color.name}: ${color.stockQuantity} in stock`}
                          className="grid size-9 cursor-pointer place-items-center">
                          <input
                            type="radio"
                            name={`colour-${product.id}`}
                            value={color.id}
                            checked={selectedColor?.id === color.id}
                            onChange={() => setSelectedColors((current) => ({ ...current, [product.id]: color.id }))}
                            aria-label={`${color.name} (${color.stockQuantity} in stock)`}
                            className="peer sr-only"
                          />
                          <span aria-hidden="true"
                            className="size-5 rounded-full border border-border shadow-sm ring-1 ring-black/10 peer-checked:ring-2 peer-checked:ring-primary peer-checked:ring-offset-2 peer-checked:ring-offset-card peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"
                            style={{ backgroundColor: color.hex }}
                          />
                        </label>
                      ))}
                    </fieldset>
                    <span
                      className={`ml-auto text-xs font-semibold ${stock > 0 ? "text-muted" : "text-danger"}`}
                    >
                      {selectedColor ? `${selectedColor.name} · ${stock > 0 ? `${stock} in stock` : "Out of stock"}` : "No colours available"}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => addToCart(product)}
                    disabled={stock <= 0 || paymentLocked}
                    className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-cream transition-colors hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus aria-hidden="true" className="size-4" />
                    Add to cart
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <aside className="h-fit rounded-2xl border border-border bg-card p-4 shadow-card lg:sticky lg:top-4">
        <div className="flex items-center gap-2">
          <ShoppingBag aria-hidden="true" className="size-5 text-primary" />
          <h2 className="font-serif text-xl font-semibold text-foreground">Cart</h2>
          <span className="ml-auto rounded-full bg-well px-2 py-0.5 text-xs font-semibold text-muted">
            {cart.reduce((totalItems, line) => totalItems + line.quantity, 0)} items
          </span>
        </div>

        {cart.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm leading-6 text-muted">
            Scan a barcode or add a product to start a sale.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {cart.map((line) => {
              const product = byId.get(line.productId);
              if (!product) return null;
              const color = product.colors.find((entry) => entry.id === line.colorId);
              const price = priceAfterDiscount(product.basePrice, product.discountPercent);

              return (
                <li key={`${line.productId}:${line.colorId}`} className="rounded-xl border border-border bg-background p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{product.name}</p>
                      <p className="mt-0.5 text-xs text-muted">{color?.name ?? "Colour unavailable"} · {formatKes(price)} each</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setQuantity(product.id, line.colorId, 0)}
                      aria-label={`Remove ${product.name} — ${color?.name ?? "unavailable colour"}`}
                      className="rounded-md p-1 text-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="inline-flex items-center rounded-lg border border-border bg-card">
                      <button
                        type="button"
                        onClick={() => setQuantity(product.id, line.colorId, line.quantity - 1)}
                        aria-label={`Decrease ${product.name} — ${color?.name ?? "unavailable colour"}`}
                        className="grid size-8 place-items-center text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <Minus aria-hidden="true" className="size-4" />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold text-foreground">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuantity(product.id, line.colorId, line.quantity + 1)}
                        aria-label={`Increase ${product.name} — ${color?.name ?? "unavailable colour"}`}
                        className="grid size-8 place-items-center text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <Plus aria-hidden="true" className="size-4" />
                      </button>
                    </div>
                    <p className="text-sm font-semibold text-foreground">
                      {formatKes(price * line.quantity)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {paymentLocked ? <p role="status" className="mt-3 text-sm text-muted">A payment is awaiting confirmation. Open Resolve payment to check its status.</p> : null}
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-muted">Subtotal</span>
            <span className="text-xl font-semibold text-foreground">{formatKes(subtotal)}</span>
          </div>
          <div className="mt-2 flex justify-between font-semibold text-foreground"><span>Total</span><span>{formatKes(total)}</span></div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={submitting || paymentLocked} onClick={() => setReturnOpen(true)} className="h-10 flex-1 rounded-lg border border-border px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">Return</button>
            <button type="button" disabled={!cart.length || submitting || paymentLocked} onClick={() => setQuoteOpen(true)} className="h-10 flex-1 rounded-lg border border-primary px-3 text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">Create Quote</button>
          </div>
          <button
            type="button"
            disabled={cart.length === 0 && !paymentLocked}
            onClick={() => setCheckoutOpen(true)}
            className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-cream transition-colors hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {paymentLocked ? "Resolve payment" : `Charge ${formatKes(total)}`}
          </button>
        </div>
      </aside>

      <CheckoutDialog cardEnabled={cardEnabled} open={checkoutOpen} total={total} subtotal={subtotal}
        cashTendered={cashTendered} onCashChange={setCashTendered} submitting={submitting}
        onCashConfirm={() => startTransition(() => { void completeSale(); })}
        onClose={() => setCheckoutOpen(false)} getCartItems={() => buildCartItems(cart, byId)}
        onPaymentLockChange={setPaymentLocked} onComplete={finishMpesa} />

      {returnOpen ? <ReturnDialog onClose={() => setReturnOpen(false)} /> : null}
      {quoteOpen ? <DocumentDialog kind="quotation" items={cart.map((line) => ({ product_id: line.productId, color_id: line.colorId, quantity: line.quantity }))} onClose={() => setQuoteOpen(false)} /> : null}
      {receipt ? <ReceiptModal sale={receipt} onClose={() => setReceipt(null)} /> : null}
    </div>
  );
}
