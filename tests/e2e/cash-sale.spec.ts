import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { priceAfterDiscount } from "../../lib/currency";

loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !serviceKey || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("Cash-sale tests require a local Supabase URL and local credentials.");
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const staffId = "a1c9f1e2-0000-4000-8000-000000000001";
const productId = "c0a80101-0000-4000-8000-000000000001";
const colorId = "c0a80201-0000-4000-8000-000000000001";
const stockSchema = z.object({ stock_quantity: z.number().int() });

async function stock() {
  const { data, error } = await admin.from("products").select("stock_quantity").eq("id", productId).single();
  if (error) throw error;
  return stockSchema.parse(data).stock_quantity;
}

async function staffClient(email = "brian-otieno@pedigree.local") {
  const client = createClient(url ?? "", key ?? "", { auth: { persistSession: false } });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const { error: verifyError } = await client.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (verifyError) throw verifyError;
  return client;
}

async function hideConcurrencyFixtures() {
  const result = await admin.from("products").update({ active: false })
    .eq("name", "Concurrency fixture").like("slug", "test-%");
  if (result.error) throw result.error;
}

test.afterAll(hideConcurrencyFixtures);

test.beforeAll(async () => {
  await hideConcurrencyFixtures();
  const manager = await staffClient("grace-wanjiru@pedigree.local");
  for (const id of [colorId, "c0a80201-0000-4000-8000-000000000002"]) {
    const color = await admin.from("product_colors").select("stock_quantity").eq("id", id).single();
    if (color.error) throw color.error;
    const quantity = stockSchema.parse(color.data).stock_quantity;
    if (quantity < 4) {
      const restock = await manager.rpc("pos_manager_adjust_color_stock", {
        p_product_id: productId, p_color_id: id, p_delta: 4 - quantity,
        p_reason: "local_cash_sale_test_setup",
      });
      if (restock.error) throw restock.error;
    }
  }
});

