"use client";

import { PRODUCT_COLOR_OPTIONS } from "@/lib/products/colors";

export function ProductColorPicker({ selected, disabled, onToggle }: {
  selected: string[];
  disabled: boolean;
  onToggle: (color: { name: string; hex: string }) => void;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-semibold">Select colours</legend>
      <p className="text-xs text-muted">Select multiple colours below, or add a custom colour.</p>
      <div className="flex flex-wrap gap-2">
        {PRODUCT_COLOR_OPTIONS.map((color) => (
          <label key={color.name} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
            <input type="checkbox" checked={selected.some((name) => name.toLowerCase() === color.name.toLowerCase())}
              onChange={() => onToggle(color)} className="size-4 accent-primary" />
            <span aria-hidden="true" className="size-4 rounded-full border border-border" style={{ backgroundColor: color.hex }} />
            {color.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
