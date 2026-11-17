import assert from "node:assert/strict";
import test from "node:test";
import { refundForQuantity } from "../../lib/returns/refund.ts";

const line = { id: "unused", product_id: "unused", color_id: "unused", name: "Bag", color_name: "Tan", quantity: 2, unit_price: 500, refund_budget: 669, returned_quantity: 0 };
test("partial return preview preserves the final integer shilling", () => {
  assert.equal(refundForQuantity(line, 1), 334);
  assert.equal(refundForQuantity({ ...line, returned_quantity: 1 }, 1), 335);
  assert.equal(refundForQuantity(line, 2), 669);
});
test("discounted/free returns do not use current or undiscounted unit prices", () => {
  assert.equal(refundForQuantity({ ...line, unit_price: 9000 }, 1), 334);
  assert.equal(refundForQuantity({ ...line, refund_budget: 0 }, 2), 0);
});
test("invalid quantities cannot contribute a preview", () => {
  for (const quantity of [-1, 0.5, NaN, Infinity, 3]) assert.equal(refundForQuantity(line, quantity), 0);
  assert.equal(refundForQuantity({ ...line, returned_quantity: 2 }, 1), 0);
});
test("large integer budgets stay exact beyond floating multiplication precision", () => {
  const large = { ...line, quantity: 10000000, refund_budget: 2147483647, returned_quantity: 9999999 };
  assert.equal(refundForQuantity(large, 1), 215);
});
