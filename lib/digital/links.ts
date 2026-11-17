import { customerPhoneSchema, type DigitalDocument } from "@/lib/validation/digital";

export function documentNumber(document: Pick<DigitalDocument, "kind" | "id" | "sale_id">): string {
  return document.kind === "quotation" ? `Q-${document.id.toUpperCase()}` : (document.sale_id ?? document.id).slice(0, 8).toUpperCase();
}
export function documentPath(document: Pick<DigitalDocument, "kind" | "id" | "share_token">): string {
  return `/documents/${document.kind}/${document.id}/${document.share_token}`;
}
export function whatsappLink(document: DigitalDocument, origin: string): string {
  const phone = customerPhoneSchema.parse(document.customer_phone);
  const url = new URL(documentPath(document), origin).href;
  const message = document.kind === "receipt"
    ? `Thank you for shopping at Pedigree Leather! Here is your receipt for Order #${documentNumber(document)}.\n${url}`
    : `Thank you for choosing Pedigree Leather! Here is your quotation #${documentNumber(document)}.\n${url}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
