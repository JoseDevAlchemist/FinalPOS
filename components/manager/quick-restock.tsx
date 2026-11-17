"use client";

import { Loader2, PackagePlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { useToast } from "@/components/ui/toast";
import { adjustStock } from "@/lib/products/actions";

interface RestockColor {
  id: string;
  name: string;
  hex: string;
  stockQuantity: number;
}

export function QuickRestock({
  productId,
  productName,
  colors,
}: {
  productId: string;
  productName: string;
  colors: RestockColor[];
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, [open]);
  const [colorId, setColorId] = useState(colors[0]?.id ?? "");
  const [delta, setDelta] = useState("1");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const selected = colors.find((color) => color.id === colorId) ?? colors[0];

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!selected) {
      setError("This product has no colours to restock.");
      return;
    }

    requestId.current ??= crypto.randomUUID();
    startTransition(async () => {
      try {
        const result = await adjustStock({
          clientUuid: requestId.current,
          productId,
          colorId: selected.id,
          delta: Number(delta),
          reason,
        });

        if (!result.ok) {
          setError(result.error);
          return;
        }

        toast.success(
          "Stock adjusted",
          `${productName} · ${selected.name} now has ${result.data.stockQuantity}.`,
        );
        requestId.current = null;
        setOpen(false);
        router.refresh();
      } catch { setError("Could not confirm the adjustment. Retry with the same details."); }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={colors.length === 0}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <PackagePlus aria-hidden="true" className="size-4" />
        Adjust stock
      </button>

      {open ? (
        <dialog ref={dialog} onCancel={(event) => { if (pending) event.preventDefault(); else close(); }}
          aria-labelledby={`restock-title-${productId}`}
          className="fixed inset-0 m-auto max-h-[90dvh] w-full max-w-md overflow-auto rounded-2xl border border-border bg-card p-6 text-foreground shadow-overlay backdrop:bg-foreground/40">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.65rem] font-semibold tracking-[0.2em] text-muted uppercase">
                  Inventory
                </p>
                <h2
                  id={`restock-title-${productId}`}
                  className="mt-1 font-serif text-2xl font-semibold text-foreground"
                >
                  Adjust stock
                </h2>
                <p className="mt-1 text-sm text-muted">{productName}</p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close restock dialog"
                className="rounded-lg p-2 text-muted transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>

            <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
              <fieldset disabled={pending} className="contents">
              <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
                Colour
                <select
                  autoFocus
                  value={colorId}
                  onChange={(event) => setColorId(event.target.value)}
                  className="h-10 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {colors.map((color) => (
                    <option key={color.id} value={color.id}>
                      {color.name} · {color.stockQuantity} in stock
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center justify-between rounded-xl border border-border bg-well px-3 py-2 text-sm">
                <span className="font-semibold text-foreground">
                  Current stock
                </span>
                <span className="inline-flex items-center gap-2 font-semibold text-foreground">
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-full border border-border"
                    style={{ backgroundColor: selected?.hex }}
                  />
                  {selected?.stockQuantity ?? 0}
                </span>
              </div>

              <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
                Change (+/-)
                <input
                  type="number"
                  step={1}
                  value={delta}
                  onChange={(event) => setDelta(event.target.value)}
                  className="h-10 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  aria-describedby={`restock-delta-help-${productId}`}
                />
                <span
                  id={`restock-delta-help-${productId}`}
                  className="text-xs font-normal leading-5 text-muted"
                >
                  Use + to receive stock and - to write units off. The change is
                  saved as a stock movement.
                </span>
              </label>

              <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
                Reason
                <input
                  type="text"
                  required
                  placeholder="Found in store, damaged, delivery received…"
                  maxLength={200}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="h-10 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                />
              </label>

              {error ? (
                <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-foreground">
                  {error}
                </p>
              ) : null}

              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={pending}
                  className="h-10 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-cream transition-colors hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending ? (
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  ) : null}
                  Save adjustment
                </button>
              </div>
              </fieldset>
            </form>
        </dialog>
      ) : null}
    </>
  );
}
