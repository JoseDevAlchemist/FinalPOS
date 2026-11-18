import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import sharp from "sharp";

loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw Error("Local Supabase required.");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!publicKey) throw Error("Local publishable key required.");
const storefront = createClient(url, publicKey, { auth: { persistSession: false } });
async function login(page: Page, pin: string, path: string) {
  await page.goto("/login");
  for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 60_000 });
}

test("manager saves multiple local photos and colours, audits stock, and controls storefront visibility", async ({ page }, testInfo) => {
  const name = `Management tote ${randomUUID().slice(0, 8)}`;
  const barcode = `MGT-${name.split(" ").at(-1)}`;
  const { data: category } = await admin.from("categories").select("id").eq("slug", "handbags").eq("is_active", true).maybeSingle();
  const webp = await sharp({ create: { width: 32, height: 32, channels: 3, background: "tan" } }).webp().toBuffer();
  const file = (name: string, buffer = webp) => ({ name, mimeType: "image/webp", buffer });
  let productId: string | undefined;
  try {
    await login(page, "4826", "/manager");
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("manager-overview.png") });
    await page.getByRole("navigation", { name: "Manager navigation" }).getByRole("link", { name: "Products", exact: true }).click();
    await page.getByRole("link", { name: "Add product", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Description", { exact: true }).fill("Local catalogue test product.");
    await page.getByLabel("Price (KES)", { exact: true }).fill("3500");
    await page.getByLabel("Barcode", { exact: true }).fill(barcode);
    const tan = page.getByRole("group", { name: "Colour 1", exact: true });
    await tan.getByLabel("Initial stock", { exact: true }).fill("3");
    const rate = await admin.from("shop_settings").select("exchange_rate_kes_to_usd")
      .eq("key", "exchange_rate").single();
    expect(rate.error).toBeNull();
    const preview = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
      .format(3500 / z.number().positive().parse(rate.data?.exchange_rate_kes_to_usd));
    await expect(page.getByLabel("USD price preview")).toHaveValue(preview);
    if (category) await page.getByLabel("Category / subcategory").selectOption(category.id);
    await page.getByLabel("Discount (%)", { exact: true }).fill("10");

    await page.setViewportSize({ width: 390, height: 844 });
    await tan.getByLabel(/^Upload images/).setInputFiles([
      file("front.webp"), file("side.webp"), file("temporary.webp"),
    ]);
    const previews = tan.getByRole("img", { name: /preview/ });
    await expect(previews).toHaveCount(3);
    await expect(previews.first()).toHaveAttribute("src", /^blob:/);
    await expect.poll(() => previews.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(32);
    await tan.getByRole("button", { name: "Remove photo" }).last().click();
    await expect(previews).toHaveCount(2);
    await tan.getByLabel("Image angle").last().selectOption("top");
    await tan.getByLabel("Replace photo", { exact: true }).last().setInputFiles(file("bad.webp", Buffer.from("not an image")));

    await page.getByRole("group", { name: "Select colours", exact: true }).getByLabel("Black", { exact: true }).check();
    const black = page.getByRole("group", { name: "Colour 2", exact: true });
    await black.getByLabel("Initial stock", { exact: true }).fill("2");
    if (category) await page.getByLabel("Publish on website", { exact: true }).check();
    await page.getByRole("button", { name: "Create product", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("bad.webp");
    const incomplete = await admin.from("products").select("id").eq("name", name);
    expect(incomplete.error).toBeNull();
    expect(incomplete.data).toEqual([]);

    await tan.getByLabel("Replace photo", { exact: true }).last().setInputFiles(file("top.webp"));
    await page.screenshot({ path: testInfo.outputPath("add-product.png") });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: "Create product", exact: true }).click();
    await expect(page).toHaveURL(/\/manager\/products\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    productId = z.string().uuid().parse(new URL(page.url()).pathname.split("/").at(-1));
    const published = await admin.from("products").select("category,barcode,is_website_published").eq("id", productId).single();
    expect(published.error).toBeNull();
    expect(published.data).toEqual({ category: "bag", barcode, is_website_published: Boolean(category) });
    if (category) {
      const saved = await admin.from("products").select("category_id").eq("id", productId).single();
      expect(saved.data?.category_id).toBe(category.id);
    }
    const variants = await admin.from("product_colors")
      .select("id,color_name,product_images(angle,image_url,sort_order)").eq("product_id", productId);
    expect(variants.error).toBeNull();
    expect(variants.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ color_name: "Tan", product_images: expect.arrayContaining([
        { angle: "front", image_url: expect.stringMatching(/\/product-images\/.+\.webp$/), sort_order: 0 },
        { angle: "top", image_url: expect.stringMatching(/\/product-images\/.+\.webp$/), sort_order: 1 },
      ]) }),
      expect.objectContaining({ color_name: "Black", product_images: [] }),
    ]));
    const frontUrl = variants.data?.find(({ color_name }) => color_name === "Tan")
      ?.product_images.find(({ angle }) => angle === "front")?.image_url;
    expect(frontUrl).toBeTruthy();
    const photo = await page.request.get(z.string().url().parse(frontUrl));
    expect(photo.ok()).toBe(true);
    expect(photo.headers()["content-type"]).toContain("image/webp");
    expect(await photo.body()).toEqual(webp);
    const publicBag = await storefront.from("products").select("id").eq("id", productId);
    expect(publicBag.error).toBeNull();
    expect(publicBag.data).toEqual(category ? [{ id: productId }] : []);
    await page.goto("/manager/products");
    await page.getByLabel("Search products", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const row = page.locator("li").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(row.getByText(category ? "Published" : "Draft", { exact: true })).toBeVisible();
    for (const [delta, reason] of [["2", "Local delivery received"], ["-1", "Local damaged unit"]]) {
      await row.getByRole("button", { name: "Adjust stock", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Adjust stock", exact: true });
      await dialog.getByLabel(/^Change/).fill(delta);
      await dialog.getByLabel("Reason", { exact: true }).fill(reason);
      await dialog.getByRole("button", { name: "Save adjustment", exact: true }).click();
      await expect(dialog).not.toBeVisible();
    }
    await page.goto("/manager/inventory");
    const history = page.getByRole("row").filter({ hasText: name });
    await expect(history.getByText("Local delivery received", { exact: true })).toBeVisible();
    await expect(history.getByText("Local damaged unit", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("inventory-history.png") });
    const movements = await admin.from("stock_movements").select("delta,reason,reference_uuid,actor_staff_id").eq("product_id", productId);
    expect(movements.error).toBeNull();
    expect(movements.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ delta: 2, reason: "Local delivery received", reference_uuid: expect.any(String), actor_staff_id: "a1c9f1e2-0000-4000-8000-000000000002" }),
      expect.objectContaining({ delta: -1, reason: "Local damaged unit" }),
    ]));
    const adjustments = await admin.from("pos_stock_adjustments")
      .select("delta,reason,reference_uuid,actor_staff_id,quantity_before,quantity_after")
      .eq("product_id", productId);
    expect(adjustments.error).toBeNull();
    expect(adjustments.data).toHaveLength(4);
    expect(adjustments.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ delta: 2, quantity_before: 3, quantity_after: 5, reason: "Local delivery received" }),
      expect.objectContaining({ delta: -1, quantity_before: 5, quantity_after: 4, reason: "Local damaged unit" }),
    ]));
    await page.goto(`/manager/products/${productId}`);
    await page.getByLabel("Publish on website", { exact: true }).uncheck();
    await page.getByRole("button", { name: "Save product", exact: true }).click();
    await expect(page).toHaveURL(/\/manager\/products$/);
    await expect(page.locator("li").filter({ has: page.getByRole("heading", { name, exact: true }) }).getByText("Draft", { exact: true })).toBeVisible();
    const draft = await storefront.from("products").select("id").eq("id", productId);
    expect(draft.error).toBeNull();
    expect(draft.data).toEqual([]);
    expect((await admin.from("products").select("is_website_published").eq("id", productId).single()).data?.is_website_published).toBe(false);
    if (category) {
      await page.goto(`/manager/products/${productId}`);
      await page.getByLabel("Publish on website", { exact: true }).check();
      await page.getByRole("button", { name: "Save product", exact: true }).click();
      await expect(page).toHaveURL(/\/manager\/products$/);
      const republished = await storefront.from("products").select("id").eq("id", productId);
      expect(republished.error).toBeNull();
      expect(republished.data).toEqual([{ id: productId }]);
    }
    await page.goto("/pos");
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(card).toBeVisible();
    await expect(card.locator("img")).toHaveAttribute("src", /\.webp$/);
    await expect(card.locator("img")).toHaveCSS("object-fit", "cover");
    await expect(card).toContainText("Tan · 4 in stock");
    await card.getByRole("radio", { name: /^Black / }).locator("..").click();
    await expect(card).toContainText("Black · 2 in stock");
    await page.screenshot({ path: testInfo.outputPath("manager-product-in-pos.png") });
  } finally {
    const cleanup = admin.from("products").update({ active: false });
    if (productId) await cleanup.eq("id", productId);
    else await cleanup.eq("name", name);
  }
});

