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
  .refine(
    (value) => value.startsWith("/") || /^https?:\/\//i.test(value),
    "Image URLs must start with http://, https://, or /.",
  );

export const productEditImageSchema = z.object({
  angle: productAngleSchema,
  imageUrl: imageUrlSchema,
});

export const productEditColorSchema = z.object({
  id: z.string().uuid().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Every colour needs a name.")
    .max(80, "Colour names must be 80 characters or fewer."),
  hex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour such as #8B4513."),
  images: z.array(productEditImageSchema).max(8),
});

export const productEditSchema = z
  .object({
    productId: productIdSchema,
    name: z
      .string()
      .trim()
      .min(2, "A product name needs at least two characters.")
      .max(200, "Product names must be 200 characters or fewer."),
    description: z
      .string()
      .trim()
      .max(5000, "Descriptions must be 5,000 characters or fewer."),
    category: productCategorySchema,
    basePrice: z.coerce
      .number()
      .int("Price must be a whole number of shillings.")
      .min(0, "Price cannot be negative.")
      .max(100_000_000, "That price is too large."),
    discountPercent: z.coerce
      .number()
      .int("Discount must be a whole number.")
      .min(0, "Discount cannot be negative.")
      .max(100, "Discount cannot exceed 100%."),
    barcode: z
      .string()
      .trim()
      .max(128, "Barcodes must be 128 characters or fewer.")
      .optional()
      .nullable(),
    active: z.boolean(),
    isWebsitePublished: z.boolean(),
    colors: z
      .array(productEditColorSchema)
      .min(1, "A product needs at least one colour.")
      .max(30, "That is too many colours for one product."),
  })
  .superRefine((value, context) => {
    const names = new Set<string>();

    value.colors.forEach((color, colorIndex) => {
      const key = color.name.toLocaleLowerCase();
      if (names.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Two colours have the same name.",
          path: ["colors", colorIndex, "name"],
        });
      }
      names.add(key);

      const angles = new Set<string>();
      color.images.forEach((image, imageIndex) => {
        if (angles.has(image.angle)) {
          context.addIssue({
            code: "custom",
            message: "A colour can only have one image per angle.",
            path: ["colors", colorIndex, "images", imageIndex, "angle"],
          });
        }
        angles.add(image.angle);
      });
    });
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

export const productCreateSchema = z.object({
  clientUuid: z.string().uuid(),
  isWebsitePublished: z.boolean().default(false),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).default(""),
  category: productCategorySchema,
  categoryId: z.string().uuid().optional(),
  basePrice: z.coerce.number().int().min(0).max(100_000_000),
  barcode: z.string().trim().max(128).default(""),
  colors: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    stockQuantity: z.coerce.number().int().min(0).max(100_000),
    imageUrl: z.union([imageUrlSchema, z.literal("")]).refine((value) => !value.startsWith("//"), "Use a full HTTPS URL or a local path."),
  })).min(1).max(30),
}).superRefine((value, context) => {
  const names = value.colors.map((color) => color.name.toLowerCase());
  if (new Set(names).size !== names.length) context.addIssue({ code: "custom", message: "Colour names must be unique.", path: ["colors"] });
});

export const stockAdjustmentRequestSchema = adjustStockSchema.extend({
  clientUuid: z.string().uuid(),
  reason: z.string().trim().min(1, "Describe the stock adjustment.").max(200),
});

export const productUpsertSchema = z.union([productEditSchema, productCreateSchema]);
