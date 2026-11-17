"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCashierAction } from "@/lib/management/staff-actions";
import { inputClass, primaryButtonClass } from "./form-styles";

export function CashierCreateForm() {
  const requestId = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <form onSubmit={(event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    requestId.current ??= crypto.randomUUID();
    fields.set("clientUuid", requestId.current);
    setError(""); setSuccess("");
    startTransition(async () => {
      try {
        const result = await createCashierAction(fields);
        if (!result.ok) { setError(result.error); return; }
        requestId.current = null;
        form.reset();
        setSuccess("Cashier enrolled. They can now sign in with their PIN.");
        router.refresh();
      } catch { setError("Enrollment could not be confirmed. Retry with the same details."); }
    });
  }} className="space-y-4">
    <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-2 text-sm font-semibold">Cashier name<input name="name" required minLength={2} maxLength={100} autoComplete="off" className={inputClass} /></label>
      <label className="space-y-2 text-sm font-semibold">New PIN<input name="pin" type="password" inputMode="numeric" autoComplete="new-password" required pattern="[0-9]{4}" minLength={4} maxLength={4} className={inputClass} /></label>
    </fieldset>
    <p className="text-sm text-muted">Cashiers sign in with a unique four-digit PIN. Share it privately with the cashier.</p>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {success ? <p role="status" className="text-sm text-success">{success}</p> : null}
    <button disabled={pending} className={primaryButtonClass}>{pending ? "Enrolling…" : "Add cashier"}</button>
  </form>;
}
