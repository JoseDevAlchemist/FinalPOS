import assert from "node:assert/strict";
import test from "node:test";
import { assertCardVerification, verifyCardSchema } from "../../lib/validation/flutterwave.ts";
const expected = { tx_ref: "POS-CARD-fd000000-0000-4000-8000-000000000001", amount: 1000, transaction_id: "123" };
const response = { status: "success", data: { id: 123, tx_ref: expected.tx_ref, amount: 1000, currency: "KES", status: "successful", payment_type: "card", card: { token: "must-not-be-retained" }, customer: { email: "must-not-be-retained@example.test" } } };
test("only server-matching successful KES card evidence is accepted", () => {
  assert.deepEqual(assertCardVerification(response, expected), { transaction_id: "123", tx_ref: expected.tx_ref, amount: 1000 });
});
test("reference, amount, currency, method, status and transaction ID are checked independently", () => {
  for (const patch of [{ tx_ref: "other-sale" }, { amount: 999 }, { currency: "USD" }, { status: "failed" }, { status: "pending" }, { payment_type: "banktransfer" }, { id: 124 }])
    assert.throws(() => assertCardVerification({ ...response, data: { ...response.data, ...patch } }, expected));
  assert.throws(() => assertCardVerification({ ...response, status: "error" }, expected));
});
test("overpayment is allowed but fractional or unsafe KES amounts are rejected", () => {
  assert.equal(assertCardVerification({ ...response, data: { ...response.data, amount: 1100 } }, expected).amount, 1100);
  for (const amount of [1000.5, Infinity, NaN, 2147483648]) assert.throws(() => assertCardVerification({ ...response, data: { ...response.data, amount } }, expected));
});
test("provider card tokens and customer payloads are excluded from retained evidence", () => {
  const retained = JSON.stringify(assertCardVerification(response, expected));
  assert.doesNotMatch(retained, /card|token|customer|must-not-be-retained/);
});
test("verification request validates IDs and integer amounts while allowing reference recovery", () => {
  assert.equal(verifyCardSchema.safeParse({ transaction_id: 123, tx_ref: expected.tx_ref, expected_amount: 1000 }).success, true);
  assert.equal(verifyCardSchema.safeParse({ tx_ref: expected.tx_ref, expected_amount: 1000 }).success, true);
  for (const transaction_id of ["../keys", "", "not-an-id"])
    assert.equal(verifyCardSchema.safeParse({ transaction_id, tx_ref: expected.tx_ref, expected_amount: 1000 }).success, false);
  assert.equal(verifyCardSchema.safeParse({ transaction_id: 123, tx_ref: expected.tx_ref, expected_amount: 0.5 }).success, false);
});
