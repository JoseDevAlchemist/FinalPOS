import { Loader2 } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { WebOrderNotifications } from "@/components/orders/web-order-notifications";
import { BrandMark } from "@/components/brand-mark";
import { requireStaff } from "@/lib/auth/session";

export default function PosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<SessionFallback />}>
      <PosShell>{children}</PosShell>
    </Suspense>
  );
}

async function PosShell({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-3">
        <BrandMark size={36} tagline />

        <div className="flex items-center gap-3">
          {staff.role === "manager" ? (
            <Link
              href="/manager"
              className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Manager
            </Link>
          ) : null}

          <div className="text-right">
            <p className="text-sm font-semibold text-foreground">{staff.name}</p>
            <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-muted uppercase">
              {staff.role}
            </p>
          </div>

          <SignOutButton />
        </div>
      </header>

      <div className="border-b border-border bg-card px-4 py-2 print:hidden">
        <WebOrderNotifications />
      </div>

      <main className="flex-1">{children}</main>
    </div>
  );
}

function SessionFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background"
    >
      <Loader2 aria-hidden="true" className="size-6 animate-spin text-muted" />
      <p className="text-sm text-muted">Checking your session…</p>
    </div>
  );
}
