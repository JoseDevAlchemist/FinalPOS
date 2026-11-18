"use server";

import { revalidatePath } from "next/cache";

import { requireManager } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  stockAdjustmentRequestSchema,
  productCreateSchema,
  productEditSchema,
  productUpsertSchema,
  uploadImageFieldsSchema,
} from "@/lib/validation/products";

export type ProductActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

function isRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

function explain(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message =
    (error as { message?: string } | null)?.message ??
    (error instanceof Error ? error.message : String(error));

  if (code === "42501" || /not_authorized|row-level security/i.test(message)) {
    return "Only an active manager can change the catalogue.";
  }

  if (code === "PGRST202" || /function .* does not exist|schema cache/i.test(message)) {
    return "The catalogue function is missing. Apply the latest Supabase migration.";
  }

  if (code === "23505" || /barcode_taken|catalogue_conflict/i.test(message)) {
    return "That barcode or colour name is already in use.";
  }

  if (/idempotency_mismatch/i.test(message)) return "This request was already saved with different details. Refresh before starting a new change.";
  if (/color_has_stock|color_has_sales|color_has_adjustments/i.test(message)) return "Keep colours with stock, inventory history or historical sales. Adjust stock separately.";
  if (code === "23514") {
    return "One of those values is outside what the catalogue allows. Check the price, discount, colours and stock.";
  }

  if (message.includes("category_not_found")) {
    return "That category is no longer available. Refresh and choose an active category.";
  }

  if (code === "P0002" || /not_found/i.test(message)) {
    return "That product or colour no longer exists. Refresh and try again.";
  }

  console.error("[products] catalogue action failed", error);
  return "Something went wrong saving that. The details are in the server log.";
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "colour"
  );
}

export async function updateProductAction(
  input: unknown,
): Promise<ProductActionResult<{ id: string }>> {
  await requireManager();

  const parsed = productEditSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the product details.",
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("pos_manager_update_product", {
      p_product_id: parsed.data.productId,
      p_name: parsed.data.name,
      p_description: parsed.data.description,
      p_category: parsed.data.category,
      p_base_price: parsed.data.basePrice,
      p_discount_percent: parsed.data.discountPercent,
      p_barcode: parsed.data.barcode || null,
      p_active: parsed.data.active,
      p_is_website_published: parsed.data.isWebsitePublished,
      p_colors: parsed.data.colors.map((color) => ({
        id: color.id,
        name: color.name,
        hex: color.hex,
        images: color.images.map((image) => ({
          angle: image.angle,
          image_url: image.imageUrl,
        })),
      })),
    });

    if (error) throw error;

    revalidatePath("/manager");
    revalidatePath("/manager/products");
    revalidatePath("/manager/products/[id]", "page");
    revalidatePath("/pos");
    revalidatePath("/manager/inventory");

    return { ok: true, data: { id: String(data) } };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { ok: false, error: explain(error) };
  }
}

export async function adjustStock(
  input: unknown,
): Promise<ProductActionResult<{ stockQuantity: number }>> {
  await requireManager();

  const parsed = stockAdjustmentRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the stock adjustment.",
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "pos_manager_adjust_stock",
      {
        p_client_uuid: parsed.data.clientUuid,
        p_product_id: parsed.data.productId,
        p_color_id: parsed.data.colorId,
        p_delta: parsed.data.delta,
        p_reason: parsed.data.reason || "quick_restock",
      },
    );

    if (error) throw error;

    revalidatePath("/manager");
    revalidatePath("/manager/products");
    revalidatePath("/manager/products/[id]", "page");
    revalidatePath("/pos");
    revalidatePath("/manager/inventory");

    return { ok: true, data: { stockQuantity: Number(data) } };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { ok: false, error: explain(error) };
  }
}

export async function uploadProductImageAction(
  formData: FormData,
): Promise<ProductActionResult<{ url: string }>> {
  await requireManager();

  const fields = uploadImageFieldsSchema.safeParse({
    productId: formData.get("productId"),
    colorKey: formData.get("colorKey"),
    angle: formData.get("angle"),
  });

  if (!fields.success) {
    return { ok: false, error: "That upload was missing its product or colour." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image to upload." };
  }

  const extension = ALLOWED_IMAGE_TYPES[file.type];
  if (!extension) {
    return { ok: false, error: "Upload a JPEG, PNG, WebP or AVIF image." };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Images must be smaller than 4MB." };
  }

  try {
    const admin = createAdminClient();
    const path = `${fields.data.productId}/${slugify(fields.data.colorKey)}-${fields.data.angle}-${crypto.randomUUID()}.${extension}`;

    const { error } = await admin.storage
      .from("product-images")
      .upload(path, file, {
        contentType: file.type,
        cacheControl: "31536000",
        upsert: false,
      });

    if (error) throw error;

    const { data } = admin.storage.from("product-images").getPublicUrl(path);
    return { ok: true, data: { url: data.publicUrl } };
  } catch (error) {
    if (isRedirect(error)) throw error;
    console.error("[products] image upload failed", error);
    return {
      ok: false,
      error:
        "That image could not be uploaded. Check that local storage is running and the product-images bucket exists.",
    };
  }
}

export async function createProductAction(input: unknown): Promise<ProductActionResult<{ id: string }>> {
  await requireManager();
  const parsed = productCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the product details." };
  const { clientUuid, ...product } = parsed.data;
  const client = await createClient();
  const { data, error } = await client.rpc("pos_manager_create_product", { p_client_uuid: clientUuid, p_product: product });
  if (error) return { ok: false, error: explain(error) };
  if (typeof data !== "string") return { ok: false, error: "Could not confirm the product. Retry with the same details." };
  revalidatePath("/manager");
  revalidatePath("/manager/products");
  revalidatePath("/pos");
  return { ok: true, data: { id: data } };
}


export async function upsertProduct(
  input: unknown,
): Promise<ProductActionResult<{ id: string }>> {
  await requireManager();
  const parsed = productUpsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the product details." };
  }
  // Both branches use manager-authorized transactional RPCs on shared products,
  // preserving colour identities and the inventory ledger when editing.
  return "productId" in parsed.data
    ? updateProductAction(parsed.data)
    : createProductAction(parsed.data);
}
