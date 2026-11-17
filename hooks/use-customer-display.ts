"use client";

import { useSyncExternalStore } from "react";
import {
  connectCustomerDisplay, getCustomerDisplayState, getServerCustomerDisplayState,
  paintCustomerDisplay, subscribeCustomerDisplay,
} from "@/lib/customer-display";

export function useCustomerDisplay() {
  const state = useSyncExternalStore(subscribeCustomerDisplay, getCustomerDisplayState, getServerCustomerDisplayState);
  return { ...state, connect: connectCustomerDisplay, paint: paintCustomerDisplay };
}