test("manager enrolls a cashier with Auth, duplicate PIN is refused, and cashier cannot access management", async ({ page }, testInfo) => {
  const name = `Cashier fixture ${randomUUID().slice(0, 8)}`;
  let staffId: string | undefined;
  try {
    await login(page, "4826", "/manager");
    await page.getByRole("navigation", { name: "Manager navigation" }).getByRole("link", { name: "Staff", exact: true }).click();
    await page.getByLabel("Cashier name", { exact: true }).fill(name);
    await page.getByLabel("New PIN", { exact: true }).fill("1234");
    await page.getByRole("button", { name: "Add cashier", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "already assigned" })).toBeVisible();
    await page.getByLabel("New PIN", { exact: true }).fill("9183");
    await page.getByRole("button", { name: "Add cashier", exact: true }).click();
    await expect(page.getByText("Cashier enrolled. They can now sign in with their PIN.", { exact: true })).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    const staff = await admin.from("pos_users").select("id,auth_user_id,role").eq("name", name).single();
    expect(staff.error).toBeNull();
    const linked = z.object({ id: z.string().uuid(), auth_user_id: z.string().uuid(), role: z.literal("cashier") }).parse(staff.data);
    staffId = linked.id;
    expect((await admin.auth.admin.getUserById(linked.auth_user_id)).data.user?.id).toBe(linked.id);
    await page.screenshot({ path: testInfo.outputPath("staff-roster.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("navigation", { name: "Manager navigation" }).getByRole("link", { name: "Staff", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("staff-mobile.png") });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await login(page, "9183", "/pos");
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.goto("/manager/staff");
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.getByRole("heading", { name: "Staff", exact: true })).not.toBeVisible();
  } finally {
    if (staffId) await admin.from("pos_users").update({ active: false }).eq("id", staffId);
  }
});

test("manager settings shows the configured exchange rate", async ({ page }) => {
  await login(page, "4826", "/manager");
  const settings = await admin.from("shop_settings").select("exchange_rate_kes_to_usd")
    .eq("key", "exchange_rate").single();
  expect(settings.error).toBeNull();
  await page.goto("/manager/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByLabel("Exchange Rate (1 USD = ? KES)", { exact: true }))
    .toHaveValue(String(settings.data?.exchange_rate_kes_to_usd));
});
