import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { saleRecordSchema } from "../../lib/validation/sales";

loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw Error("Local Supabase required for card tests.");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

test("mocked Flutterwave card modal recovers lost verification and prints one persisted receipt", async ({ page }) => {
  test.skip(!process.env.NEXT_PUBLIC_FLW_PUBLIC_KEY || !process.env.FLW_SECRET_KEY, "Configure test keys and rebuild the local app first.");
  const productId = randomUUID();
  const name = `Card fixture ${productId.slice(0, 8)}`;
  const providerId = String(Date.now());
  const product = await admin.from("products").insert({ id: productId, name, slug: `card-${productId}`, description: "Local card UI fixture", category: "bag", base_price: 1000, active: true, is_website_published: false });
  if (product.error) throw product.error;
  const color = await admin.from("product_colors").insert({ product_id: productId, color_name: "Tan", color_hex: "#8B4513", stock_quantity: 3 }).select("id").single();
  if (color.error) throw color.error;
  const colorId = z.object({ id: z.string().uuid() }).parse(color.data).id;
  await admin.from("stock_movements").insert({ product_id: productId, color_id: colorId, delta: 3, quantity_after: 3, reason: "Local card UI opening stock", actor_staff_id: "a1c9f1e2-0000-4000-8000-000000000002" });
  try {
    await page.addInitScript(({ transactionId }: { transactionId: number }) => {
      window.print = () => { document.documentElement.dataset.cardPrints = String(Number(document.documentElement.dataset.cardPrints ?? 0) + 1); };
      window.FlutterwaveCheckout = (config) => {
        if (config.payment_options !== "card" || config.currency !== "KES" || config.amount !== 1000) throw Error("Incorrect hosted checkout configuration");
        queueMicrotask(() => config.callback({ transaction_id: transactionId, status: "successful" }));
        return { close() {} };
      };
    }, { transactionId: Number(providerId) });
    let lostResponse = true;
    // This is a UI/DB test with synthetic provider evidence. Actual provider
    // verification is covered separately by the server HTTP mock unit tests.
    await page.route("**/api/flutterwave/verify", async (route) => {
      const body: unknown = route.request().postDataJSON();
      const request = z.object({ tx_ref: z.string(), expected_amount: z.literal(1000) }).parse(body);
      const draft = await admin.from("pos_card_payments").select("id,amount").eq("tx_ref", request.tx_ref).single();
      if (draft.error) throw draft.error;
      const payment = z.object({ id: z.string().uuid(), amount: z.literal(1000) }).parse(draft.data);
      await admin.from("products").update({ base_price: 9999 }).eq("id", productId);
      const finalized = await admin.rpc("pos_finalize_card", { p_id: payment.id, p_transaction_id: providerId, p_tx_ref: request.tx_ref, p_amount: 1000 });
      expect(finalized.error).toBeNull(); expect(finalized.data).toBe("completed");
      if (lostResponse) { lostResponse = false; await route.abort("failed"); return; }
      const result = await admin.from("pos_sales").select("id,client_uuid,staff_name,subtotal,discount_percent,discount_amount,total,payment_method,payment_status,cash_tendered,change_due,created_at,items:pos_sale_items(name,quantity,unit_price,line_total,color_name)").eq("id", payment.id).single();
      if (result.error) throw result.error;
      const sale = saleRecordSchema.parse(result.data);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, sale }) });
    });
    await page.goto("/login");
    for (const digit of "1234") await page.getByRole("button", { name: digit, exact: true }).click();
    await expect(page).toHaveURL(/\/pos$/);
    await page.getByRole("textbox", { name: "Search products or type a barcode" }).fill(name);
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await page.getByRole("button", { name: /^Charge / }).click();
    const checkout = page.getByRole("dialog", { name: "Checkout", exact: true });
    await checkout.getByRole("button", { name: "Card", exact: true }).click();
    await checkout.getByLabel("Card customer email", { exact: true }).fill("customer@example.test");
    await checkout.getByLabel("Card customer phone", { exact: true }).fill("0700000000");
    await checkout.getByRole("button", { name: "Pay with Card", exact: true }).click();
    await expect(checkout.getByRole("alert")).toBeVisible();
    expect((await admin.from("products").select("stock_quantity").eq("id", productId).single()).data?.stock_quantity).toBe(2);
    await expect(checkout.getByRole("button", { name: "Cash", exact: true })).toBeDisabled();
    await checkout.getByRole("button", { name: "Check Card Status", exact: true }).click();
    const receipt = page.getByRole("dialog", { name: "Receipt", exact: true });
    await expect(receipt).toBeVisible(); await expect(receipt).toContainText("1,000"); await expect(receipt).toContainText("Card");
    await expect.poll(() => page.locator("html").getAttribute("data-card-prints")).toBe("1");
    const items = await admin.from("pos_sale_items").select("sale_id,quantity,unit_price").eq("product_id", productId);
    expect(items.data).toHaveLength(1); expect(items.data?.[0]?.unit_price).toBe(1000);
    expect((await admin.from("products").select("stock_quantity").eq("id", productId).single()).data?.stock_quantity).toBe(2);
  } finally { await admin.from("products").update({ active: false }).eq("id", productId); }
});
