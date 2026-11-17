import { Loader2 } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { WebOrderNotifications } from "@/components/orders/web-order-notifications";
import { BrandMark } from "@/components/brand-mark";
import { requireManager } from "@/lib/auth/session";

export default function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<SessionFallback />}>
      <ManagerShell>{children}</ManagerShell>
    </Suspense>
  );
}

async function ManagerShell({ children }: { children: React.ReactNode }) {
  const staff = await requireManager();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-4 py-3 print:hidden">
        <div className="flex flex-wrap items-center gap-4">
          <BrandMark size={36} tagline />
          <nav aria-label="Manager navigation" className="flex flex-wrap items-center gap-1">
            <Link
              href="/manager"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Overview
            </Link>
            <Link
              href="/manager/products"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-muted transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Products
            </Link>
            <Link href="/manager/inventory" className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-accent">Inventory</Link>
            <Link href="/manager/returns" className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-accent">Returns</Link>
            <Link href="/manager/staff" className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-accent">Staff</Link>
            <Link
              href="/manager/settings"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-muted transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Settings
            </Link>
            <Link
              href="/pos"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-muted transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Till
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-semibold text-foreground">{staff.name}</p>
            <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-muted uppercase">
              Manager
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
      <p className="text-sm text-muted">Checking manager access…</p>
    </div>
  );
}
