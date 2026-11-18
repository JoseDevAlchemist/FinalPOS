import "server-only";

import { z } from "zod";

import {
  PRODUCT_ANGLES,
  PRODUCT_CATEGORIES,
  type CatalogueColor,
  type CatalogueImage,
  type CatalogueProduct,
} from "@/lib/products/types";
import { createClient } from "@/lib/supabase/server";
import { barcodeLookupSchema, productIdSchema } from "@/lib/validation/products";

const COLOR_SELECT = `  product_colors (
    id,
    color_name,
    color_hex,
    sort_order,
    stock_quantity,
    product_images (
      id,
      angle,
      image_url,
      sort_order
    )
  )
`;

const PRODUCT_SELECT = `
  id,
  name,
  slug,
  description,
  category,
  base_price,
  discount_percent,
  barcode,
  active,
  is_website_published,
  created_at,
  ${COLOR_SELECT}
`;

const imageRowSchema = z.object({
  id: z.string().uuid(),
  angle: z.enum(PRODUCT_ANGLES),
  image_url: z.string().nullable(),
  sort_order: z.number().int(),
});

const colorRowSchema = z.object({
  id: z.string().uuid(),
  color_name: z.string(),
  color_hex: z.string(),
  sort_order: z.number().int(),
  stock_quantity: z.number().int().nonnegative(),
  product_images: z
    .array(imageRowSchema)
    .nullish()
    .transform((value) => value ?? []),
});

const productRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  category: z.enum(PRODUCT_CATEGORIES),
  category_id: z.string().uuid().nullish(),
  base_price_usd: z.number().int().positive().nullish(),
  base_price: z.number().int().nonnegative(),
  discount_percent: z.number().int().min(0).max(100),
  barcode: z.string().nullish().transform((value) => value ?? null),
  active: z.boolean(),
  is_website_published: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  created_at: z.string(),
  product_colors: z
    .array(colorRowSchema)
    .nullish()
    .transform((value) => value ?? []),
});

type ProductRow = z.infer<typeof productRowSchema>;

function mapImage(row: z.infer<typeof imageRowSchema>): CatalogueImage {
  return {
    id: row.id,
    angle: row.angle,
    imageUrl: row.image_url,
    sortOrder: row.sort_order,
  };
}

function mapColor(row: z.infer<typeof colorRowSchema>): CatalogueColor {
  return {
    id: row.id,
    name: row.color_name,
    hex: row.color_hex,
    sortOrder: row.sort_order,
    stockQuantity: row.stock_quantity,
    images: row.product_images
      .map(mapImage)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

function mapProduct(row: ProductRow): CatalogueProduct {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    category: row.category,
    categoryId: row.category_id,
    basePriceUsd: row.base_price_usd,
    basePrice: row.base_price,
    discountPercent: row.discount_percent,
    barcode: row.barcode,
    active: row.active,
    isWebsitePublished: row.is_website_published,
    createdAt: row.created_at,
    colors: row.product_colors
      .map(mapColor)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

function parseProduct(data: unknown): CatalogueProduct {
  const parsed = productRowSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[products] Catalogue row did not match the expected shape", {
      issues: parsed.error.issues,
    });
    throw new Error("The catalogue returned an unexpected product shape.");
  }
  return mapProduct(parsed.data);
}

function searchTerm(value: string): string {
  return value.replace(/[%_,()]/g, "").trim();
}

export async function listProducts(query?: string): Promise<CatalogueProduct[]> {
  const supabase = await createClient();
  let request = supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .order("created_at", { ascending: false });

  const term = searchTerm(query ?? "");
  if (term.length > 0) {
    const pattern = `%${term}%`;
    request = request.or(`name.ilike.${pattern},barcode.ilike.${pattern}`);
  }

  const { data, error } = await request;
  if (error) {
    console.error("[products] list failed", error);
    throw new Error("Could not load the catalogue.");
  }

  return (data ?? []).map(parseProduct);
}

export async function listActiveProducts(): Promise<CatalogueProduct[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("[products] active list failed", error);
    throw new Error("Could not load the till catalogue.");
  }

  return (data ?? []).map(parseProduct);
}

export async function getProduct(id: string): Promise<CatalogueProduct | null> {
  const productId = productIdSchema.parse(id);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(`*, ${COLOR_SELECT}`)
    .eq("id", productId)
    .maybeSingle();

  if (error) {
    console.error("[products] detail failed", error);
    throw new Error("Could not load that product.");
  }

  return data ? parseProduct(data) : null;
}

export async function getProductByBarcode(
  code: string,
): Promise<CatalogueProduct | null> {
  const barcode = barcodeLookupSchema.parse(code);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("barcode", barcode)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("[products] barcode lookup failed", error);
    throw new Error("Could not look up that barcode.");
  }

  return data ? parseProduct(data) : null;
}

const categoryOptionsSchema = z.array(z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  parent_id: z.string().uuid().nullable(),
}));

export async function listProductCategories() {
  const client = await createClient();
  const { data, error } = await client.from("categories")
    .select("id, name, slug, parent_id")
    .eq("is_active", true).order("display_order").order("name").order("id");

  if (error?.code === "42P01" || error?.code === "PGRST205") return null;
  if (error) throw new Error("Could not load product categories.");
  const categories = categoryOptionsSchema.parse(data)
    .map(({ parent_id, ...category }) => ({ ...category, parentId: parent_id }));
  // Hide descendants of inactive categories and malformed branches.
  const visible = new Set(categories.filter((category) => !category.parentId).map(({ id }) => id));
  let previousSize = 0;
  while (previousSize < visible.size) {
    previousSize = visible.size;
    for (const category of categories) {
      if (category.parentId && visible.has(category.parentId)) visible.add(category.id);
    }
  }
  return categories.filter(({ id }) => visible.has(id));
}

export async function supportsUsdPriceOverride(): Promise<boolean> {
  const client = await createClient();
  const { error } = await client.from("products").select("base_price_usd").limit(0);
  if (error?.code === "42703") return false;
  if (error) throw new Error("Could not check catalogue price options.");
  return true;
}
