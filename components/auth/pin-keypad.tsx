"use client";

import { Delete, Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";
import { PIN_LENGTH, normalizePin } from "@/lib/auth/pin";
import type { PosRole } from "@/lib/auth/types";

interface LoginResponse {
  staff?: {
    name?: string;
    role?: PosRole;
  };
  error?: string;
  retryAfterSeconds?: number;
}

function currentTime(): number {
  return Date.now();
}

export function PinKeypad() {
  const router = useRouter();
  const toast = useToast();

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const redirectTimer = useRef<number | null>(null);

  const locked = lockedUntil > now;

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (redirectTimer.current !== null) {
        window.clearTimeout(redirectTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (lockedUntil === 0) return;

    const id = window.setInterval(() => {
      const at = currentTime();
      setNow(at);
      if (at >= lockedUntil) window.clearInterval(id);
    }, 250);

    return () => window.clearInterval(id);
  }, [lockedUntil]);

  async function submit(candidate: string) {
    if (submitting || locked) return;

    setSubmitting(true);
    setError(null);
    let keepBusy = false;

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: candidate }),
      });

      const body = (await response.json().catch(() => null)) as
        | LoginResponse
        | null;

      if (!response.ok) {
        setPin("");

        if (response.status === 429) {
          const seconds = body?.retryAfterSeconds ?? 30;
          const at = currentTime();
          setLockedUntil(at + seconds * 1000);
          setNow(at);
          setError(`Too many attempts. Try again in ${seconds}s.`);
          toast.error(
            "Too many attempts",
            "Wait a moment before trying again.",
          );
          return;
        }

        if (response.status === 401) {
          setError("That PIN did not match.");
          toast.error("Invalid PIN", "Check the four digits and try again.");
          return;
        }

        if (response.status === 403) {
          setError("This staff account is not ready for sign-in.");
          toast.error(
            "Sign-in unavailable",
            "Ask a manager to finish setting up this account.",
          );
          return;
        }

        setError("Sign-in is unavailable right now.");
        toast.error("Network Error", "Could not reach the server. Try again.");
        return;
      }

      const firstName = body?.staff?.name?.split(" ")[0];
      const role = body?.staff?.role ?? "cashier";

      toast.success(
        firstName ? `Welcome back, ${firstName}` : "Welcome back",
        "Signing you in…",
      );

      keepBusy = true;
      redirectTimer.current = window.setTimeout(() => {
        router.replace(role === "manager" ? "/manager" : "/pos");
        router.refresh();
      }, 700);
    } catch {
      setPin("");
      setError("Network error. Check the connection and try again.");
      toast.error("Network Error", "Could not reach the server. Try again.");
    } finally {
      if (!keepBusy) setSubmitting(false);
    }
  }

  function press(digit: string) {
    if (locked || submitting) return;
    setError(null);

    const next = normalizePin(pin + digit);
    setPin(next);
    inputRef.current?.focus();

    if (next.length === PIN_LENGTH) {
      void submit(next);
    }
  }

  function backspace() {
    if (locked || submitting) return;
    setError(null);
    setPin((current) => current.slice(0, -1));
    inputRef.current?.focus();
  }

  const secondsLeft = locked ? Math.ceil((lockedUntil - now) / 1000) : 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(pin);
      }}
      className="flex w-full max-w-sm flex-col items-center"
    >
      <header className="w-full text-center">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
          Enter your PIN
        </h1>
        <p className="mt-2 text-sm text-muted">
          Staff sign in. Your PIN is verified by the server.
        </p>
      </header>

      <div className="mt-10 flex w-full flex-col items-center">
        <label htmlFor="pos-pin" className="sr-only">
          PIN
        </label>
        <input
          id="pos-pin"
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={PIN_LENGTH}
          value={pin}
          disabled={locked || submitting}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? "pos-pin-error" : undefined}
          onChange={(event) => {
            if (locked || submitting) return;
            setError(null);
            const next = normalizePin(event.target.value);
            setPin(next);
            if (next.length === PIN_LENGTH) {
              void submit(next);
            }
          }}
          className="sr-only"
        />

        <div
          aria-hidden="true"
          onClick={() => inputRef.current?.focus()}
          className="mt-2 flex cursor-text justify-center gap-3"
        >
          {Array.from({ length: PIN_LENGTH }).map((_, index) => {
            const filled = index < pin.length;
            return (
              <span
                key={index}
                className={`size-4 rounded-full border transition-all duration-150 ${
                  filled
                    ? "scale-110 border-primary bg-primary"
                    : "border-border bg-well"
                }`}
              />
            );
          })}
        </div>

        <div className="mt-4 min-h-6 w-full text-center">
          {locked ? (
            <p role="alert" className="text-sm font-medium text-danger">
              Locked — {secondsLeft}s
            </p>
          ) : error !== null ? (
            <p
              id="pos-pin-error"
              role="alert"
              className="text-sm font-medium text-danger"
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-8 grid w-full max-w-xs grid-cols-3 gap-4 md:max-w-sm md:gap-6">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <KeypadButton
            key={digit}
            onClick={() => press(digit)}
            disabled={locked || submitting}
          >
            {digit}
          </KeypadButton>
        ))}
        <KeypadButton
          onClick={backspace}
          disabled={locked || submitting}
          aria-label="Delete last digit"
        >
          <Delete aria-hidden="true" className="mx-auto size-5" />
        </KeypadButton>
        <KeypadButton
          onClick={() => press("0")}
          disabled={locked || submitting}
        >
          0
        </KeypadButton>
        <button
          type="submit"
          disabled={locked || submitting || pin.length === 0}
          className="flex h-16 items-center justify-center rounded-2xl bg-primary text-cream transition-colors hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? (
            <Loader2 aria-hidden="true" className="size-6 animate-spin" />
          ) : (
            <ShieldCheck aria-hidden="true" className="size-6" />
          )}
          <span className="sr-only">Sign in</span>
        </button>
      </div>
    </form>
  );
}

function KeypadButton({
  children,
  onClick,
  disabled,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="h-16 rounded-2xl border border-border bg-card text-2xl font-semibold text-foreground shadow-card transition-[transform,background-color,border-color] duration-150 hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
