import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !serviceKey || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw Error("Local Supabase required.");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const manager = createClient(url, key, { auth: { persistSession: false } });

test("cashier shares premium quotes/receipts and uses manager PIN approval without changing sessions", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const productId = randomUUID();
  const name = `Digital bag ${productId.slice(0, 8)}`;
  const saleUuid = randomUUID();
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: "grace-wanjiru@pedigree.local" });
  if (link.error) throw link.error;
  const auth = await manager.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
  if (auth.error) throw auth.error;
  try {
    const created = await manager.rpc("pos_manager_create_product", { p_client_uuid: productId, p_product: {
      name, category: "bag", basePrice: 1000, barcode: "", description: "Local digital fixture", isWebsitePublished: false,
      colors: [{ name: "Tan", hex: "#8B4513", stockQuantity: 3, imageUrl: "/pedigree-logo.png" }],
    } });
    if (created.error) throw created.error;
    const color = await admin.from("product_colors").select("id").eq("product_id", productId).single();
    if (color.error) throw color.error;
    const colorId = z.object({ id: z.string().uuid() }).parse(color.data).id;
    const sold = await manager.rpc("pos_record_sale", { p_client_uuid: saleUuid, p_cashier_id: "a1c9f1e2-0000-4000-8000-000000000002",
      p_total_kes: 1000, p_payment_method: "cash", p_amount_tendered: 1000,
      p_items: [{ product_id: productId, color_id: colorId, quantity: 1, price_at_sale: 1000 }],
    });
    if (sold.error) throw sold.error;
    const original = await admin.from("pos_sales").select("id").eq("client_uuid", saleUuid).single();
    if (original.error) throw original.error;
    const saleId = z.object({ id: z.string().uuid() }).parse(original.data).id;
    await page.goto("/login");
    for (const digit of "1234") await page.getByRole("button", { name: digit, exact: true }).click();
    await expect(page).toHaveURL(/\/pos$/);
    await page.getByRole("textbox", { name: "Search products or type a barcode" }).fill(name);
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await page.getByRole("button", { name: "Create Quote", exact: true }).click();
    let document = page.getByRole("dialog", { name: "Digital quotation", exact: true });
    await document.getByLabel("Customer Name", { exact: true }).fill("Customer fixture");
    await document.getByLabel("Customer Phone", { exact: true }).fill("0700000000");
    await document.getByRole("button", { name: "Prepare document", exact: true }).click();
    await expect(document.getByRole("heading", { name: "Your Quotation", exact: true })).toBeVisible();
    await expect(document).toContainText("Brian Otieno");
    const href = await document.getByRole("link", { name: "Send to WhatsApp", exact: true }).getAttribute("href");
    if (!href) throw Error("WhatsApp link missing");
    const whatsapp = new URL(href);
    expect(whatsapp.pathname).toBe("/254700000000");
    const message = whatsapp.searchParams.get("text");
    const sharedUrl = message?.split("\n").at(-1);
    if (!sharedUrl) throw Error("Document link missing");
    expect((await admin.from("products").select("stock_quantity").eq("id", productId).single()).data?.stock_quantity).toBe(2);
    const customer = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await customer.goto(sharedUrl);
      await expect(customer.getByRole("heading", { name: "Your Quotation", exact: true })).toBeVisible();
      await expect(customer.getByText("Customer fixture", { exact: true })).toBeVisible();
      expect(await customer.evaluate(() => window.document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      const invalid = sharedUrl.split("/"); invalid[invalid.length - 1] = randomUUID();
      const response = await customer.goto(invalid.join("/"));
      // Next may stream a not-found result after response headers are sent.
      expect([200, 404]).toContain(response?.status());
      await expect(customer.locator(".digital-document")).toHaveCount(0);
      await expect(customer.getByText("404", { exact: true })).toBeVisible();
    } finally { await customer.close(); }
    await page.route("**/api/receipts/email", async (route) => {
      const payload: unknown = route.request().postDataJSON();
      expect(z.object({ kind: z.literal("quotation"), documentId: z.string().uuid(), to: z.string().email(), requestUuid: z.string().uuid() }).safeParse(payload).success).toBe(true);
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"email_not_configured"}' });
    });
    await document.getByLabel("Customer Email", { exact: true }).fill("customer@example.test");
    await document.getByRole("button", { name: "Send via Email", exact: true }).click();
    await expect(document.getByRole("status")).toContainText("not configured");
    await page.unroute("**/api/receipts/email");
    await document.getByRole("button", { name: "Close document", exact: true }).click();
    await page.getByRole("button", { name: "Return", exact: true }).click();
    const approval = page.getByRole("dialog", { name: "Return with manager approval", exact: true });
    await approval.getByLabel("Receipt Number", { exact: true }).fill(saleId.slice(0, 8));
    await approval.getByRole("button", { name: "Find receipt", exact: true }).click();
    await approval.getByRole("button").filter({ hasText: saleId.slice(0, 8).toUpperCase() }).click();
    await approval.getByLabel(/^Return quantity for/).fill("1");
    await approval.getByLabel("Reason for Return", { exact: true }).fill("Customer request");
    await approval.getByLabel("Manager PIN", { exact: true }).fill("1234");
    await approval.getByRole("button", { name: "Authorize return & record refund", exact: true }).click();
    await expect(approval.getByRole("alert")).toContainText("Manager PIN was not accepted");
    await approval.getByLabel("Manager PIN", { exact: true }).fill("4826");
    await approval.getByRole("button", { name: "Authorize return & record refund", exact: true }).click();
    const returned = page.getByRole("dialog", { name: "Return receipt", exact: true });
    await expect(returned).toBeVisible();
    const refund = await admin.from("pos_returns").select("processed_by,requested_by,refund_amount").eq("sale_id", saleId).single();
    expect(refund.data).toEqual({ processed_by: "a1c9f1e2-0000-4000-8000-000000000002", requested_by: "a1c9f1e2-0000-4000-8000-000000000001", refund_amount: 1000 });
    await returned.getByRole("button", { name: "Close return receipt", exact: true }).click();
    await approval.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByText("Brian Otieno", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Charge / }).click();
    const checkout = page.getByRole("dialog", { name: "Checkout", exact: true });
    await checkout.getByLabel("Cash tendered", { exact: true }).fill("1000");
    await checkout.getByRole("button", { name: "Complete sale", exact: true }).click();
    const receipt = page.getByRole("dialog", { name: "Receipt", exact: true });
    await receipt.getByRole("button", { name: "Send to WhatsApp / Email", exact: true }).click();
    document = page.getByRole("dialog", { name: "Digital receipt", exact: true });
    await document.getByLabel("Customer Name", { exact: true }).fill("Customer fixture");
    await document.getByLabel("Customer Phone", { exact: true }).fill("0700000000");
    await document.getByRole("button", { name: "Prepare document", exact: true }).click();
    await expect(document.getByRole("heading", { name: "Your Receipt", exact: true })).toBeVisible();
    await expect(document).toContainText("Brian Otieno");
    expect(await document.locator(".receipt-paper").count()).toBe(0);
  } finally {
    await admin.from("products").update({ active: false }).eq("id", productId);
    await manager.auth.signOut();
  }
});
