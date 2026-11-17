import "server-only";
import { createClient } from "@/lib/supabase/server";
import { saleRecordSchema } from "@/lib/validation/sales";

export async function getSaleReceipt(id: string) {
  const client = await createClient();
  const { data, error } = await client.from("pos_sales").select(`id,client_uuid,staff_name,subtotal,discount_percent,discount_amount,total,payment_method,payment_status,cash_tendered,change_due,created_at,mpesa_receipt,items:pos_sale_items(name,quantity,unit_price,line_total,color_name)`).eq("id", id).single();
  if (error) throw new Error("receipt_unavailable");
  return saleRecordSchema.parse(data);
}
