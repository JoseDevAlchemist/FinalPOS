"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requireManager } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { productImageFileError } from "@/lib/products/image-files";
import { verifyProductImage } from "@/lib/products/image-validation";
import {
  stockAdjustmentRequestSchema,
  validateProductDraft,
  uploadImageFieldsSchema,
} from "@/lib/validation/products";

export type ProductActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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
    return "Catalogue saving requires the approved catalogue RPC migration.";
  }

  if (code === "23505" || /barcode_taken|catalogue_conflict/i.test(message)) {
    return "That barcode or colour name is already in use.";
  }

  if (/idempotency_mismatch/i.test(message)) return "This request was already saved with different details. Refresh before starting a new change.";
  if (/color_has_stock|color_has_sales|color_has_adjustments|color_has_history/i.test(message)) return "Keep colours with stock, inventory history or historical sales. Adjust stock separately.";
  if (message.includes("catalogue_stock_projection_mismatch")) {
    return "The saved stock total differs from the colour quantities. Check the inventory projection before retrying.";
  }
  if (code === "23514") {
    return "One of those values is outside what the catalogue allows. Check the price, discount, colours and stock.";
  }

  if (message.includes("invalid_image_url")) return "Upload new photos to this catalogue’s product-images bucket or keep an existing photo.";
  if (message.includes("usd_override_unavailable")) return "USD overrides are unavailable in this catalogue.";
  if (message.includes("storefront_product_limits")) {
    return "Check the website limits for the name, description, price, discount and colours.";
  }
  if (message.includes("category_required")) return "Choose an active storefront category before publishing.";
  if (message.includes("category_not_found")) {
    return "That category is no longer available. Refresh and choose an active category.";
  }

  if (code === "P0002" || /not_found/i.test(message)) {
    return "That product or colour no longer exists. Refresh and try again.";
  }

  console.error("[products] catalogue action failed", error);
  return "Something went wrong saving that. The details are in the server log.";
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
  if (!(file instanceof File)) return { ok: false, error: "Choose an image to upload." };
  const issue = productImageFileError(file);
  if (issue) return { ok: false, error: issue };

  const bytes = Buffer.from(await file.arrayBuffer());
  const extension = await verifyProductImage(bytes, file.type);
  if (!extension) {
    return { ok: false, error: "The file is unreadable, too large to decode, or does not match its image format." };
  }

  try {
    const { productId, colorKey, angle } = fields.data;
    const digest = createHash("sha256").update(JSON.stringify([colorKey, angle])).update(bytes).digest("hex");
    const path = `${productId}/pos-${angle}-${digest}.${extension}`;
    const bucket = createAdminClient().storage.from("product-images");
    const { error } = await bucket.upload(path, bytes, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });

    // An interrupted response can leave the exact object in Storage already.
    if (error && !(await bucket.exists(path)).data) throw error;

    return { ok: true, data: { url: bucket.getPublicUrl(path).data.publicUrl } };
  } catch (error) {
    if (isRedirect(error)) throw error;
    console.error("[products] image upload failed", error);
    return { ok: false, error: "Storage could not confirm the upload. Retry saving to try this file again." };
  }
}

export async function upsertProduct(input: unknown): Promise<ProductActionResult<{ id: string }>> {
  await requireManager();
  const parsed = validateProductDraft(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the product details." };
  }

  const client = await createClient();
  const { clientUuid, ...product } = parsed.data;
  const { data, error, status } = await client.rpc("pos_manager_save_catalogue_product", {
    p_client_uuid: clientUuid,
    p_product: product,
  });
  if (error) {
    // Status 0/5xx or an HTTP request error can leave the commit outcome unknown.
    // Let the client retry the exact payload with its existing UUID.
    if (!status || status >= 500 || !error.code) throw new Error("Could not confirm the catalogue save.");
    return { ok: false, error: explain(error) };
  }
  if (typeof data !== "string") throw new Error("Could not confirm the catalogue save.");
  revalidatePath("/manager");
  revalidatePath("/manager/products");
  revalidatePath("/manager/products/[id]", "page");
  revalidatePath("/pos");
  revalidatePath("/manager/inventory");
  return { ok: true, data: { id: data } };
}
