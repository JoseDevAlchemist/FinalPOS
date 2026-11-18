import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const dashboardSchema = z.object({
  todayTotal: z.number().int().nonnegative(),
  todayCount: z.number().int().nonnegative(),
  lowStockCount: z.number().int().nonnegative(),
  lowStock: z.array(z.object({ id: z.string().uuid(), name: z.string(), color_name: z.string(), stock_quantity: z.number().int() })),
  recentSales: z.array(z.object({ id: z.string().uuid(), staff_name: z.string(), total: z.number().int(), payment_method: z.string(), payment_status: z.string(), created_at: z.string() })),
  exchangeRate: z.number().positive(),
});
export type DashboardStats = z.infer<typeof dashboardSchema>;

export async function getDashboardStats(): Promise<DashboardStats> {
  const client = await createClient();
  const { data, error } = await client.rpc("pos_manager_dashboard");
  if (error) throw new Error("Could not load the manager overview.");
  return dashboardSchema.parse(data);
}
