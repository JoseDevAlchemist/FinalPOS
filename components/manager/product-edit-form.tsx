"use client";

import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { ProductColorPicker } from "./product-color-picker";
import { useToast } from "@/components/ui/toast";
import { priceAfterDiscount, formatKes } from "@/lib/currency";
import { catalogueCategory, preferredProductAngles, type CatalogueProduct, type ProductCategoryOption } from "@/lib/products/types";
import { ProductCategoryField, ProductUsdFields, readUsdOverride } from "./product-catalogue-fields";
import { ProductImageFields, type ProductImageDraft } from "./product-image-fields";
import { useCatalogueSave } from "./use-catalogue-save";

interface ColorDraft {
  key: string;
  id?: string;
  name: string;
  hex: string;
  images: ProductImageDraft[];
}

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function initialColors(product: CatalogueProduct): ColorDraft[] {
  if (product.colors.length === 0) {
    return [
      {
        key: "draft-1",
        name: "Default",
        hex: "#8b4513",
        images: [],
      },
    ];
  }

  return product.colors.map((color) => ({
    key: color.id,
    id: color.id,
    name: color.name,
    hex: color.hex,
    images: color.images
      .filter((image) => image.imageUrl)
      .map((image) => ({
        key: image.id,
        angle: image.angle,
        imageUrl: image.imageUrl ?? "",
      })),
  }));
}

