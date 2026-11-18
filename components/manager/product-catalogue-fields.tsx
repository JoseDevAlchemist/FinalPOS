"use client";

import { inputClass } from "./form-styles";
import { categoryBranch, type ProductCategoryOption } from "@/lib/products/types";

export function ProductCategoryField({ categories, value, onChange, required = true }: {
  categories: ProductCategoryOption[] | null;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-2 text-sm font-semibold">
      Category / subcategory
      <select name="category" value={value} onChange={(event) => onChange(event.target.value)} className={inputClass} required={required}>
        {categories ? (
          <>
            <option value="">Choose a category</option>
            {categories.map(({ id }) => (
              <option key={id} value={id}>{categoryBranch(categories, id).map(({ name }) => name).join(" / ")}</option>
            ))}
          </>
        ) : (
          <>
            <option value="bag">Bags</option>
            <option value="shoe">Shoes</option>
          </>
        )}
      </select>
    </label>
  );
}

const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function ProductUsdFields({ price, exchangeRate, supportsOverride, initialOverride }: {
  price: string;
  exchangeRate: number;
  supportsOverride: boolean;
  initialOverride?: number | null;
}) {
  const amount = Number(price);
  const preview = price.trim() && Number.isFinite(amount) && amount >= 0
    ? usdFormatter.format(amount / exchangeRate) : "";
  return (
    <>
      <label className="grid gap-2 text-sm font-semibold">USD price preview
        <input readOnly value={preview} className={`${inputClass} bg-well`} />
      </label>
      {supportsOverride ? (
        <label className="grid gap-2 text-sm font-semibold">USD price override
          <input name="basePriceUsd" type="number" min={1} max={1000000} step={1} defaultValue={initialOverride ?? ""} className={inputClass} />
        </label>
      ) : null}
    </>
  );
}

export function readUsdOverride(fields: FormData): number | null | undefined {
  const override = fields.get("basePriceUsd");
  return override === null ? undefined : override === "" ? null : Number(override);
}
