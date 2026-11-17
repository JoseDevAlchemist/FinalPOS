import assert from "node:assert/strict";
import test from "node:test";
import { verifyFlutterwave } from "../../lib/flutterwave/verify.ts";
const expected = { tx_ref: "POS-CARD-fd000000-0000-4000-8000-000000000001", amount: 1000, transaction_id: "321" };
const evidence = { status: "success", data: { id: 321, tx_ref: expected.tx_ref, amount: 1000, currency: "KES", status: "successful", payment_type: "card" } };
test("server verification uses the fixed HTTPS endpoint, server secret and no caching", async () => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.FLW_SECRET_KEY;
  process.env.FLW_SECRET_KEY = "test-server-secret";
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.flutterwave.com/v3/transactions/321/verify");
      assert.equal(options.headers.Authorization, "Bearer test-server-secret");
      assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error");
      return Response.json(evidence);
    };
    assert.equal((await verifyFlutterwave(expected)).transaction_id, "321");
  } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.FLW_SECRET_KEY; else process.env.FLW_SECRET_KEY = previousKey; }
});
test("lost callbacks can recover by the same stored reference", async () => {
  const previousFetch = globalThis.fetch; const previousKey = process.env.FLW_SECRET_KEY;
  process.env.FLW_SECRET_KEY = "test-server-secret";
  try {
    globalThis.fetch = async (url) => { assert.equal(new URL(url).searchParams.get("tx_ref"), expected.tx_ref); return Response.json(evidence); };
    assert.equal((await verifyFlutterwave({ tx_ref: expected.tx_ref, amount: 1000 })).amount, 1000);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(verifyFlutterwave(expected));
  } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.FLW_SECRET_KEY; else process.env.FLW_SECRET_KEY = previousKey; }
});
