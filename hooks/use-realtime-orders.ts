"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useToast } from "@/components/ui/toast";
import { formatKes } from "@/lib/currency";
import { ordersTokenSchema, webOrderSchema } from "@/lib/validation/web-orders";

export type OrdersConnection = "connecting" | "connected" | "unavailable";

export function useRealtimeOrders(): OrdersConnection {
  const toast = useToast();
  const [connection, setConnection] = useState<OrdersConnection>(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? "connecting" : "unavailable",
  );

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;

    // Isolate Realtime from the anonymous catalogue client. Never persist staff
    // JWTs or refresh credentials in browser storage or readable cookies.
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const abort = new AbortController();
    const seen = new Set<string>();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof client.channel> | undefined;
    let audio: AudioContext | undefined;

    function unlockAudio() {
      if (!window.AudioContext) return;
      try {
        audio ??= new AudioContext();
        void audio.resume().catch(() => {});
      } catch { /* Audio is optional; visual alerts remain available. */ }
    }

    function chime() {
      if (!audio || audio.state !== "running") return;
      try {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(784, audio.currentTime);
        oscillator.frequency.setValueAtTime(1046, audio.currentTime + 0.12);
        gain.gain.setValueAtTime(0.0001, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.06, audio.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start();
        oscillator.stop(audio.currentTime + 0.36);
      } catch { /* Unsupported or suspended audio must never interrupt checkout. */ }
    }

    async function authenticate() {
      try {
        const response = await fetch("/api/realtime/orders-token", {
          cache: "no-store", credentials: "same-origin", signal: abort.signal,
        });
        if (!response.ok) throw new Error("Order notification session unavailable");
        const payload: unknown = await response.json();
        const token = ordersTokenSchema.parse(payload);
        if (disposed) return;
        await client.realtime.setAuth(token.accessToken);
        if (disposed) return;
        if (!channel) {
          channel = client.channel("pos-web-orders")
            .on("postgres_changes", {
              event: "INSERT", schema: "public", table: "orders",
              filter: "status=in.(pending,pending_payment,awaiting_payment)",
            }, (event) => {
              if (disposed) return;
              const parsed = webOrderSchema.safeParse(event.new);
              if (!parsed.success || seen.has(parsed.data.id)) return;
              const order = parsed.data;
              seen.add(order.id);
              if (seen.size > 1000) {
                const oldest = seen.values().next().value;
                if (oldest) seen.delete(oldest);
              }
              toast.show({
                title: "New Web Order!",
                description: `Order ${order.order_number} for ${order.customer_name} (${formatKes(order.total)}).`,
                variant: "success", duration: null,
              });
              chime();
            })
            .subscribe((status) => {
              if (!disposed) setConnection(status === "SUBSCRIBED" ? "connected" : "unavailable");
            });
        }
        // Refresh via the server, which rechecks disabled staff and owns cookies.
        timer = setTimeout(() => { void authenticate(); },
          Math.min(60_000, Math.max(5_000, token.expiresAt * 1000 - Date.now() - 60_000)));
      } catch {
        if (disposed) return;
        setConnection("unavailable");
        if (channel) {
          const previous = channel;
          channel = undefined;
          await client.removeChannel(previous);
        }
        if (!disposed) timer = setTimeout(() => { void authenticate(); }, 15_000);
      }
    }

    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    void authenticate();
    return () => {
      disposed = true;
      abort.abort();
      clearTimeout(timer);
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      if (channel) void client.removeChannel(channel);
      client.realtime.disconnect();
      if (audio) void audio.close().catch(() => {});
    };
  }, [toast]);

  return connection;
}
