import { priceAfterDiscount } from "@/lib/currency";
import type { CatalogueProduct } from "@/lib/products/types";

export interface CartLine {
  productId: string;
  colorId: string;
  quantity: number;
}

export function selectedProductColor(product: CatalogueProduct, colorId?: string) {
  if (colorId) return product.colors.find((color) => color.id === colorId) ?? null;
  return product.colors.find((color) => color.stockQuantity > 0) ?? product.colors[0] ?? null;
}

export function buildCartItems(
  cart: readonly CartLine[],
  products: ReadonlyMap<string, CatalogueProduct>,
) {
  return cart.map((line) => {
    const product = products.get(line.productId);
    const color = product?.colors.find((entry) => entry.id === line.colorId);
    if (!product || !color) throw new Error("A cart product or colour is no longer available.");
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > color.stockQuantity) {
      throw new Error(`${product.name} (${color.name}) does not have enough stock.`);
    }
    return {
      product_id: product.id,
      color_id: color.id,
      quantity: line.quantity,
      price_at_sale: priceAfterDiscount(product.basePrice, product.discountPercent),
    };
  });
}
