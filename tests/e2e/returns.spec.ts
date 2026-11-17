import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !serviceKey || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw Error("Local Supabase required for returns tests.");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const manager = createClient(url, key, { auth: { persistSession: false } });

test("manager returns from a receipt, recovers a lost response, prints, and concurrent final returns cannot over-refund", async ({ page }) => {
  test.setTimeout(180_000);
  const productId = randomUUID();
  const saleRequest = randomUUID();
  const login = await admin.auth.admin.generateLink({ type: "magiclink", email: "grace-wanjiru@pedigree.local" });
  if (login.error) throw login.error;
  const verified = await manager.auth.verifyOtp({ type: "magiclink", token_hash: login.data.properties.hashed_token });
  if (verified.error) throw verified.error;
  try {
    const created = await manager.rpc("pos_manager_create_product", { p_client_uuid: productId, p_product: {
      name: `Return bag ${productId.slice(0, 8)}`, category: "bag", basePrice: 1000, description: "Local returns fixture", barcode: "",
      isWebsitePublished: false, colors: [{ name: "Tan", hex: "#8B4513", stockQuantity: 4, imageUrl: "" }],
    } });
    if (created.error) throw created.error;
    const color = await admin.from("product_colors").select("id").eq("product_id", productId).single();
    if (color.error) throw color.error;
    const colorId = z.object({ id: z.string().uuid() }).parse(color.data).id;
    const sold = await manager.rpc("pos_record_sale", { p_client_uuid: saleRequest, p_cashier_id: "a1c9f1e2-0000-4000-8000-000000000002",
      p_total_kes: 2000, p_payment_method: "cash", p_amount_tendered: 2000,
      p_items: [{ product_id: productId, color_id: colorId, quantity: 2, price_at_sale: 1000 }],
    });
    if (sold.error) throw sold.error;
    const saleResult = await admin.from("pos_sales").select("id,items:pos_sale_items(id)").eq("client_uuid", saleRequest).single();
    if (saleResult.error) throw saleResult.error;
    const sale = z.object({ id: z.string().uuid(), items: z.array(z.object({ id: z.string().uuid() })).length(1) }).parse(saleResult.data);
    const item = sale.items[0];
    if (!item) throw Error("Missing sold item");
    await page.goto("/login");
    for (const digit of "4826") await page.getByRole("button", { name: digit, exact: true }).click();
    await expect(page).toHaveURL(/\/manager$/, { timeout: 60_000 });
    await page.getByRole("navigation", { name: "Manager navigation" }).getByRole("link", { name: "Returns", exact: true }).click();
    const shortId = sale.id.slice(0, 8).toUpperCase();
    await page.getByLabel("Receipt Number", { exact: true }).fill(shortId);
    await page.getByRole("button", { name: "Find sale", exact: true }).click();
    await page.getByRole("link").filter({ hasText: shortId }).click();
    await page.getByLabel(/^Return quantity for/).fill("1");
    await page.getByLabel("Reason for Return", { exact: true }).fill("Wrong size");
    await page.route("**/manager/returns**", async (route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Authorize return & record refund", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Confirmation was lost|Could not confirm/ })).toBeVisible();
    await page.unroute("**/manager/returns**");
    await page.getByRole("button", { name: "Retry same return", exact: true }).click();
    const receipt = page.getByRole("dialog", { name: "Return receipt", exact: true });
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText(shortId);
    await expect(receipt).toContainText("1,000");
    await expect(receipt.getByRole("button", { name: "Print return receipt", exact: true })).toBeFocused();
    const returns = await admin.from("pos_returns").select("id,refund_amount").eq("sale_id", sale.id);
    expect(returns.error).toBeNull();
    expect(returns.data).toHaveLength(1);
    expect(returns.data?.[0]?.refund_amount).toBe(1000);
    const stock = await admin.from("products").select("stock_quantity").eq("id", productId).single();
    expect(stock.data?.stock_quantity).toBe(3);
    await page.emulateMedia({ media: "print" });
    await expect(receipt.locator(".receipt-paper")).toBeVisible();
    expect(await receipt.locator(".receipt-paper").evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(302);
    await page.emulateMedia({ media: "screen" });
    await receipt.getByRole("button", { name: "Close return receipt", exact: true }).click();
    await page.getByRole("button", { name: "Reprint return receipt", exact: true }).first().click();
    await expect(page.getByRole("dialog", { name: "Return receipt", exact: true })).toBeVisible();
    const payload = { p_sale_id: sale.id, p_reason: "Remaining unit", p_items: [{ sale_item_id: item.id, quantity: 1 }] };
    const concurrent = await Promise.all([
      manager.rpc("pos_process_return", { ...payload, p_client_uuid: randomUUID() }),
      manager.rpc("pos_process_return", { ...payload, p_client_uuid: randomUUID() }),
    ]);
    expect(concurrent.filter((result) => !result.error)).toHaveLength(1);
    expect(concurrent.find((result) => result.error)?.error?.code).toBe("23514");
    const final = await admin.from("pos_returns").select("refund_amount").eq("sale_id", sale.id);
    expect(final.error).toBeNull();
    const refunds = z.array(z.object({ refund_amount: z.number().int() })).parse(final.data);
    expect(refunds.reduce((sum, row) => sum + row.refund_amount, 0)).toBe(2000);
    expect((await admin.from("products").select("stock_quantity").eq("id", productId).single()).data?.stock_quantity).toBe(4);
    expect((await admin.from("pos_sales").select("total").eq("id", sale.id).single()).data?.total).toBe(2000);
  } finally {
    // Preserve the financial/ledger evidence; only hide the local catalogue fixture.
    await admin.from("products").update({ active: false }).eq("id", productId);
    await manager.auth.signOut();
  }
});
