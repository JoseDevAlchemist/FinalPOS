import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { c2bLogEntry } from "../../lib/validation/mpesa-c2b.ts";
import { POST as confirmation } from "../../app/api/mpesa/c2b/confirmation/route.ts";
import { POST as validation } from "../../app/api/mpesa/c2b/validation/route.ts";
import { c2bRegistrationPayload, registerC2bUrls, registrationFailureMessage, oauthDiagnostics } from "../../scripts/register-mpesa-urls.ts";

const payment = { TransID: "TESTC2B001", TransTime: "20261117120000", TransAmount: "1500.00", BusinessShortCode: "600000", MSISDN: "254700000000", FirstName: "Private name", BillRefNumber: "Private account" };
const environment = { MPESA_ENV: "sandbox", MPESA_CALLBACK_URL: "https://example.test/api/mpesa/callback", MPESA_SHORTCODE: "174379", MPESA_C2B_SHORTCODE: "600000", MPESA_CONSUMER_KEY: "test-key", MPESA_CONSUMER_SECRET: "test-secret" };
function request(payload) { return new NextRequest("http://localhost/api/mpesa/c2b/confirmation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }

test("confirmation acknowledges valid payments without DB/provider I/O or personal logs", async () => {
  const previousLog = console.info; const previousFetch = globalThis.fetch; const entries = [];
  console.info = (...args) => entries.push(args);
  globalThis.fetch = async () => { throw Error("Unexpected external lookup before acknowledgement"); };
  try {
    const response = await confirmation(request(payment));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ResultCode: 0, ResultDesc: "Accepted" });
    assert.equal(entries.length, 1);
    const logged = JSON.stringify(entries);
    for (const value of [payment.MSISDN, payment.FirstName, payment.BillRefNumber, payment.TransID]) assert.ok(!logged.includes(value));
    assert.match(logged, /1500.00/); assert.match(logged, /"verified":false/);
  } finally { console.info = previousLog; globalThis.fetch = previousFetch; }
});
test("duplicate observations keep a stable fingerprint and decimal text, not financial writes", () => {
  assert.equal(c2bLogEntry(payment).transactionFingerprint, c2bLogEntry(payment).transactionFingerprint);
  assert.equal(c2bLogEntry({ ...payment, TransAmount: "1500.50" }).amountText, "1500.50");
});
test("malformed payload is rejected and validation acknowledges only well-formed notifications", async () => {
  const malformed = await confirmation(request({ unexpected: true }));
  assert.equal(malformed.status, 400);
  const valid = await validation(request(payment));
  assert.deepEqual(await valid.json(), { ResultCode: 0, ResultDesc: "Accepted" });
  assert.equal((await validation(request({ ...payment, TransAmount: "NaN" }))).status, 400);
});
test("callback origin, API base and legacy STK URL yield the actual C2B routes", () => {
  for (const base of ["https://example.test", "https://example.test/api/mpesa", "https://example.test/api/mpesa/", "https://example.test/api/mpesa/callback"])
    assert.deepEqual(c2bRegistrationPayload(base, "600000"), { ShortCode: "600000", ResponseType: "Completed", ConfirmationURL: "https://example.test/api/mpesa/c2b/confirmation", ValidationURL: "https://example.test/api/mpesa/c2b/validation" });
  for (const base of ["http://example.test", "https://example.test/api/mpesa/callback?token=private", "https://user:password@example.test", "https://example.test/unrelated"])
    assert.throws(() => c2bRegistrationPayload(base, "600000"));
});
test("registration obtains OAuth then sends correct C2B registration without leaking keys", async () => {
  let calls = 0;
  const result = await registerC2bUrls(environment, { fetcher: async (url, options) => {
    calls += 1; assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    if (calls === 1) {
      assert.equal(url, "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials");
      assert.equal(options.headers.Authorization, `Basic ${Buffer.from("test-key:test-secret").toString("base64")}`);
      return Response.json({ access_token: "test-token" });
    }
    assert.equal(url, "https://sandbox.safaricom.co.ke/mpesa/c2b/v1/registerurl");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.deepEqual(JSON.parse(options.body), c2bRegistrationPayload(environment.MPESA_CALLBACK_URL, "600000"));
    return Response.json({ ResponseCode: "0" });
  } });
  assert.equal(calls, 2); assert.equal(result.dryRun, false);
  assert.doesNotMatch(JSON.stringify(result), /test-key|test-secret|test-token/);
});
test("dry run makes no requests and production needs explicit selection", async () => {
  const fetcher = async () => { throw Error("Unexpected network request"); };
  assert.equal((await registerC2bUrls(environment, { dryRun: true, fetcher })).dryRun, true);
  await assert.rejects(registerC2bUrls({ ...environment, MPESA_ENV: "production" }, { fetcher }));
});
test("OAuth/provider rejection cannot report registration success", async () => {
  await assert.rejects(registerC2bUrls(environment, { fetcher: async () => new Response(null, { status: 401 }) }));
  let calls = 0;
  await assert.rejects(registerC2bUrls(environment, { fetcher: async () => ++calls === 1 ? Response.json({ access_token: "test-token" }) : Response.json({ ResponseCode: "1" }) }));
});
test("terminal errors omit arbitrary error contents and expose only safe network codes", () => {
  const error = new Error("Private credential and URL", { cause: { code: "EAI_AGAIN", token: "private-token" } });
  assert.equal(registrationFailureMessage(error), "Network access was unavailable (EAI_AGAIN).");
  assert.doesNotMatch(registrationFailureMessage(new Error("private-token")), /private-token/);
});

test("missing or blank OAuth credentials fail before network; whitespace is trimmed", async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls += 1;
    if (calls === 1) {
      assert.equal(options.headers.Authorization, `Basic ${Buffer.from("test-key:test-secret").toString("base64")}`);
      return Response.json({ access_token: "test-token" });
    }
    return Response.json({ ResponseCode: "0" });
  };
  await assert.rejects(registerC2bUrls({ ...environment, MPESA_CONSUMER_KEY: undefined }, { fetcher }));
  await assert.rejects(registerC2bUrls({ ...environment, MPESA_CONSUMER_SECRET: "   " }, { fetcher }));
  assert.equal(calls, 0);
  await registerC2bUrls({ ...environment, MPESA_CONSUMER_KEY: " test-key ", MPESA_CONSUMER_SECRET: " test-secret " }, { fetcher });
  assert.equal(calls, 2);
});

test("OAuth diagnostics identify the exact header without exposing reversible credentials", () => {
  const key = "example-consumer-key"; const secret = "example-consumer-secret";
  const result = oauthDiagnostics("https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials", key, secret);
  const header = `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
  assert.equal(result.consumerKey, "exam...");
  assert.equal(result.Authorization, "Basic [REDACTED]");
  assert.equal(result.authorizationLength, header.length);
  assert.equal(result.authorizationSha256.length, 64);
  assert.equal(result.authorizationSha256, oauthDiagnostics(result.url, key, secret).authorizationSha256);
  const output = JSON.stringify(result);
  for (const value of [key, secret, header, header.slice(6)]) assert.ok(!output.includes(value));
});
