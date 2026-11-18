import sharp from "sharp";

const imageFormats = {
  "image/jpeg": { format: "jpeg", extension: "jpg" },
  "image/png": { format: "png", extension: "png" },
  "image/webp": { format: "webp", extension: "webp" },
  "image/avif": { format: "heif", extension: "avif" },
};

export async function verifyProductImage(bytes: Buffer, type: string): Promise<string | null> {
  const expected = Object.entries(imageFormats).find(([mime]) => mime === type)?.[1];
  if (!expected) return null;

  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: 32_000_000, animated: true });
    const { format, compression, width, height, pages = 1, pageHeight } = await image.metadata();
    if (format !== expected.format || (format === "heif" && compression !== "av1")
      || !width || !height || width * (pageHeight ?? height) * pages > 32_000_000) {
      return null;
    }
    // Decode the original bytes to reject truncated/malformed image payloads.
    await image.stats();
    return expected.extension;
  } catch {
    return null;
  }
}
