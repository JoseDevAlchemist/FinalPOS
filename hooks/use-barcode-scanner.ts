"use client";

import { useEffect, useRef } from "react";

interface UseBarcodeScannerOptions {
  onScan: (code: string) => void;
  paused?: boolean;
  minLength?: number;
  timeoutMs?: number;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function useBarcodeScanner({
  onScan,
  paused = false,
  minLength = 3,
  timeoutMs = 120,
}: UseBarcodeScannerOptions): void {
  const bufferRef = useRef("");
  const lastKeyAtRef = useRef(0);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    bufferRef.current = "";
    lastKeyAtRef.current = 0;
    if (paused) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat ||
        document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') ||
        isEditableTarget(event.target)) {
        bufferRef.current = "";
        return;
      }

      const now = Date.now();
      if (now - lastKeyAtRef.current > timeoutMs) {
        bufferRef.current = "";
      }
      lastKeyAtRef.current = now;

      if (event.key === "Enter") {
        const code = bufferRef.current;
        bufferRef.current = "";
        if (code.length >= minLength) {
          event.preventDefault();
          onScanRef.current(code);
        }
        return;
      }

      if (event.key.length === 1) {
        bufferRef.current += event.key;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [paused, minLength, timeoutMs]);
}
