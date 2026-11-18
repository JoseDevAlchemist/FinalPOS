import { z } from "zod";

import { PRODUCT_ANGLES, PRODUCT_CATEGORIES } from "@/lib/products/types";

export const productIdSchema = z.string().uuid("Choose a valid product.");

export const productAngleSchema = z.enum(PRODUCT_ANGLES);
export const productCategorySchema = z.enum(PRODUCT_CATEGORIES);

const imageUrlSchema = z
  .string()
  .trim()
  .min(1, "Add an image URL or upload a file.")
  .max(2048, "That image URL is too long.")
  .refine((value) => {
    if (/^\/(?![\/\\])/.test(value)) return true;
    if (!/^https?:\/\//.test(value)) return false;
    try {
      const url = new URL(value);
      return Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Use a full HTTP or HTTPS image URL, or keep an existing site path.");

export const productEditImageSchema = z.object({
  angle: productAngleSchema,
  imageUrl: imageUrlSchema,
});

const catalogImageList = z.array(productEditImageSchema).max(8).refine(
  (images) => new Set(images.map(({ angle }) => angle)).size === images.length,
  "Assign each photo to a different angle.",
);

const catalogColorSchema = z.object({
  name: z.string().trim().min(1, "Every colour needs a name.").max(80),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour."),
  images: catalogImageList,
});

function distinctColors(colors: { name: string }[]) {
  return new Set(colors.map(({ name }) => name.toLowerCase())).size === colors.length;
}

const productDetailsSchema = z.object({
  clientUuid: productIdSchema,
  name: z.string().trim().min(2, "Enter a product name.").max(200),
  description: z.string().trim().max(5000).default(""),
  category: productCategorySchema,
  categoryId: productIdSchema.optional(),
  basePrice: z.coerce.number().int("Use whole shillings.").min(0).max(100_000_000),
  basePriceUsd: z.number().int().min(1).max(1_000_000).nullable().optional(),
  discountPercent: z.coerce.number().int().min(0).max(100).default(0),
  barcode: z.string().trim().max(128).nullable().default(null),
  isWebsitePublished: z.boolean().default(false),
});

export const productEditSchema = productDetailsSchema.extend({
  productId: productIdSchema,
  active: z.boolean().optional(),
  colors: z.array(catalogColorSchema.extend({ id: productIdSchema.optional() }))
    .min(1).max(30).refine(distinctColors, "Colour names must be unique."),
});

export const productCreateSchema = productDetailsSchema.extend({
  colors: z.array(catalogColorSchema.extend({
    stockQuantity: z.coerce.number().int().min(0).max(100_000),
    images: catalogImageList.refine(
      (images) => images.every(({ imageUrl }) => !imageUrl.startsWith("/")),
      "Use full HTTP or HTTPS image URLs for new products.",
    ),
  })).min(1).max(30).refine(distinctColors, "Colour names must be unique."),
});

export const adjustStockSchema = z.object({
  productId: productIdSchema,
  colorId: z.string().uuid("Choose a valid colour."),
  delta: z.coerce
    .number()
    .int("Adjustments must be whole units.")
    .min(-100_000, "That adjustment is too large.")
    .max(100_000, "That adjustment is too large.")
    .refine((value) => value !== 0, "Enter an amount to add or remove."),
  reason: z
    .string()
    .trim()
    .max(200, "Reasons must be 200 characters or fewer.")
    .optional(),
});

export const barcodeLookupSchema = z
  .string()
  .trim()
  .min(1, "A barcode is required.")
  .max(128, "That barcode is too long.");

export const uploadImageFieldsSchema = z.object({
  productId: productIdSchema,
  colorKey: z.string().trim().min(1).max(100),
  angle: productAngleSchema,
});

export type ProductEditInput = z.infer<typeof productEditSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const stockAdjustmentRequestSchema = adjustStockSchema.extend({
  clientUuid: z.string().uuid(),
  reason: z.string().trim().min(1, "Describe the stock adjustment.").max(200),
});

export function validateProductDraft(input: unknown) {
  return typeof input === "object" && input !== null && "productId" in input
    ? productEditSchema.safeParse(input)
    : productCreateSchema.safeParse(input);
}

export function storefrontProductIssue(product: z.infer<typeof productDetailsSchema> & {
  colors: { name: string }[];
}): string | undefined {
  if (product.name.length > 80) return "Website product names can have up to 80 characters.";
  if (!product.description || product.description.length > 600) {
    return "Enter a description of 1–600 characters before publishing.";
  }
  if (product.basePrice > 10_000_000) return "Website prices must be KES 10,000,000 or less.";
  if (product.discountPercent > 99) return "Website discounts must be 99% or less.";
  if (product.colors.length > 8) return "The website supports up to eight colours per product.";
  if (product.colors.some(({ name }) => name.length > 40)) {
    return "Website colour names can have up to 40 characters.";
  }
}
