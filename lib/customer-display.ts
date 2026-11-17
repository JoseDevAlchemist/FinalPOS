"use client";

import type WebSerialCustomerDisplay from "@point-of-sale/webserial-customer-display";

export interface CustomerDisplayState {
  status: "disconnected" | "connecting" | "connected";
  lastTotalKes: number;
}
const initialState: CustomerDisplayState = { status: "disconnected", lastTotalKes: 0 };
let state = initialState;
const listeners = new Set<() => void>();
let display: WebSerialCustomerDisplay | null = null;
let latestText = "WELCOME TO PEDIGREE";
let pendingPaint: string | null = latestText;
let draining = false;

function setState(patch: Partial<CustomerDisplayState>) {
  const next = { ...state, ...patch };
  if (next.status === state.status && next.lastTotalKes === state.lastTotalKes) return;
  state = next;
  for (const listener of listeners) listener();
}
export function getCustomerDisplayState() { return state; }
export function getServerCustomerDisplayState() { return initialState; }
export function subscribeCustomerDisplay(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function isCustomerDisplaySupported() {
  return typeof window !== "undefined" && window.isSecureContext && "serial" in navigator;
}

// One in-flight serial write, one replaceable pending frame. Stale totals never
// accumulate while the device is slow or disconnected.
async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (display && state.status === "connected" && pendingPaint !== null) {
      const instance = display;
      const text = pendingPaint;
      pendingPaint = null;
      try {
        // A two-line frame replaces both lines; the library's string API scrolls.
        await instance.line([text, ""]);
      } catch {
        pendingPaint = latestText;
        if (display === instance) {
          display = null;
          setState({ status: "disconnected" });
          await instance.disconnect().catch(() => undefined);
        }
        break;
      }
    }
  } finally {
    draining = false;
    if (pendingPaint !== null && state.status === "connected") void drain();
  }
}

export async function connectCustomerDisplay(): Promise<void> {
  if (state.status !== "disconnected") return;
  if (!isCustomerDisplaySupported()) throw new Error("Web Serial requires a supported browser and HTTPS or localhost.");
  setState({ status: "connecting" });
  let instance: WebSerialCustomerDisplay | null = null;
  try {
    // The package touches navigator in its constructor. Load it only on a
    // client gesture, never during Server Component rendering.
    const { default: CustomerDisplay } = await import("@point-of-sale/webserial-customer-display");
    instance = new CustomerDisplay();
    const connected = instance;
    display = connected;
    connected.addEventListener("connected", () => {
      if (display !== connected) return;
      setState({ status: "connected" });
      pendingPaint = latestText;
      void drain();
    });
    connected.addEventListener("disconnected", () => {
      if (display !== connected) return;
      display = null;
      pendingPaint = latestText;
      setState({ status: "disconnected" });
    });
    await connected.connect();
    // The upstream library swallows connection errors/cancelled choosers.
    if (getCustomerDisplayState().status !== "connected") throw new Error("Display connection was cancelled or failed.");
  } catch (error) {
    if (instance) await instance.disconnect().catch(() => undefined);
    display = null;
    setState({ status: "disconnected" });
    throw error;
  }
}

export function paintCustomerDisplay(totalKes: number): void {
  const amount = Number.isSafeInteger(totalKes) && totalKes > 0 ? totalKes : 0;
  latestText = amount === 0 ? "WELCOME TO PEDIGREE" : `TOTAL: KES ${amount}`;
  pendingPaint = latestText;
  setState({ lastTotalKes: amount });
  void drain();
}
export function clearCustomerDisplay() { paintCustomerDisplay(0); }
