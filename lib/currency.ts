const kesFormatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

export function formatKes(value: number): string {
  return kesFormatter.format(value);
}

export function priceAfterDiscount(
  basePrice: number,
  discountPercent: number,
): number {
  if (discountPercent <= 0) return basePrice;
  return Math.round(basePrice * (100 - discountPercent) / 100);
}
