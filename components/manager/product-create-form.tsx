"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertProduct } from "@/lib/products/actions";
import { ProductColorPicker } from "./product-color-picker";
import { inputClass, primaryButtonClass } from "./form-styles";

interface NewColor { key: number; name: string; hex: string; stockQuantity: string; imageUrl: string }
export function ProductCreateForm() {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const nextKey = useRef(1);
  const [colors, setColors] = useState<NewColor[]>([{ key: 0, name: "Tan", hex: "#8B4513", stockQuantity: "0", imageUrl: "" }]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function update(key: number, field: keyof Omit<NewColor, "key">, value: string) {
    setColors((current) => current.map((color) => color.key === key ? { ...color, [field]: value } : color));
  }
  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      requestId.current ??= crypto.randomUUID();
      const payload = { clientUuid: requestId.current, name: fields.get("name"), category: fields.get("category"),
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
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-semibold">Name<input name="name" required minLength={2} maxLength={200} className={inputClass} /></label>
        <label className="space-y-2 text-sm font-semibold">Category<select name="category" className={inputClass}><option value="bag">Bag</option><option value="shoe">Shoe</option></select></label>
        <label className="space-y-2 text-sm font-semibold">Price (KES)<input name="price" type="number" required min={0} step={1} max={100000000} className={inputClass} /></label>
        <label className="space-y-2 text-sm font-semibold">Barcode<input name="barcode" maxLength={128} className={inputClass} /></label>
        <label className="space-y-2 text-sm font-semibold sm:col-span-2">Description<textarea name="description" maxLength={5000} className={`${inputClass} min-h-24 py-3`} /></label>
        <label className="flex items-center gap-3 text-sm font-semibold sm:col-span-2">
          <input type="checkbox" name="isWebsitePublished" className="size-4 accent-primary" />
          Publish on website
        </label>
      </fieldset>
      <ProductColorPicker selected={colors.map((color) => color.name)} disabled={pending} onToggle={(option) => {
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
          <fieldset key={color.key} disabled={pending} className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
            <legend className="px-2 font-semibold">Colour {index + 1}</legend>
            <label className="space-y-2 text-sm">Colour name<input required value={color.name} onChange={(event) => update(color.key, "name", event.target.value)} className={inputClass} /></label>
            <label className="space-y-2 text-sm">Colour swatch<input type="color" value={color.hex} onChange={(event) => update(color.key, "hex", event.target.value)} className={inputClass} /></label>
            <label className="space-y-2 text-sm">Initial stock<input type="number" min={0} max={100000} step={1} required value={color.stockQuantity} onChange={(event) => update(color.key, "stockQuantity", event.target.value)} className={inputClass} /></label>
            <label className="space-y-2 text-sm">Image URL<input value={color.imageUrl} placeholder="https://… or /image.png" onChange={(event) => update(color.key, "imageUrl", event.target.value)} className={inputClass} /></label>
            {colors.length > 1 ? <button type="button" onClick={() => setColors((current) => current.filter((entry) => entry.key !== color.key))} className="text-left text-sm text-danger">Remove colour {index + 1}</button> : null}
          </fieldset>
        ))}
        <button type="button" disabled={pending || colors.length >= 30} onClick={() => {
          const key = nextKey.current++;
          setColors((current) => [...current, { key, name: "", hex: "#000000", stockQuantity: "0", imageUrl: "" }]);
        }} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">Add colour</button>
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <p className="text-sm text-muted">New products are available at the till. Publish on website controls storefront visibility. Initial stock is recorded in the inventory ledger.</p>
      <button type="submit" disabled={pending} className={primaryButtonClass}>{pending ? "Creating…" : "Create product"}</button>
    </form>
  );
}
