"use client";

import JsBarcode from "jsbarcode";
import { Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatKes } from "@/lib/currency";

export function BarcodeLabel({
  barcode,
  productName,
  price,
}: {
  barcode: string;
  productName: string;
  price: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    try {
      JsBarcode(svgRef.current, barcode, {
        format: "CODE128",
        width: 2,
        height: 72,
        displayValue: true,
        fontSize: 16,
        margin: 8,
        background: "#ffffff",
        lineColor: "#2b2b2b",
      });
    } catch {
      queueMicrotask(() =>
        setError("This barcode could not be rendered as CODE128."),
      );
    }
  }, [barcode]);

  return (
    <div className="flex flex-col gap-4">
      <div className="barcode-label w-full max-w-sm rounded-2xl border border-border bg-white p-6 text-charcoal shadow-card print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        <p className="text-center font-serif text-xl font-semibold">
          {productName}
        </p>
        <div className="mt-3 flex justify-center">
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : (
            <svg ref={svgRef} aria-label={`Barcode ${barcode}`} />
          )}
        </div>
        <p className="mt-3 text-center text-lg font-semibold">
          {formatKes(price)}
        </p>
      </div>

      <div className="no-print flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => window.print()}
          disabled={Boolean(error)}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-cream transition-colors hover:bg-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Printer aria-hidden="true" className="size-4" />
          Print label
        </button>
        <p className="text-sm text-muted">
          The print dialog uses the 80mm roll setup already configured for
          receipts.
        </p>
      </div>
    </div>
  );
}
