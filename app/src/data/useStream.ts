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
    const url = `/api/stream?lat=${config.centerLat}&lon=${config.centerLon}&dist=${distNm}`;

    setStatus("loading");
    const es = new EventSource(url);

    es.onmessage = (event) => {
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

    return () => es.close();
  }, [config, applySnapshot, applyDelta, setStatus]);
}