test("scan → cash action → persisted sale and stock → 80mm receipt", async ({ page }, testInfo) => {
  const before = await stock();
  const started = new Date().toISOString();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  for (const digit of ["1", "2", "3", "4"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await expect(page).toHaveURL(/\/pos$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "New sale" })).toBeVisible();
  await page.getByRole("button", { name: "Shoes", exact: true }).click();
  await expect(page.locator("article").filter({ hasText: "Karura Tote" })).toHaveCount(0);
  await page.getByRole("button", { name: "All products", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search products or type a barcode" });
  await search.fill("Karura");
  await search.press("Enter");
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.locator("aside li")).toHaveCount(0);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.locator("aside li")).toHaveCount(0);
  await search.fill("PED-KARURA-001");
  await search.press("Enter");
  await expect(page.locator("aside li")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove Karura Tote — Tan", exact: true }).click();
  await search.fill("Karura Tote");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.locator("aside li")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove Karura Tote — Tan", exact: true }).click();
  await page.getByRole("heading", { name: "New sale", exact: true }).click();
  await page.keyboard.type("UNKNOWN-BARCODE", { delay: 10 });
  await page.keyboard.press("Enter");
  await expect(page.getByText("Barcode not found", { exact: true })).toBeVisible();
  await page.keyboard.type("PED-KARURA-001", { delay: 10 });
  await page.keyboard.press("Enter");
  await expect(page.locator("aside").getByText("Karura Tote", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Charge/ }).click();
  const checkout = page.getByRole("dialog", { name: "Checkout" });
  await checkout.getByLabel("Cash tendered").fill("13000");
  await expect(checkout.getByText(/Change:/)).toContainText("500");
  // Lose the first action response after the server commits, then retry from
  // the same checkout. The browser must reuse its UUID and recover the receipt.
  await page.route("**/pos", async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      await route.fetch();
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  await checkout.getByRole("button", { name: "Complete sale", exact: true }).click();
  await expect(page.getByText("Confirmation unavailable", { exact: true })).toBeVisible();
  expect(await stock()).toBe(before - 1);
  await page.unroute("**/pos");
  await checkout.getByRole("button", { name: "Complete sale", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Receipt", exact: true });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("Brian Otieno");
  await expect(receipt).toContainText("12,500");
  const logo = receipt.getByRole("img", { name: "Pedigree Leather logo", exact: true });
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await stock()).toBe(before - 1);
  const { data, error } = await admin.from("pos_sales")
    .select("id,total,change_due,payment_status,items:pos_sale_items(quantity,unit_price,line_total),audit:pos_sale_audit(event)")
    .eq("staff_id", staffId).gte("created_at", started).single();
  expect(error).toBeNull();
  expect(data).toMatchObject({ total: 12500, change_due: 500, payment_status: "paid",
    items: [{ quantity: 1, unit_price: 12500, line_total: 12500 }], audit: { event: "cash_sale_recorded" } });
  const storedSale = z.object({ id: z.string().uuid() }).parse(data);
  await expect(receipt).toContainText(storedSale.id.slice(0, 8).toUpperCase());
  await page.screenshot({ path: testInfo.outputPath("receipt.png") });
  await page.evaluate(() => {
    window.print = () => document.documentElement.setAttribute("data-print-requested", "true");
  });
  await receipt.getByRole("button", { name: "Print receipt" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-print-requested", "true");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#receipt-print-area")).toBeVisible();
  await expect(page.getByRole("heading", { name: "New sale" })).not.toBeVisible();
  const paper = await page.locator("#receipt-print-area").boundingBox();
  expect(paper?.width).toBeCloseTo(80 * 96 / 25.4, 0);
  expect(paper?.x).toBe(0);
  expect(paper?.y).toBe(0);
  const logoBounds = await logo.boundingBox();
  expect(logoBounds?.width).toBeLessThanOrEqual(120);
  expect(logoBounds?.x).toBeCloseTo(((paper?.width ?? 0) - (logoBounds?.width ?? 0)) / 2, 0);
  await page.screenshot({ path: testInfo.outputPath("print-layout.png") });
  await page.pdf({ path: testInfo.outputPath("receipt-80mm.pdf"), preferCSSPageSize: true, printBackground: true });
  expect(errors).toEqual([]);
});

test("concurrent same UUID commits once; changed-price replay preserves history", async () => {
  const client = await staffClient();
  const before = await stock();
  const uuid = randomUUID();
  const args = { p_client_uuid: uuid, p_cashier_id: staffId, p_total_kes: 12500,
    p_payment_method: "cash", p_amount_tendered: 13000,
    p_items: [{ product_id: productId, color_id: colorId, quantity: 1, price_at_sale: 12500 }] };
  const results = await Promise.all([client.rpc("pos_record_sale", args), client.rpc("pos_record_sale", args)]);
  expect(results.map((result) => result.error)).toEqual([null, null]);
  expect(results.map((result) => result.data).sort()).toEqual([false, true]);
  expect(await stock()).toBe(before - 1);
  const replay = await client.rpc("pos_record_sale", { ...args, p_total_kes: 1,
    p_items: [{ ...args.p_items[0], price_at_sale: 1 }] });
  expect(replay.error).toBeNull();
  expect(replay.data).toBe(false);
  expect(await stock()).toBe(before - 1);
});

test("concurrent last-unit sales allow exactly one and roll back the loser", async () => {
  const client = await staffClient();
  const id = randomUUID();
  const color = randomUUID();
  const inserted = await admin.from("products").insert({ id, name: "Concurrency fixture", slug: `test-${id}`, category: "bag", base_price: 1005, discount_percent: 90, active: true });
  if (inserted.error) throw inserted.error;
  const colored = await admin.from("product_colors").insert({ id: color, product_id: id, color_name: "Test", color_hex: "#000000", stock_quantity: 1 });
  if (colored.error) throw colored.error;
  const unitPrice = priceAfterDiscount(1005, 90);
  expect(unitPrice).toBe(101);
  const uuids = [randomUUID(), randomUUID()];
  const results = await Promise.all(uuids.map((uuid) => client.rpc("pos_record_sale", {
    p_client_uuid: uuid, p_cashier_id: staffId, p_total_kes: unitPrice,
    p_payment_method: "cash", p_amount_tendered: unitPrice,
    p_items: [{ product_id: id, color_id: color, quantity: 1, price_at_sale: unitPrice }],
  })));
  expect(results.filter((result) => result.data === true)).toHaveLength(1);
  expect(results.filter((result) => result.error?.code === "23514")).toHaveLength(1);
  const product = await admin.from("products").select("stock_quantity").eq("id", id).single();
  expect(product.data).toMatchObject({ stock_quantity: 0 });
  const sales = await admin.from("pos_sales").select("id").in("client_uuid", uuids);
  expect(sales.data).toHaveLength(1);
  const movements = await admin.from("stock_movements").select("delta,quantity_after").eq("product_id", id);
  expect(movements.data).toEqual([{ delta: -1, quantity_after: 0 }]);
});


test("selected colours stay separate in cart and only the sold colour loses stock", async ({ page }, testInfo) => {
  async function colourStock(id: string) {
    const result = await admin.from("product_colors").select("stock_quantity").eq("id", id).single();
    if (result.error) throw result.error;
    return stockSchema.parse(result.data).stock_quantity;
  }
  const blackId = "c0a80201-0000-4000-8000-000000000002";
  const beforeTan = await colourStock(colorId);
  const beforeBlack = await colourStock(blackId);
  const started = new Date().toISOString();
  await page.goto("/login");
  for (const digit of ["1", "2", "3", "4"]) await page.getByRole("button", { name: digit, exact: true }).click();
  await expect(page).toHaveURL(/\/pos$/, { timeout: 60_000 });
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Karura Tote", exact: true }) });
  const tan = card.getByRole("radio", { name: /^Tan / });
  const black = card.getByRole("radio", { name: /^Black / });
  await expect(tan).toBeChecked();
  await black.locator("..").click();
  await expect(black).toBeChecked();
  await expect(tan).not.toBeChecked();
  const selectedRing = await black.locator("..").locator("span").evaluate(element => getComputedStyle(element).boxShadow);
  const idleRing = await tan.locator("..").locator("span").evaluate(element => getComputedStyle(element).boxShadow);
  expect(selectedRing).not.toBe(idleRing);
  await page.keyboard.press("ArrowLeft");
  await expect(tan).toBeChecked();
  await black.locator("..").click();
  await card.getByRole("button", { name: "Add to cart", exact: true }).click();
  await tan.locator("..").click();
  await card.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(page.locator("aside li")).toHaveCount(2);
  await expect(page.locator("aside li").filter({ hasText: "Black" })).toHaveCount(1);
  await expect(page.locator("aside li").filter({ hasText: "Tan" })).toHaveCount(1);
  await page.getByRole("button", { name: "Remove Karura Tote — Tan", exact: true }).click();
  await expect(page.locator("aside li")).toHaveCount(1);
  for (let i = 1; i < beforeBlack; i++) {
    await page.getByRole("button", { name: "Increase Karura Tote — Black", exact: true }).click();
  }
  await page.getByRole("button", { name: "Increase Karura Tote — Black", exact: true }).click();
  await expect(page.getByText("Not enough stock", { exact: true })).toBeVisible();
  for (let i = 1; i < beforeBlack; i++) {
    await page.getByRole("button", { name: "Decrease Karura Tote — Black", exact: true }).click();
  }
  await page.screenshot({ path: testInfo.outputPath("selected-variant-cart.png") });
  await page.getByRole("button", { name: /^Charge/ }).click();
  const checkout = page.getByRole("dialog", { name: "Checkout" });
  await checkout.getByLabel("Cash tendered").fill("13000");
  await checkout.getByRole("button", { name: "Complete sale", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Receipt", exact: true });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("Black");
  await expect(receipt.getByRole("button", { name: "Print receipt", exact: true })).toBeFocused();
  await expect(receipt.getByRole("heading", { name: "Receipt", exact: true })).toHaveCSS("user-select", "none");
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  expect(await colourStock(colorId)).toBe(beforeTan);
  expect(await colourStock(blackId)).toBe(beforeBlack - 1);
  const sale = await admin.from("pos_sales").select("id, items:pos_sale_items(color_id,color_name,quantity)")
    .eq("staff_id", staffId).gte("created_at", started).single();
  expect(sale.error).toBeNull();
  expect(sale.data).toMatchObject({ items: [{ color_id: blackId, color_name: "Black", quantity: 1 }] });
});
