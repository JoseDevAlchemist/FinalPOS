"use client";

import { useRealtimeOrders } from "@/hooks/use-realtime-orders";

export function WebOrderNotifications() {
  const connection = useRealtimeOrders();
  return (
    <p role="status" className="text-xs text-muted">
      {connection === "connected" ? "Web orders: live" :
        connection === "connecting" ? "Web orders: connecting…" :
          "Web order alerts unavailable — check connection"}
    </p>
  );
}
