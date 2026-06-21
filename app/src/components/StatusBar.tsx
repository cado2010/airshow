import { useEffect, useState } from "react";
import { useStore } from "../state/store";

// Data arrives ~1×/sec; classify the feed by how long since the last update.
const LAGGING_MS = 5_000;
const STALE_MS = 12_000;

export function StatusBar() {
  const status = useStore((s) => s.status);
  const source = useStore((s) => s.source);
  const error = useStore((s) => s.error);
  const count = useStore((s) => s.aircraft.length);
  const lastUpdated = useStore((s) => s.lastUpdated);

  // Re-render on a timer so staleness is reflected even when no data arrives
  // (a frozen feed never triggers a store update on its own).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const age = lastUpdated ? now - lastUpdated : Infinity;

  let health: "live" | "lagging" | "stale";
  if (status === "error" || age > STALE_MS) health = "stale";
  else if (status !== "ok" || age > LAGGING_MS) health = "lagging";
  else health = "live";

  const dotClass =
    health === "live" ? "ok" : health === "lagging" ? "loading" : "error";

  const ageText =
    !lastUpdated
      ? "—"
      : age < 2000
        ? "live"
        : `${Math.round(age / 1000)}s ago`;

  const detail =
    health === "stale" && lastUpdated
      ? error || "feed stalled — reconnecting…"
      : error || source || "connecting…";

  return (
    <div className="status-bar">
      <span className={`status-dot ${dotClass}`} />
      <strong>{count}</strong>
      <span className="muted">aircraft</span>
      <span className="sep">·</span>
      <span className="muted">{detail}</span>
      <span className="sep">·</span>
      <span className="muted">{ageText}</span>
    </div>
  );
}
