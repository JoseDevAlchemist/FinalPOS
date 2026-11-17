import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { documentSchema, customerPhoneSchema } from "../../lib/validation/digital.ts";
import { documentNumber, documentPath, whatsappLink } from "../../lib/digital/links.ts";
import { renderDigitalEmail, escapeHtml } from "../../lib/digital/email.ts";
import { DocumentTemplate } from "../../components/digital/document-template.tsx";

const document = documentSchema.parse({ id: "fc000000-0000-4000-8000-000000000001", share_token: "fc000000-0000-4000-8000-000000000002",
  sale_id: "fc000000-0000-4000-8000-000000000003", kind: "receipt", staff_name: "Cashier Jane", customer_name: "Amina <script>alert(1)</script>",
  customer_phone: "0712 345 678", subtotal: 2000, discount_amount: 200, total: 1800, created_at: "2026-11-17T09:00:00Z",
  items: [{ name: "Bag & leather", color_name: "Tan", color_hex: "#8B4513", image_url: "/pedigree-logo.png", quantity: 1, unit_price: 2000, line_total: 2000 }],
});
test("WhatsApp normalizes Kenya numbers and encodes a customer document link", () => {
  const link = new URL(whatsappLink(document, "https://pos.example"));
  assert.equal(link.host, "wa.me");
  assert.equal(link.pathname, "/254712345678");
  assert.match(link.searchParams.get("text"), /Thank you for shopping at Pedigree Leather!/);
  assert.ok(link.searchParams.get("text").includes(`https://pos.example${documentPath(document)}`));
  assert.equal(customerPhoneSchema.parse("+44 7700 900123"), "447700900123");
  assert.equal(customerPhoneSchema.safeParse("not a number").success, false);
});
test("quotes carry unique full IDs and remain distinct from paid receipts", () => {
  const quote = { ...document, kind: "quotation" };
  assert.equal(documentNumber(quote), `Q-${document.id.toUpperCase()}`);
  assert.match(new URL(whatsappLink(quote, "https://pos.example")).searchParams.get("text"), /quotation/);
  const html = renderToStaticMarkup(createElement(DocumentTemplate, { document: quote }));
  assert.match(html, /Quotation only/);
  assert.doesNotMatch(html, /Payment confirmed/);
});
test("premium responsive HTML includes brand, customer, cashier and totals without thermal classes", () => {
  const html = renderToStaticMarkup(createElement(DocumentTemplate, { document }));
  for (const text of ["Pedigree Leather", "Cashier Jane", "Bag &amp; leather", "Karibu Tena", "digital-document", "sm:", "1,800"]) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /receipt-paper|80mm|print-root|<script>/);
  assert.match(html, /Amina &lt;script&gt;/);
});
test("email escapes customer data and contains a complete premium document", () => {
  const html = renderDigitalEmail(document, `https://pos.example${documentPath(document)}`, "https://pos.example");
  assert.match(html, /Amina &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Cashier Jane/);
  assert.match(html, /https:\/\/pos.example\/pedigree-logo.png/);
  assert.equal(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
});
