export const PRODUCT_CATEGORIES = ["bag", "shoe"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const PRODUCT_ANGLES = [
  "front",
  "side-left",
  "side-right",
  "side",
  "top",
  "bottom",
  "back",
  "laces",
] as const;
export type ProductAngle = (typeof PRODUCT_ANGLES)[number];

export const ANGLE_LABELS: Record<ProductAngle, string> = {
  front: "Front",
  "side-left": "Side L",
  "side-right": "Side R",
  side: "Side",
  top: "Top",
  bottom: "Bottom",
  back: "Back",
  laces: "Laces",
};

export interface CatalogueImage {
  id: string;
  angle: ProductAngle;
  imageUrl: string | null;
  sortOrder: number;
}

export interface CatalogueColor {
  id: string;
  name: string;
  hex: string;
  sortOrder: number;
  stockQuantity: number;
  images: CatalogueImage[];
}

export interface CatalogueProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: ProductCategory;
  categoryId?: string | null;
  basePriceUsd?: number | null;
  basePrice: number;
  discountPercent: number;
  barcode: string | null;
  active: boolean;
  isWebsitePublished: boolean;
  createdAt: string;
  colors: CatalogueColor[];
}

export function productTotalStock(product: CatalogueProduct): number {
  return product.colors.reduce((total, color) => total + color.stockQuantity, 0);
}

export function productPrimaryImage(product: CatalogueProduct): string | null {
  for (const color of product.colors) {
    const image = color.images.find((entry) => entry.imageUrl);
    if (image?.imageUrl) return image.imageUrl;
  }
  return null;
}

export function productPrimaryColor(product: CatalogueProduct): CatalogueColor | null {
  return product.colors[0] ?? null;
}

export function categoryLabel(category: ProductCategory): string {
  return category === "bag" ? "Bags" : "Shoes";
}

export function colorPrimaryImage(color: CatalogueColor | null): string | null {
  return color?.images.find((image) => image.angle === "front" && image.imageUrl)?.imageUrl
    ?? color?.images.find((image) => image.imageUrl)?.imageUrl
    ?? null;
}

export interface ProductCategoryOption {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

export function categoryBranch(
  categories: ProductCategoryOption[],
  id: string,
): ProductCategoryOption[] {
  const branch: ProductCategoryOption[] = [];
  let entry = categories.find((category) => category.id === id);
  while (entry && !branch.some((category) => category.id === entry?.id)) {
    branch.unshift(entry);
    const parentId = entry.parentId;
    entry = categories.find((category) => category.id === parentId);
  }
  return branch;
}

export function preferredProductAngles(category: ProductCategory): ProductAngle[] {
  const preferred: ProductAngle[] = category === "shoe"
    ? ["front", "laces", "side", "back", "bottom"]
    : ["front", "side-left", "side-right", "top", "back"];
  return [...preferred, ...PRODUCT_ANGLES.filter((angle) => !preferred.includes(angle))];
}

export function catalogueCategory(categories: ProductCategoryOption[] | null, selection: string, fallback: ProductCategory): ProductCategory {
  if (!categories) return selection === "shoe" ? "shoe" : "bag";
  const root = categoryBranch(categories, selection)[0];
  if (!root) return fallback;
  return /shoe|sneaker|boot|sandal|loafer|heel/i.test(`${root.slug} ${root.name}`) ? "shoe" : "bag";
}
