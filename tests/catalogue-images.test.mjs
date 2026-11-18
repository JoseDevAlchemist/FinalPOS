import { strict as assert } from "node:assert";
import test from "node:test";
import sharp from "sharp";

import { productImageFileError } from "../lib/products/image-files.ts";
import { verifyProductImage } from "../lib/products/image-validation.ts";

function photo() {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: "tan" } });
}

test("product uploads accept the original JPEG, PNG, WebP and AVIF bytes", async () => {
  for (const [format, mime, extension] of [
    ["jpeg", "image/jpeg", "jpg"],
    ["png", "image/png", "png"],
    ["webp", "image/webp", "webp"],
    ["avif", "image/avif", "avif"],
  ]) {
    const bytes = await photo().toFormat(format).toBuffer();
    assert.equal(await verifyProductImage(bytes, mime), extension);
  }
});

test("invalid, mislabeled and truncated files are refused", async () => {
  const webp = await photo().webp().toBuffer();
  assert.equal(await verifyProductImage(webp, "image/png"), null);
  assert.equal(await verifyProductImage(webp.subarray(0, webp.length - 8), "image/webp"), null);
  assert.equal(await verifyProductImage(Buffer.from("pretend image"), "image/webp"), null);
  assert.ok(productImageFileError(new File([], "empty.webp", { type: "image/webp" })));
  assert.ok(productImageFileError({ size: 4 * 1024 * 1024 + 1, type: "image/webp" }));
});
