export type PosRole = "cashier" | "manager";

export interface StaffSession {
  id: string;
  name: string;
  role: PosRole;
}

export function isPosRole(value: unknown): value is PosRole {
  return value === "cashier" || value === "manager";
}
