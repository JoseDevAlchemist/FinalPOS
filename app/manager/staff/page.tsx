import { requireManager } from "@/lib/auth/session";
import { listStaff } from "@/lib/management/queries";
import { CashierCreateForm } from "@/components/manager/cashier-create-form";

export default async function StaffPage() {
  await requireManager();
  const staff = await listStaff();
  return <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
    <header><p className="text-xs font-semibold tracking-widest text-muted uppercase">Team</p><h1 className="mt-2 font-serif text-3xl font-semibold">Staff</h1></header>
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card"><h2 className="mb-4 font-serif text-xl font-semibold">Add cashier</h2><CashierCreateForm /></section>
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card"><h2 className="px-6 py-4 font-serif text-xl font-semibold">Staff roster</h2><ul className="divide-y divide-border">{staff.map((person) => <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
      <div><p className="font-semibold">{person.name}</p><p className="text-sm text-muted">{person.role === "manager" ? "Manager" : "Cashier"}</p></div>
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${person.active && person.auth_user_id ? "bg-success-soft text-foreground" : "bg-well text-muted"}`}>{!person.active ? "Disabled" : person.auth_user_id ? "Ready to sign in" : "Setup pending"}</span>
    </li>)}</ul></section>
  </div>;
}
