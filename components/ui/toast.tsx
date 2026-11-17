"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
  persistent: boolean;
}

interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** null keeps an alert visible until explicitly dismissed. */
  duration?: number | null;
}

interface ToastApi {
  show: (input: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: "border-success/30 bg-success-soft text-foreground",
  error: "border-danger/30 bg-danger-soft text-foreground",
  info: "border-border bg-card text-foreground",
};

const VARIANT_ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = nextId.current;
      nextId.current += 1;

      const toast: ToastItem = {
        id,
        title: input.title,
        description: input.description,
        variant: input.variant ?? "info",
        persistent: input.duration === null,
      };

      setToasts((current) => {
        const persistent = current.filter((item) => item.persistent);
        const transient = current.filter((item) => !item.persistent);
        return [...persistent, ...transient.slice(-2), toast];
      });

      if (input.duration !== null) {
        const timer = window.setTimeout(() => dismiss(id), input.duration ?? 4000);
        timers.current.set(id, timer);
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((timer) => window.clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, description) =>
        show({ title, description, variant: "success" }),
      error: (title, description) =>
        show({ title, description, variant: "error" }),
      info: (title, description) =>
        show({ title, description, variant: "info" }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex max-h-svh flex-col items-center gap-2 overflow-y-auto p-4 sm:items-end"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const Icon = VARIANT_ICONS[toast.variant];
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                role={toast.variant === "error" ? "alert" : "status"}
                className={`pointer-events-auto flex w-full max-w-sm shrink-0 items-start gap-3 rounded-xl border p-4 shadow-card-lift ${VARIANT_STYLES[toast.variant]}`}
              >
                <Icon
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{toast.title}</p>
                  {toast.description ? (
                    <p className="mt-1 text-sm text-muted">
                      {toast.description}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss notification"
                  className="rounded-md p-1 text-muted transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider.");
  }
  return context;
}
