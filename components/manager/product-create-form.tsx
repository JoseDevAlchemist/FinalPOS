"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { catalogueCategory, preferredProductAngles, type ProductCategoryOption } from "@/lib/products/types";
import { ProductColorPicker } from "./product-color-picker";
import { ProductImageFields, type ProductImageDraft } from "./product-image-fields";
import { ProductCategoryField, ProductUsdFields, readUsdOverride } from "./product-catalogue-fields";
import { useCatalogueSave } from "./use-catalogue-save";
import { inputClass, primaryButtonClass } from "./form-styles";

interface NewColor {
  key: number;
  name: string;
  hex: string;
  stockQuantity: string;
  images: ProductImageDraft[];
}

export function ProductCreateForm({ categories, exchangeRate, supportsOverride }: {
  categories: ProductCategoryOption[] | null;
  exchangeRate: number;
  supportsOverride: boolean;
}) {
  const router = useRouter();
  const taxonomy = categories?.length ? categories : null;
  const nextKey = useRef(1);
  const [colors, setColors] = useState<NewColor[]>([{ key: 0, name: "Tan", hex: "#8B4513", stockQuantity: "0", images: [] }]);
  const [price, setPrice] = useState("");
  const [selection, setSelection] = useState(taxonomy ? taxonomy[0].id : "bag");
  const [colorError, setColorError] = useState("");
  const [published, setPublished] = useState(false);
  const catalogue = useCatalogueSave((id) => {
    router.push(`/manager/products/${id}`);
    router.refresh();
  });
  const disabled = catalogue.pending || catalogue.confirming;
  const category = catalogueCategory(taxonomy, selection, "bag");
  const angles = preferredProductAngles(category);
  function update(key: number, patch: Partial<NewColor>) {
    setColors((current) => current.map((color) => color.key === key ? { ...color, ...patch } : color));
  }

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      void catalogue.save({
        category,
        categoryId: taxonomy ? selection : undefined,
        isWebsitePublished: published,
        name: fields.get("name"),
        basePrice: fields.get("price"),
        basePriceUsd: readUsdOverride(fields),
        discountPercent: fields.get("discountPercent"),
        barcode: fields.get("barcode"),
        description: fields.get("description"),
      }, colors);
    }} className="space-y-6">
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-semibold">Name<input name="name" required minLength={2} maxLength={200} className={inputClass} /></label>
        <ProductCategoryField categories={taxonomy} value={selection} onChange={setSelection} />
        <label className="space-y-2 text-sm font-semibold">Price (KES)<input name="price" type="number" value={price} onChange={(event) => setPrice(event.target.value)} required min={0} step={1} max={100000000} className={inputClass} /></label>
        <ProductUsdFields price={price} exchangeRate={exchangeRate} supportsOverride={supportsOverride} />
        <label className="space-y-2 text-sm font-semibold">Discount (%)<input name="discountPercent" type="number" min={0} max={100} step={1} defaultValue={0} required className={inputClass} /></label>
        <label className="space-y-2 text-sm font-semibold">Barcode<input name="barcode" maxLength={128} className={inputClass} /></label>
        <label className="space-y-2 text-sm font-semibold sm:col-span-2">Description<textarea name="description" maxLength={5000} className={`${inputClass} min-h-24 py-3`} /></label>
        <label className="flex items-center gap-3 text-sm font-semibold sm:col-span-2">
          <input type="checkbox" name="isWebsitePublished" checked={published} disabled={!taxonomy} onChange={(event) => setPublished(event.target.checked)} className="size-4 accent-primary" />
          Publish on website
        </label>
      </fieldset>
      <ProductColorPicker selected={colors.map((color) => color.name)} disabled={disabled} onToggle={(option) => {
        setColorError("");
        const existing = colors.find((color) => color.name.toLowerCase() === option.name.toLowerCase());
        if (existing) {
          if (colors.length === 1) { setColorError("Keep at least one colour."); return; }
          setColors((current) => current.filter((color) => color.key !== existing.key));
        } else if (colors.length < 30) {
          const key = nextKey.current++;
          setColors((current) => [...current, { key, ...option, stockQuantity: "0", images: [] }]);
        }
      }} />
      <div className="space-y-4">
        {colors.map((color, index) => (
          <fieldset key={color.key} disabled={disabled} className="grid min-w-0 gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
            <legend className="px-2 font-semibold">Colour {index + 1}</legend>
            <label className="space-y-2 text-sm">Colour name<input required value={color.name} onChange={(event) => update(color.key, { name: event.target.value })} className={inputClass} /></label>
            <label className="space-y-2 text-sm">Colour swatch<input type="color" value={color.hex} onChange={(event) => update(color.key, { hex: event.target.value })} className={inputClass} /></label>
            <label className="space-y-2 text-sm">Initial stock<input type="number" min={0} max={100000} step={1} required value={color.stockQuantity} onChange={(event) => update(color.key, { stockQuantity: event.target.value })} className={inputClass} /></label>
            <div className="min-w-0 sm:col-span-2">
              <ProductImageFields images={color.images} angles={angles} disabled={disabled} onChange={(images) => update(color.key, { images })} />
            </div>
            {colors.length > 1 ? <button type="button" onClick={() => setColors((current) => current.filter((entry) => entry.key !== color.key))} className="text-left text-sm text-danger">Remove colour {index + 1}</button> : null}
          </fieldset>
        ))}
        <button type="button" disabled={disabled || colors.length >= 30} onClick={() => {
          const key = nextKey.current++;
          setColors((current) => [...current, { key, name: "", hex: "#000000", stockQuantity: "0", images: [] }]);
        }} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">Add colour</button>
      </div>
      {!taxonomy ? <p className="text-sm text-muted">Website publishing requires an active storefront category.</p> : null}
      {colorError || catalogue.error ? <p role="alert" className="text-sm text-danger">{catalogue.error || colorError}</p> : null}
      {catalogue.progress ? <p role="status" className="text-sm text-muted">{catalogue.progress}</p> : null}
      <p className="text-sm text-muted">New products are available at the till. Initial stock is recorded in the inventory ledger.</p>
      <button type="submit" disabled={catalogue.pending} className={primaryButtonClass}>
        {catalogue.confirming ? "Retry save" : catalogue.pending ? "Saving…" : "Create product"}
      </button>
    </form>
  );
}
