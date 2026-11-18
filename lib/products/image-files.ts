export const PRODUCT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
export const PRODUCT_IMAGE_ACCEPT = PRODUCT_IMAGE_TYPES.join(",");

export function productImageFileError(file: Pick<File, "size" | "type">): string | null {
  if (!file.size) return "Choose an image file that is not empty.";
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) return "Images must be 4 MB or smaller.";
  if (!PRODUCT_IMAGE_TYPES.includes(file.type)) return "Choose a JPEG, PNG, WebP or AVIF image.";
  return null;
}
