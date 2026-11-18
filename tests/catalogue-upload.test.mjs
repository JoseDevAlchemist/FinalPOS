import { strict as assert } from "node:assert";
import { registerHooks } from "node:module";
import test from "node:test";
import sharp from "sharp";

import "./digital/alias-loader.mjs";

const imports = new Map([
  ["next/cache", "export const revalidatePath = () => {}"],
  ["@/lib/auth/session", "export const requireManager = () => globalThis.catalogueDoubles.authorize()"],
  ["@/lib/supabase/admin", "export const createAdminClient = () => globalThis.catalogueDoubles.admin"],
  ["@/lib/supabase/server", "export const createClient = () => globalThis.catalogueDoubles.client"],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (imports.has(specifier)) {
      return { url: `data:text/javascript,${encodeURIComponent(imports.get(specifier))}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { uploadProductImageAction, upsertProduct } = await import("../lib/products/actions.ts");

const id = "cc900000-0000-4000-8000-000000000005";
const photo = await sharp({ create: { width: 16, height: 16, channels: 3, background: "tan" } }).webp().toBuffer();

function form(bytes, angle) {
  const upload = new FormData();
  upload.set("productId", id);
  upload.set("colorKey", "1");
  upload.set("angle", angle);
  upload.set("file", new File([bytes], "device photo.webp", { type: "image/webp" }));
  return upload;
}

test("manager uploads unchanged WebP bytes to distinct angle paths and retries an existing object safely", async (context) => {
  const stored = new Map();
  const auth = context.mock.fn(async () => {});
  const bucket = {
    async upload(path, bytes, options) {
      assert.deepEqual(bytes, photo);
      assert.equal(options.contentType, "image/webp");
      assert.equal(options.upsert, false);
      if (stored.has(path)) return { error: new Error("Object already exists") };
      stored.set(path, bytes);
      return { error: null };
    },
    async exists(path) { return { data: stored.has(path) }; },
    getPublicUrl(path) {
      return { data: { publicUrl: `https://example.com/storage/v1/object/public/product-images/${path}` } };
    },
  };
  globalThis.catalogueDoubles = {
    authorize: auth,
    admin: { storage: { from(name) { assert.equal(name, "product-images"); return bucket; } } },
  };

  const front = await uploadProductImageAction(form(photo, "front"));
  const top = await uploadProductImageAction(form(photo, "top"));
  assert.equal(front.ok && top.ok, true);
  assert.match(front.data.url, /\/product-images\/[^/]+\/pos-front-[a-f0-9]+\.webp$/);
  assert.notEqual(front.data.url, top.data.url);
  assert.deepEqual(await uploadProductImageAction(form(photo, "front")), front);
  assert.equal(stored.size, 2);
  assert.equal(auth.mock.callCount(), 3);

  const invalid = await uploadProductImageAction(form(Buffer.from("not a photo"), "back"));
  assert.equal(invalid.ok, false);
  assert.equal(stored.size, 2);
});

test("a storage failure with no stored object returns a retryable error", async (context) => {
  context.mock.method(console, "error", () => {});
  globalThis.catalogueDoubles = {
    authorize: async () => {},
    admin: { storage: { from: () => ({
      upload: async () => ({ error: new Error("storage unavailable") }),
      exists: async () => ({ data: false }),
    }) } },
  };
  const failed = await uploadProductImageAction(form(photo, "front"));
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Retry/);
});

test("catalogue save sends ordered URLs and one request ID to the manager RPC", async (context) => {
  const saved = context.mock.fn(async () => ({ data: id, error: null, status: 200 }));
  globalThis.catalogueDoubles = {
    authorize: async () => {},
    client: { rpc: saved },
  };
  const input = {
    clientUuid: id, name: "Test bag", category: "bag", basePrice: 5000,
    isWebsitePublished: false, discountPercent: 5,
    colors: [{
      name: "Tan", hex: "#8b4513", stockQuantity: 3,
      images: [
        { angle: "front", imageUrl: "https://example.com/product-images/front.webp" },
        { angle: "top", imageUrl: "https://example.com/product-images/top.webp" },
      ],
    }],
  };
  assert.equal((await upsertProduct(input)).ok, true);
  assert.equal((await upsertProduct(input)).ok, true);
  const [name, payload] = saved.mock.calls[0].arguments;
  assert.equal(name, "pos_manager_save_catalogue_product");
  assert.equal(payload.p_client_uuid, id);
  assert.equal(payload.p_product.isWebsitePublished, false);
  assert.deepEqual(payload.p_product.colors[0].images, input.colors[0].images);
  assert.deepEqual(saved.mock.calls[1].arguments, saved.mock.calls[0].arguments);

  input.colors[0].images[1].imageUrl = "blob:preview";
  assert.equal((await upsertProduct(input)).ok, false);
  assert.equal(saved.mock.callCount(), 2);
});
