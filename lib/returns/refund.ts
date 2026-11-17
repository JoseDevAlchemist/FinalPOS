import type { ReturnSale } from "@/lib/validation/returns";

// SQL supplies the historical line budget. BigInt keeps integer previews exact;
// the database independently recomputes the authorized refund on commit.
export function refundForQuantity(item: ReturnSale["items"][number], quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > item.quantity - item.returned_quantity) return 0;
  const budget = BigInt(item.refund_budget);
  const sold = BigInt(item.quantity);
  const returned = BigInt(item.returned_quantity);
  return Number(budget * (returned + BigInt(quantity)) / sold - budget * returned / sold);
}
