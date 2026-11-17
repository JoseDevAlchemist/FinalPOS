import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const staffSchema = z.object({ id: z.string().uuid(), name: z.string(), role: z.enum(["manager", "cashier"]), active: z.boolean(), auth_user_id: z.string().uuid().nullable(), created_at: z.string() });
export async function listStaff() {
  const client = await createClient();
  const { data, error } = await client.from("pos_users").select("id,name,role,active,auth_user_id,created_at").order("created_at");
  if (error) throw new Error("Could not load staff.");
  return z.array(staffSchema).parse(data);
}

const movementSchema = z.object({
  id: z.string().uuid(), product_id: z.string().uuid(), delta: z.number().int(), quantity_after: z.number().int(), reason: z.string(), created_at: z.string(),
  products: z.object({ name: z.string() }),
  product_colors: z.object({ color_name: z.string() }).nullable(),
  pos_users: z.object({ name: z.string() }).nullable(),
});
export async function listStockMovements() {
  const client = await createClient();
  const { data, error } = await client.from("stock_movements")
    .select("id,product_id,delta,quantity_after,reason,created_at,products(name),product_colors(color_name),pos_users(name)")
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error("Could not load inventory history.");
  return z.array(movementSchema).parse(data);
}
