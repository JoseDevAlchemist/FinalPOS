import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { receiptSearchSchema, returnReceiptSchema, returnSaleSchema, returnSaleSummarySchema } from "@/lib/validation/returns";

const RETURN_SELECT = "id,sale_id,processed_by_name,refund_amount,reason,created_at,items:pos_return_items(id,product_name,color_name,quantity,refund_amount)";

export async function findReturnSales(receipt: string) {
  const term = receiptSearchSchema.parse(receipt);
  const client = await createClient();
  let query = client.from("pos_sales").select("id,staff_name,total,created_at")
    .eq("payment_status", "paid").order("created_at", { ascending: false }).order("id").limit(50);
  if (term.length === 8) {
    query = query.gte("id", `${term}-0000-0000-0000-000000000000`).lte("id", `${term}-ffff-ffff-ffff-ffffffffffff`);
  } else if (term) query = query.eq("id", term);
  const { data, error } = await query;
  if (error) throw new Error("Could not load sales. Check your connection and try again.");
  return z.array(returnSaleSummarySchema).parse(data);
}

export async function getReturnSale(id: string) {
  const saleId = z.string().uuid().parse(id);
  const client = await createClient();
  const { data, error } = await client.rpc("pos_return_sale_details", { p_sale_id: saleId });
  if (error) throw new Error("Could not load this paid sale. Check the receipt and your connection.");
  return returnSaleSchema.parse(data);
}

export async function getReturnReceipt(id: string) {
  const returnId = z.string().uuid().parse(id);
  const client = await createClient();
  const { data, error } = await client.from("pos_returns").select(RETURN_SELECT).eq("id", returnId).single();
  if (error) throw new Error("Could not load the return receipt. Retry using the same return request.");
  return returnReceiptSchema.parse(data);
}

export async function listRecentReturns(saleId?: string) {
  const client = await createClient();
  let query = client.from("pos_returns").select(RETURN_SELECT)
    .order("created_at", { ascending: false }).order("id").limit(20);
  if (saleId) query = query.eq("sale_id", z.string().uuid().parse(saleId));
  const { data, error } = await query;
  if (error) throw new Error("Could not load return history. Check that the returns migration is applied.");
  return z.array(returnReceiptSchema).parse(data);
}
