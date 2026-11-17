import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw Error("Local Supabase required.");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

test("product images fill the square, switch with colour, and fall back on missing images", async ({ page }) => {
  const id = randomUUID();
  const colors = [randomUUID(), randomUUID(), randomUUID()];
  const name = `Image fixture ${id.slice(0, 8)}`;
  const product = await admin.from("products").insert({ id, name, slug: `image-${id}`, category: "bag", base_price: 100 });
  if (product.error) throw product.error;
  try {
    const variants = await admin.from("product_colors").insert(colors.map((colorId, index) => ({
      id: colorId, product_id: id, color_name: ["Tan", "Black", "Olive"][index],
      color_hex: ["#8b4513", "#000000", "#556b2f"][index], sort_order: index, stock_quantity: 1,
    })));
    if (variants.error) throw variants.error;
    const images = await admin.from("product_images").insert([
      { color_id: colors[0], angle: "front", image_url: "/pedigree-logo.png", sort_order: 0 },
      { color_id: colors[1], angle: "front", image_url: "/next.svg", sort_order: 0 },
      { color_id: colors[2], angle: "front", image_url: "/missing-image-fixture.png", sort_order: 0 },
    ]);
    if (images.error) throw images.error;
    expect((await page.request.post("/api/auth/login", { data: { pin: "1234" } })).ok()).toBe(true);
    await page.goto("/pos");
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
    const image = card.locator("img");
    await expect(image).toHaveAttribute("src", /\/pedigree-logo\.png$/);
    await expect(image).toHaveCSS("object-fit", "cover");
    await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0)).toBe(true);
    await card.getByRole("radio", { name: /^Black / }).locator("..").click();
    await expect(image).toHaveAttribute("src", /\/next\.svg$/);
    await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0)).toBe(true);
    await card.getByRole("radio", { name: /^Olive / }).locator("..").click();
    await expect(card.getByRole("img", { name: `${name} colour swatch: Olive`, exact: true })).toBeVisible();
    await card.getByRole("radio", { name: /^Tan / }).locator("..").click();
    await expect(image).toHaveAttribute("src", /\/pedigree-logo\.png$/);
  } finally {
    const hidden = await admin.from("products").update({ active: false }).eq("id", id);
    if (hidden.error) throw hidden.error;
  }
});
