import { formatKes } from "@/lib/currency";
import { formatEatDateTime } from "@/lib/time";
import { documentNumber } from "@/lib/digital/links";
import type { DigitalDocument } from "@/lib/validation/digital";

export function escapeHtml(value: string): string {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}
export function renderDigitalEmail(document: DigitalDocument, link: string, origin: string): string {
  // Email clients need inline equivalents of primary/cream/card tokens.
  const primary = "rgb(93,64,55)";
  const cream = "rgb(248,240,227)";
  const title = document.kind === "quotation" ? "Your Quotation" : "Your Receipt";
  const rows = document.items.map((item) => {
    const image = item.image_url ? `<img src="${escapeHtml(new URL(item.image_url, origin).href)}" width="64" height="64" alt="${escapeHtml(item.name)}" style="border-radius:12px;object-fit:cover"/>` : "";
    return `<tr><td style="padding:18px 8px 18px 0;width:72px">${image}</td><td style="padding:18px 0"><strong>${escapeHtml(item.name)}</strong><br/><span style="color:rgb(110,91,76)">${escapeHtml(item.color_name ?? "")} · ${item.quantity} × ${formatKes(item.unit_price)}</span></td><td style="padding:18px 0;text-align:right;font-weight:bold">${formatKes(item.line_total)}</td></tr>`;
  }).join("");
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:${cream};color:rgb(43,43,43);font-family:Arial,sans-serif"><div style="max-width:680px;margin:auto;background:rgb(252,246,238);border-radius:24px;overflow:hidden">
  <div style="padding:36px;background:${primary};color:${cream}"><img src="${escapeHtml(new URL("/pedigree-logo.png",origin).href)}" width="72" height="72" alt="Pedigree Leather" style="border-radius:12px"/><p style="font-size:11px;letter-spacing:3px">HANDCRAFTED IN KENYA</p><h1 style="font:36px Georgia,serif;margin:12px 0">${title}</h1><p style="overflow-wrap:anywhere">${escapeHtml(documentNumber(document))} · ${escapeHtml(formatEatDateTime(document.created_at))} EAT</p></div>
  <div style="padding:30px"><p style="color:rgb(110,91,76)">PREPARED FOR</p><h2 style="font:28px Georgia,serif">${escapeHtml(document.customer_name)}</h2><p>Served by ${escapeHtml(document.staff_name)} · Nairobi</p><table style="width:100%;border-collapse:collapse">${rows}</table><p style="text-align:right">Subtotal: ${formatKes(document.subtotal)}</p>${document.discount_amount ? `<p style="text-align:right">Discount: −${formatKes(document.discount_amount)}</p>` : ""}<p style="font-size:24px;text-align:right;color:${primary}"><strong>Total: ${formatKes(document.total)}</strong></p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 22px;background:${primary};color:${cream};text-decoration:none;border-radius:12px">View your ${document.kind}</a></p>${document.kind === "quotation" ? "<p>Quotation only. Availability and pricing are confirmed at purchase.</p>" : ""}</div>
  <div style="padding:28px;text-align:center;background:${cream}"><p style="font:24px Georgia,serif;color:${primary}">${document.kind === "quotation" ? "Something beautiful is waiting for you." : "Thank you for shopping with us."}</p><p style="letter-spacing:3px">KARIBU TENA</p></div></div></body></html>`;
}
