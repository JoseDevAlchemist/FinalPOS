import "server-only";

import { cache } from "react";

import { io } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { StaffSession } from "./types";

const staffRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  role: z.enum(["cashier", "manager"]),
  active: z.boolean(),
});

async function readAuthUserId(): Promise<string | null> {
  await io();

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user.id;
}

export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  const authUserId = await readAuthUserId();
  if (!authUserId) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pos_users")
    .select("id, name, role, active")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error || !data) return null;

  const row = staffRowSchema.safeParse(data);
  if (!row.success || !row.data.active) return null;

  return {
    id: row.data.id,
    name: row.data.name,
    role: row.data.role,
  };
});

export async function requireStaff(): Promise<StaffSession> {
  const staff = await getStaffSession();
  if (staff) return staff;

  const authUserId = await readAuthUserId();
  if (authUserId) {
    redirect("/api/auth/logout?reason=unavailable");
  }

  redirect("/login");
}

export async function requireManager(): Promise<StaffSession> {
  const staff = await requireStaff();
  if (staff.role !== "manager") {
    redirect("/pos");
  }
  return staff;
}
