import "server-only";

const MAX_FAILURES = 5;
const LOCKOUT_MS = 30_000;
const ENTRY_TTL_MS = 10 * 60_000;

interface AttemptEntry {
  failures: number;
  lockedUntil: number;
  updatedAt: number;
}

const attempts = new Map<string, AttemptEntry>();

function pruneExpired(now: number): void {
  for (const [key, entry] of attempts) {
    if (now - entry.updatedAt > ENTRY_TTL_MS) attempts.delete(key);
  }
}

export function getLockoutSeconds(key: string): number {
  pruneExpired(Date.now());
  const entry = attempts.get(key);
  if (!entry) return 0;

  const remaining = entry.lockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export function registerFailedAttempt(key: string): number {
  const now = Date.now();
  pruneExpired(now);

  const entry = attempts.get(key) ?? {
    failures: 0,
    lockedUntil: 0,
    updatedAt: now,
  };

  entry.failures += 1;
  entry.updatedAt = now;

  if (entry.failures >= MAX_FAILURES) {
    entry.failures = 0;
    entry.lockedUntil = now + LOCKOUT_MS;
  }

  attempts.set(key, entry);
  return getLockoutSeconds(key);
}

export function clearFailedAttempts(key: string): void {
  attempts.delete(key);
}
