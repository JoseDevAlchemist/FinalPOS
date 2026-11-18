"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadProductImageAction, upsertProduct } from "@/lib/products/actions";
import { ProductColorPicker } from "./product-color-picker";
import { inputClass, primaryButtonClass } from "./form-styles";

interface NewColor { key: number; name: string; hex: string; stockQuantity: string; imageUrl: string }
const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function ProductCreateForm({ categories, exchangeRate }: {
  categories: { id: string; name: string }[];
  exchangeRate: number;
}) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const nextKey = useRef(1);
  const [colors, setColors] = useState<NewColor[]>([{ key: 0, name: "Tan", hex: "#8B4513", stockQuantity: "0", imageUrl: "" }]);
  const [price, setPrice] = useState("");
  const [uploading, setUploading] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function update(key: number, field: keyof Omit<NewColor, "key">, value: string) {
    setColors((current) => current.map((color) => color.key === key ? { ...color, [field]: value } : color));
  }
  async function uploadImage(color: NewColor, file: File) {
    requestId.current ??= crypto.randomUUID();
    const fields = new FormData();
    fields.set("productId", requestId.current);
    fields.set("colorKey", String(color.key));
    fields.set("angle", "front");
    fields.set("file", file);
    setError("");
    setUploading(color.key);
    try {
      const result = await uploadProductImageAction(fields);
      if (result.ok) update(color.key, "imageUrl", result.data.url);
      else setError(result.error);
    } catch {
      setError("Could not upload the image. Try selecting the file again.");
    } finally {
      setUploading(null);
    }
  }
  const disabled = pending || uploading !== null;
  const numericPrice = Number(price);
  const preview = price !== "" && Number.isFinite(numericPrice) && numericPrice >= 0
    ? usdFormatter.format(numericPrice / exchangeRate)
    : "";
  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      if (disabled || categories.length === 0) return;
      const form = event.currentTarget;
      const fields = new FormData(form);
      requestId.current ??= crypto.randomUUID();
      const category = fields.get("category");
      const payload = { clientUuid: requestId.current, name: fields.get("name"),
        category: category === "shoe" ? "shoe" : "bag",
        categoryId: category === "bag" || category === "shoe" ? undefined : category,
        isWebsitePublished: fields.get("isWebsitePublished") === "on",
        basePrice: fields.get("price"), barcode: fields.get("barcode"), description: fields.get("description"),
        colors: colors.map(({ name, hex, stockQuantity, imageUrl }) => ({ name, hex, stockQuantity, imageUrl })) };
      setError("");
      startTransition(async () => {
        try {
          const result = await upsertProduct(payload);
          if (!result.ok) { setError(result.error); return; }
          requestId.current = null;
          router.push(`/manager/products/${result.data.id}`);
          router.refresh();
        } catch { setError("Could not confirm the product. Retry with the same details."); }
      });
    }} className="space-y-6">
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-semibold">Name<input name="name" required minLength={2} maxLength={200} className={inputClass} /></label>
        <label className="space-y-2 text-sm font-semibold">Category<select name="category" required className={inputClass}>
          {categories.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <label className="space-y-2 text-sm font-semibold">Price (KES)<input name="price" type="number" value={price} onChange={(event) => setPrice(event.target.value)} required min={0} step={1} max={100000000} className={inputClass} /></label>
        <label className="space-y-2 text-sm font-semibold">USD price preview
          <input readOnly value={preview} className={`${inputClass} bg-well`} />
        </label>
        <label className="space-y-2 text-sm font-semibold">Barcode<input name="barcode" maxLength={128} className={inputClass} /></label>
        <label className="space-y-2 text-sm font-semibold sm:col-span-2">Description<textarea name="description" maxLength={5000} className={`${inputClass} min-h-24 py-3`} /></label>
        <label className="flex items-center gap-3 text-sm font-semibold sm:col-span-2">
          <input type="checkbox" name="isWebsitePublished" className="size-4 accent-primary" />
          Publish on website
        </label>
      </fieldset>
      <ProductColorPicker selected={colors.map((color) => color.name)} disabled={disabled} onToggle={(option) => {
        const existing = colors.find((color) => color.name.toLowerCase() === option.name.toLowerCase());
        if (existing) {
          if (colors.length === 1) { setError("Keep at least one colour."); return; }
          setColors((current) => current.filter((color) => color.key !== existing.key));
        } else if (colors.length < 30) {
          const key = nextKey.current++;
          setColors((current) => [...current, { key, ...option, stockQuantity: "0", imageUrl: "" }]);
        }
      }} />
      <div className="space-y-4">
        {colors.map((color, index) => (
          <fieldset key={color.key} disabled={disabled} className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
            <legend className="px-2 font-semibold">Colour {index + 1}</legend>
            <label className="space-y-2 text-sm">Colour name<input required value={color.name} onChange={(event) => update(color.key, "name", event.target.value)} className={inputClass} /></label>
            <label className="space-y-2 text-sm">Colour swatch<input type="color" value={color.hex} onChange={(event) => update(color.key, "hex", event.target.value)} className={inputClass} /></label>
            <label className="space-y-2 text-sm">Initial stock<input type="number" min={0} max={100000} step={1} required value={color.stockQuantity} onChange={(event) => update(color.key, "stockQuantity", event.target.value)} className={inputClass} /></label>
            <label className="space-y-2 text-sm">Image URL<input value={color.imageUrl} placeholder="https://… or /image.png" onChange={(event) => update(color.key, "imageUrl", event.target.value)} className={inputClass} /></label>
            <label className="space-y-2 text-sm sm:col-span-2">Upload image
              <input type="file" accept="image/jpeg,image/png,image/webp,image/avif"
                className={`${inputClass} file:mr-3 file:border-0 file:bg-transparent file:font-semibold`}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void uploadImage(color, file);
                }} />
            </label>
            {uploading === color.key ? <p role="status" className="text-sm text-muted">Uploading image…</p> : null}
            {colors.length > 1 ? <button type="button" onClick={() => setColors((current) => current.filter((entry) => entry.key !== color.key))} className="text-left text-sm text-danger">Remove colour {index + 1}</button> : null}
          </fieldset>
        ))}
        <button type="button" disabled={disabled || colors.length >= 30} onClick={() => {
          const key = nextKey.current++;
          setColors((current) => [...current, { key, name: "", hex: "#000000", stockQuantity: "0", imageUrl: "" }]);
        }} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">Add colour</button>
      </div>
      {categories.length === 0 ? <p role="status" className="text-sm text-muted">No active categories are available.</p> : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <p className="text-sm text-muted">New products are available at the till. Publish on website controls storefront visibility. Initial stock is recorded in the inventory ledger.</p>
      <button type="submit" disabled={disabled || categories.length === 0} className={primaryButtonClass}>{pending ? "Creating…" : "Create product"}</button>
    </form>
  );
}
