import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";

process.loadEnvFile(".env.local");
const databaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.ok(databaseUrl && ["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname), "Local Supabase required");
const admin = createClient(databaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const productId = randomUUID(); const colorId = randomUUID();
const requests = new Map();
const providerRun = randomUUID().slice(0, 8);
let mode = "pending"; let calls = 0; let oauthCalls = 0;
const base = "http://127.0.0.1:3107";
let earlyCallbackStatus;
async function body(request) {
  let data = "";
  for await (const chunk of request) data += chunk;
  return data ? JSON.parse(data) : {};
}
function callbackPayload(payment, overrides = {}) {
  return { Body: { stkCallback: {
    MerchantRequestID: payment.merchant, CheckoutRequestID: payment.checkout, ResultCode: payment.result ?? 0,
    ...((payment.result ?? 0) === 0 ? { CallbackMetadata: { Item: [
      { Name: "Amount", Value: payment.amount }, { Name: "PhoneNumber", Value: Number(payment.phone) },
      { Name: "MpesaReceiptNumber", Value: payment.receipt },
    ] } } : {}), ...overrides,
  } } };
}
const mock = createServer(async (request, response) => {
  try {
    response.setHeader("Content-Type", "application/json");
    if (request.url.startsWith("/oauth/v1/generate")) {
      oauthCalls++;
      assert.equal(request.headers.authorization, `Basic ${Buffer.from("local-key:local-secret").toString("base64")}`);
      response.end(JSON.stringify({ access_token: "local-token", expires_in: 3600 })); return;
    }
    assert.equal(request.headers.authorization, "Bearer local-token");
    const input = await body(request);
    if (request.url === "/mpesa/stkpush/v1/processrequest") {
      calls++;
      if (mode === "reject") { response.statusCode = 400; response.end(JSON.stringify({ ResponseCode: "1" })); return; }
      const payment = { merchant: `${providerRun}-merchant-${calls}`, checkout: `${providerRun}-checkout-${calls}`, phone: input.PhoneNumber,
        amount: input.Amount, callbackUrl: input.CallBackURL, receipt: randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase(), result: null };
      requests.set(payment.checkout, payment);
      if (mode === "early") {
        payment.result = 0;
        const callback = await fetch(payment.callbackUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(callbackPayload(payment)) });
        earlyCallbackStatus = callback.status;
      }
      if (mode === "disconnect") { response.destroy(); return; }
      response.end(JSON.stringify({ MerchantRequestID: payment.merchant, CheckoutRequestID: payment.checkout, ResponseCode: "0" })); return;
    }
    if (request.url === "/mpesa/stkpushquery/v1/query") {
      const payment = requests.get(input.CheckoutRequestID);
      if (!payment || payment.result === null) { response.end(JSON.stringify({ errorCode: "500.001.1001" })); return; }
      response.end(JSON.stringify({ MerchantRequestID: payment.merchant, CheckoutRequestID: payment.checkout, ResultCode: String(payment.result) })); return;
    }
    response.statusCode = 404; response.end("{}");
  } catch { response.statusCode = 500; response.end(JSON.stringify({ error: "mock_assertion_failed" })); }
});
mock.listen(0, "127.0.0.1"); await once(mock, "listening");
const address = mock.address(); assert.ok(address && typeof address === "object");
const mockBase = `http://127.0.0.1:${address.port}`;
const originalTsConfigRaw = await readFile("tsconfig.json", "utf8");
const originalTsConfig = JSON.parse(originalTsConfigRaw);
let logs = ""; let cookies = ""; let browser; let manager;
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3107"], {
  detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
    MPESA_ENV: "sandbox", MPESA_TEST_BASE_URL: mockBase, MPESA_CONSUMER_KEY: "local-key", MPESA_CONSUMER_SECRET: "local-secret", MPESA_PASSKEY: "local-passkey",
    MPESA_SHORTCODE: "174379", MPESA_CALLBACK_URL: `${base}/api/mpesa/callback`, MPESA_CALLBACK_SECRET: "local-test-callback-secret-with-more-than-32-characters",
  },
});
next.stdout.on("data", (data) => { logs = (logs + data.toString()).slice(-100000); });
next.stderr.on("data", (data) => { logs = (logs + data.toString()).slice(-100000); });
async function authClient(email) {
  const client = createClient(databaseUrl, anonKey, { auth: { persistSession: false } });
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const verified = await client.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
  if (verified.error) throw verified.error;
  return client;
}
async function call(path, payload, extraHeaders = {}) {
  const response = await fetch(`${base}${path}`, { method: payload === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies, Origin: base, ...extraHeaders }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  const data = await response.json(); return { response, data };
}
async function stock() {
  const value = await admin.from("product_colors").select("stock_quantity").eq("id", colorId).single();
  if (value.error) throw value.error;
  return value.data.stock_quantity;
}
async function prepare(client) {
  const id = randomUUID();
  const result = await client.rpc("pos_prepare_mpesa_sale", { p_id: id, p_total: 3500, p_items: [{ product_id: productId, color_id: colorId, quantity: 1, price_at_sale: 3500 }] });
  assert.equal(result.error, null); return id;
}
async function start(client, requestedMode = "pending") {
  mode = requestedMode;
  const saleId = await prepare(client); const transactionId = randomUUID();
  const result = await call("/api/mpesa/stk-push", { saleId, amount: 3500, phoneNumber: "0712345678" }, { "Idempotency-Key": transactionId });
  return { saleId, transactionId, ...result, payment: requests.get(result.data.checkout_request_id) };
}
async function send(payment, payload = callbackPayload(payment), url = payment.callbackUrl) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
async function noSale(id) {
  const row = await admin.from("pos_sales").select("id").eq("id", id).maybeSingle(); assert.equal(row.error, null); assert.equal(row.data, null);
}
async function adjust(delta) {
  const changed = await manager.rpc("pos_manager_adjust_stock", { p_client_uuid: randomUUID(), p_product_id: productId, p_color_id: colorId, p_delta: delta, p_reason: "Local M-Pesa stock race verification" });
  assert.equal(changed.error, null);
}
try {
  for (let i = 0; i < 120; i++) {
    if (next.exitCode !== null) throw Error("isolated_payment_server_exited");
    try { const response = await fetch(`${base}/login`, { signal: AbortSignal.timeout(1500) }); if (response.ok) break; } catch {}
    if (i === 119) throw Error("isolated_payment_server_not_ready");
    await delay(500);
  }
  const product = await admin.from("products").insert({ id: productId, name: `M-Pesa fixture ${productId.slice(0, 8)}`, slug: `mpesa-${productId}`, category: "bag", base_price: 3500, barcode: `MPESA-${productId.slice(0, 8)}` });
  assert.equal(product.error, null);
  assert.equal((await admin.from("product_colors").insert({ id: colorId, product_id: productId, color_name: "Tan", color_hex: "#8B4513", stock_quantity: 20 })).error, null);
  const cashier = await authClient("brian-otieno@pedigree.local");
  manager = await authClient("grace-wanjiru@pedigree.local");
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ pin: "1234" }) });
  assert.equal(login.status, 200);
  cookies = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");

  const initialStock = await stock();
  const first = await start(cashier);
  assert.equal(first.response.status, 202); assert.ok(first.payment); await noSale(first.saleId); assert.equal(await stock(), initialStock);
  const repeated = await call("/api/mpesa/stk-push", { saleId: first.saleId, amount: 3500, phoneNumber: "0712345678" }, { "Idempotency-Key": first.transactionId });
  assert.equal(repeated.response.status, 202); assert.equal(calls, 1);
  const wrongAmount = await call("/api/mpesa/stk-push", { saleId: first.saleId, amount: 1, phoneNumber: "0712345678" }, { "Idempotency-Key": randomUUID() });
  assert.equal(wrongAmount.response.status, 409); assert.equal(calls, 1);
  const forbidden = new URL(first.payment.callbackUrl); forbidden.searchParams.set("token", "0".repeat(64));
  assert.equal((await send(first.payment, callbackPayload(first.payment), forbidden)).status, 401);
  const bad = callbackPayload(first.payment); bad.Body.stkCallback.CallbackMetadata.Item[0].Value = 1;
  assert.equal((await send(first.payment, bad)).status, 400); await noSale(first.saleId);
  // Even a capability-authenticated success payload is insufficient until the
  // independent provider query confirms success for the matching request ids.
  assert.equal((await send(first.payment)).status, 200); await noSale(first.saleId);
  first.payment.result = 0;
  assert.equal((await admin.from("products").update({ base_price: 4000, active: false }).eq("id", productId)).error, null);
  const confirmed = await call(`/api/mpesa/status?transactionId=${first.transactionId}`);
  assert.equal(confirmed.data.status, "success"); assert.equal(confirmed.data.sale.payment_method, "mpesa");
  assert.equal(confirmed.data.sale.total, 3500);
  assert.equal((await admin.from("products").update({ base_price: 3500, active: true }).eq("id", productId)).error, null);
  assert.equal(confirmed.data.sale.mpesa_receipt, first.payment.receipt); assert.equal(await stock(), initialStock - 1);
  assert.equal((await send(first.payment)).status, 200); assert.equal(await stock(), initialStock - 1);
  const ledger = await admin.from("stock_movements").select("id").eq("reason", `sale:${first.saleId}`);
  assert.equal(ledger.data.length, 1);
  console.log("PASS: authenticated callback, canonical amount, provider verification, replay and one stock decrement");

  const declined = await start(cashier);
  declined.payment.result = 1032;
  assert.equal((await send(declined.payment)).status, 200);
  assert.equal((await call(`/api/mpesa/status?transactionId=${declined.transactionId}`)).data.status, "failed");
  await noSale(declined.saleId);
  console.log("PASS: declined payment never creates a sale");

  const disconnected = await start(cashier, "disconnect");
  assert.equal(disconnected.response.status, 502); assert.equal(disconnected.data.status, "reconciliation");
  const uncertainPayment = [...requests.values()].at(-1);
  const beforeReplay = calls;
  await call("/api/mpesa/stk-push", { saleId: disconnected.saleId, amount: 3500, phoneNumber: "0712345678" }, { "Idempotency-Key": disconnected.transactionId });
  assert.equal(calls, beforeReplay); await noSale(disconnected.saleId);
  uncertainPayment.result = 0;
  assert.equal((await send(uncertainPayment)).status, 200);
  assert.equal((await call(`/api/mpesa/status?transactionId=${disconnected.transactionId}`)).data.status, "success");
  console.log("PASS: ambiguous dispatch is never re-sent; verified callback can recover provider ids");

  const manual = await start(cashier);
  const note = await call("/api/mpesa/manual", { transactionId: manual.transactionId, receiptCode: "MANUAL0001" });
  assert.equal(note.response.status, 200); await noSale(manual.saleId);
  assert.equal((await call(`/api/mpesa/status?transactionId=${manual.transactionId}`)).data.status, "manual_pending");
  assert.equal((await call("/api/mpesa/stk-push", { saleId: manual.saleId, amount: 3500, phoneNumber: "0712345678" }, { "Idempotency-Key": randomUUID() })).response.status, 409);
  console.log("PASS: manual codes remain unverified and block a conflicting payment attempt");

  const early = await start(cashier, "early");
  assert.equal(early.response.status, 202); assert.equal(earlyCallbackStatus, 200);
  assert.equal((await call(`/api/mpesa/status?transactionId=${early.transactionId}`)).data.status, "success");
  console.log("PASS: callback arriving before STK initiation response is preserved and finalized");

  const race = await start(cashier);
  const remaining = await stock(); await adjust(-remaining);
  race.payment.result = 0;
  assert.equal((await send(race.payment)).status, 200);
  assert.equal((await call(`/api/mpesa/status?transactionId=${race.transactionId}`)).data.status, "reconciliation"); await noSale(race.saleId);
  await adjust(1);
  assert.equal((await call(`/api/mpesa/status?transactionId=${race.transactionId}`)).data.status, "success");
  console.log("PASS: paid stock race preserves evidence, rolls back stock/sale, and can reconcile safely");
  await adjust(3);

  // Exercise the actual checkout UI against the same local mock provider.
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const page = await browser.newPage();
  assert.equal((await page.request.post(`${base}/api/auth/login`, { data: { pin: "1234" } })).status(), 200);
  page.setDefaultTimeout(60000);
  await page.goto(`${base}/pos`, { timeout: 120000, waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: `M-Pesa fixture ${productId.slice(0, 8)}`, exact: true }) });
  await card.getByRole("button", { name: "Add to cart", exact: true }).click();
  await page.getByRole("button", { name: /^Charge/ }).click();
  const dialog = page.getByRole("dialog", { name: "Checkout" });
  await dialog.getByRole("button", { name: "M-Pesa", exact: true }).click();
  await dialog.getByLabel("M-Pesa phone number", { exact: true }).fill("0712345678");
  mode = "pending";
  const dispatched = page.waitForResponse(response => response.url().endsWith("/api/mpesa/stk-push") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Initiate Payment", exact: true }).click();
  assert.equal((await dispatched).status(), 202);
  await dialog.getByText("Waiting for customer to enter PIN...", { exact: true }).waitFor();
  const uiPayment = [...requests.values()].at(-1);
  await page.screenshot({ path: "/tmp/pos-mpesa-waiting.png" });
  await page.clock.install();
  await page.clock.fastForward(61000);
  await dialog.getByLabel("M-Pesa receipt code", { exact: true }).fill("MANUAL0002");
  await dialog.getByRole("button", { name: "Save unverified code", exact: true }).click();
  await page.getByText("Code saved", { exact: true }).waitFor();
  assert.equal((await call(`/api/mpesa/status?transactionId=${new URL(uiPayment.callbackUrl).searchParams.get("id")}`)).data.status, "manual_pending");
  await dialog.getByRole("button", { name: "Cash", exact: true }).click();
  assert.equal(await dialog.getByRole("button", { name: "M-Pesa", exact: true }).getAttribute("aria-pressed"), "true");
  uiPayment.result = 0;
  assert.equal((await send(uiPayment)).status, 200);
  await dialog.getByRole("button", { name: "Check payment status", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Receipt", exact: true });
  await receipt.waitFor({ timeout: 30000 });
  assert.ok((await receipt.textContent()).includes(uiPayment.receipt));
  assert.ok((await receipt.textContent()).includes("M-Pesa"));
  await page.screenshot({ path: "/tmp/pos-mpesa-confirmed.png" });
  assert.ok(oauthCalls >= 1 && calls >= 5);
  assert.ok(!logs.includes("token="), "Callback capability must not be printed in request logs");
  console.log("PASS: real checkout waits, prevents cash conflict, polls success, and renders confirmed M-Pesa receipt");
  console.log("Local M-Pesa verification passed. All provider traffic used the local mock; no real payments were triggered.");
} catch (error) {
  console.error("Isolated payment server diagnostics:", logs.slice(-6000).replace(/token=[^&\s]+/g, "token=[redacted]"));
  throw error;
} finally {
  if (browser) await browser.close();
  await admin.from("products").update({ active: false }).eq("id", productId);
  try { process.kill(-next.pid, "SIGTERM"); } catch {}
  mock.closeAllConnections(); mock.close();
  await delay(500);
  const current = JSON.parse(await readFile("tsconfig.json", "utf8"));
  const filtered = current.include?.filter((entry) => !entry.includes(".next-mpesa-test/") || originalTsConfig.include?.includes(entry));
  if (filtered && filtered.length !== current.include.length) { current.include = filtered; await writeFile("tsconfig.json", JSON.stringify(current) === JSON.stringify(originalTsConfig) ? originalTsConfigRaw : JSON.stringify(current, null, 2) + "\n"); }
  const nextEnv = await readFile("next-env.d.ts", "utf8");
  if (nextEnv.includes(".next-mpesa-test/")) await writeFile("next-env.d.ts", nextEnv.replaceAll(".next-mpesa-test/", ".next/"));
}
