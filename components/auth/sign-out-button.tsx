export function SignOutButton() {
  return (
    <form action="/api/auth/logout" method="post">
      <button
        type="submit"
        className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Sign out
      </button>
    </form>
  );
}
