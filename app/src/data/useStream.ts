import { useEffect } from "react";
import { useStore } from "../state/store";
import { milesToNm } from "../geo/geo";

interface SnapshotMsg {
  type: "snapshot";
  now: number;
  source: string;
  aircraft: Parameters<ReturnType<typeof useStore.getState>["applySnapshot"]>[0]["aircraft"];
}

interface DeltaMsg {
  type: "delta";
  now: number;
  source: string;
  updated: SnapshotMsg["aircraft"];
  removed: string[];
}

type StreamMsg = SnapshotMsg | DeltaMsg;

/**
 * Subscribes to the server's SSE stream for the configured region. The server
 * pushes a full snapshot on connect, then position deltas continuously.
 * EventSource auto-reconnects on transient errors; we re-open on config change.
 */
export function useStream(): void {
  const config = useStore((s) => s.config);
  const applySnapshot = useStore((s) => s.applySnapshot);
  const applyDelta = useStore((s) => s.applyDelta);
  const setStatus = useStore((s) => s.setStatus);

  useEffect(() => {
    const distNm = Math.min(Math.round(milesToNm(config.radiusMiles)), 250);
    // The Vite dev proxy buffers SSE (only the initial snapshot gets through,
    // deltas stall), so in dev connect straight to the backend (CORS is open).
    // In a production build, use same-origin (served behind a real proxy).
    const env = import.meta.env as Record<string, string | undefined>;
    const sseBase =
      env.VITE_SSE_BASE ?? (import.meta.env.DEV ? "http://localhost:8787" : "");
    const url = `${sseBase}/api/stream?lat=${config.centerLat}&lon=${config.centerLon}&dist=${distNm}`;

    // Watchdog: EventSource's built-in retry can wedge (e.g. the dev server
    // restarts, or a proxy half-opens the connection) leaving us "connected"
    // but receiving nothing. If no frame arrives for STALE_MS, force a full
    // reconnect so the feed self-heals instead of silently freezing.
    const STALE_MS = 10_000;
    let es: EventSource | null = null;
    let lastMessageAt = Date.now();
    let closed = false;

    const connect = () => {
      if (closed) return;
      es?.close();
      setStatus("loading");
      lastMessageAt = Date.now();
      es = new EventSource(url);

      es.onmessage = (event) => {
        lastMessageAt = Date.now();
        try {
          const msg = JSON.parse(event.data) as StreamMsg;
          if (msg.type === "snapshot") {
            applySnapshot(msg);
          } else if (msg.type === "delta") {
            applyDelta(msg);
          }
        } catch {
          /* ignore malformed frame */
        }
      };

      es.onerror = () => {
        setStatus("error", "stream disconnected — reconnecting…");
      };
    };

    connect();

    const watchdog = setInterval(() => {
      if (Date.now() - lastMessageAt > STALE_MS) {
        setStatus("error", "feed stalled — reconnecting…");
        connect();
      }
    }, 3000);

    return () => {
      closed = true;
      clearInterval(watchdog);
      es?.close();
    };
  }, [config, applySnapshot, applyDelta, setStatus]);
}