export function ProductEditForm({ product, categories, exchangeRate, supportsOverride }: {
  product: CatalogueProduct;
  categories: ProductCategoryOption[] | null;
  exchangeRate: number;
  supportsOverride: boolean;
}) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description);
  const [selection, setSelection] = useState(categories
    ? categories.find(({ id }) => id === product.categoryId)?.id ?? ""
    : product.category);
  const category = catalogueCategory(categories, selection, product.category);
  const angles = preferredProductAngles(category);
  const [basePrice, setBasePrice] = useState(String(product.basePrice));
  const [discountPercent, setDiscountPercent] = useState(
    String(product.discountPercent),
  );
  const [barcode, setBarcode] = useState(product.barcode ?? "");
  const [active, setActive] = useState(product.active);
  const [isWebsitePublished, setIsWebsitePublished] = useState(
    product.isWebsitePublished,
  );
  const [colors, setColors] = useState<ColorDraft[]>(() =>
    initialColors(product),
  );
  const nextColorKey = useRef(colors.length + 1);
  const router = useRouter();
  const toast = useToast();
  const catalogue = useCatalogueSave(() => {
    toast.success("Product saved", name);
    router.push("/manager/products");
    router.refresh();
  });
  const disabled = catalogue.pending || catalogue.confirming;

  function updateColor(key: string, patch: Partial<ColorDraft>) {
    setColors((current) =>
      current.map((color) =>
        color.key === key ? { ...color, ...patch } : color,
      ),
    );
  }

  function addColor() {
    const key = `draft-${nextColorKey.current++}`;
    setColors((current) => [
      ...current,
      {
        key,
        name: "",
        hex: "#8b4513",
        images: [],
      },
    ]);
  }

  function removeColor(key: string) {
    if (colors.length <= 1) {
      toast.error("Keep one colour", "A product needs at least one colour.");
      return;
    }
    setColors((current) => current.filter((color) => color.key !== key));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void catalogue.save({
      name, description, category, basePrice, discountPercent, barcode, isWebsitePublished,
      active: active === product.active ? undefined : active,
      categoryId: categories && selection ? selection : undefined,
      basePriceUsd: readUsdOverride(fields),
    }, colors, product.id, product.isWebsitePublished);
  }

  const price = Number(basePrice);
  const discount = Number(discountPercent);
  const previewPrice =
    Number.isFinite(price) && Number.isFinite(discount)
      ? priceAfterDiscount(price, discount)
      : null;

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-28">
      <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-6">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <h2 className="font-serif text-xl font-semibold text-foreground">
            Product details
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-semibold text-foreground sm:col-span-2">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={inputClass}
                autoComplete="off"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-semibold text-foreground sm:col-span-2">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </label>

            <ProductCategoryField categories={categories} value={selection} onChange={setSelection} required={isWebsitePublished || !categories} />
            <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
              Barcode
              <input
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
                className={inputClass}
                autoComplete="off"
                maxLength={128}
                placeholder="PED-KARURA-001"
              />
              <span className="text-xs font-normal leading-5 text-muted">
                Printed as CODE128. Leave blank to disable label printing.
              </span>
            </label>

            <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
              Base price (KES)
              <input
                type="number"
                min={0}
                step={1}
                value={basePrice}
                onChange={(event) => setBasePrice(event.target.value)}
                className={inputClass}
                required
              />
            </label>

            <ProductUsdFields price={basePrice} exchangeRate={exchangeRate} supportsOverride={supportsOverride} initialOverride={product.basePriceUsd} />
            <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
              Discount (%)
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={discountPercent}
                onChange={(event) => setDiscountPercent(event.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          {previewPrice !== null ? (
            <p className="mt-4 rounded-lg bg-well p-3 text-sm text-muted">
              KES price after discount:{" "}
              <span className="font-semibold text-foreground">
                {formatKes(previewPrice)}
              </span>
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <h2 className="font-serif text-xl font-semibold text-foreground">
            Visibility
          </h2>
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex items-start gap-3 rounded-xl border border-border bg-background p-3 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                <span className="block font-semibold text-foreground">
                  Active in the till
                </span>
                <span className="mt-1 block text-muted">
                  Inactive products are hidden from the till and the website.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-border bg-background p-3 text-sm">
              <input
                type="checkbox"
                checked={isWebsitePublished}
                disabled={!categories?.length && !isWebsitePublished}
                onChange={(event) => setIsWebsitePublished(event.target.checked)}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                <span className="block font-semibold text-foreground">
                  Publish on website
                </span>
                <span className="mt-1 block text-muted">
                  The product must also be active to appear on the storefront.
                </span>
              </span>
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-xl font-semibold text-foreground">
                Colours and images
              </h2>
              <p className="mt-1 text-sm text-muted">
                Stock is changed from the products list so every movement is
                logged. New colours start at zero.
              </p>
            </div>
            <button
              type="button"
              onClick={addColor}
              disabled={colors.length >= 30}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Plus aria-hidden="true" className="size-4" />
              Add colour
            </button>
          </div>

          <div className="mt-5">
            <ProductColorPicker selected={colors.map((color) => color.name)} disabled={disabled} onToggle={(option) => {
              const existing = colors.find((color) => color.name.toLowerCase() === option.name.toLowerCase());
              if (existing) {
                if (product.colors.some((saved) => saved.id === existing.id && saved.stockQuantity > 0)) {
                  toast.error("Colour has stock", "Adjust its stock before removing this colour.");
                  return;
                }
                removeColor(existing.key);
              } else if (colors.length < 30) {
                const key = `draft-${nextColorKey.current++}`;
                setColors((current) => [...current, { key, ...option, images: [] }]);
              }
            }} />
          </div>
          <div className="mt-5 flex flex-col gap-5">
            {colors.map((color) => (
              <div
                key={color.key}
                className="rounded-xl border border-border bg-background p-4"
              >
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
                    Colour
                    <input
                      value={color.name}
                      onChange={(event) =>
                        updateColor(color.key, { name: event.target.value })
                      }
                      className={`${inputClass} w-44`}
                      placeholder="Tan"
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
                    Swatch
                    <span className="flex h-10 items-center gap-2">
                      <input
                        type="color"
                        value={color.hex}
                        onChange={(event) =>
                          updateColor(color.key, { hex: event.target.value })
                        }
                        aria-label={`${color.name || "Colour"} swatch`}
                        className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-background p-1"
                      />
                      <span className="text-xs font-medium text-muted">
                        {color.hex}
                      </span>
                    </span>
                  </label>

                  <div className="flex h-10 items-center gap-2 rounded-lg bg-well px-3 text-xs font-semibold text-muted">
                    Stock
                    <span className="text-sm text-foreground">
                      {product.colors.find((saved) => saved.id === color.id)?.stockQuantity ?? 0}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeColor(color.key)}
                    className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    Remove
                  </button>
                </div>

                <div className="mt-4">
                  <ProductImageFields images={color.images} angles={angles} disabled={disabled} onChange={(images) => updateColor(color.key, { images })} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </fieldset>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
        {catalogue.error ? (
          <p role="alert" className="mx-auto mb-2 max-w-5xl rounded-lg bg-danger-soft p-2 text-sm text-foreground">
            {catalogue.error}
          </p>
        ) : null}
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-2">
          {catalogue.progress ? <p role="status" className="mr-auto text-sm text-muted">{catalogue.progress}</p> : null}
          <Link
            href="/manager/products"
            className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-foreground/5"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={catalogue.pending}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-cream transition-colors hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {catalogue.pending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Save aria-hidden="true" className="size-4" />
            )}
            {catalogue.confirming ? "Retry save" : "Save product"}
          </button>
        </div>
      </div>
    </form>
  );
}
