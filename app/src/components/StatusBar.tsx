import { useStore } from "../state/store";

export function StatusBar() {
  const status = useStore((s) => s.status);
  const source = useStore((s) => s.source);
  const error = useStore((s) => s.error);
  const count = useStore((s) => s.aircraft.length);
  const lastUpdated = useStore((s) => s.lastUpdated);

  const dotClass =
    status === "ok" ? "ok" : status === "error" ? "error" : "loading";

  const updated = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString()
    : "—";

  return (
    <div className="status-bar">
      <span className={`status-dot ${dotClass}`} />
      <strong>{count}</strong>
      <span className="muted">aircraft</span>
      <span className="sep">·</span>
      <span className="muted">{error ? error : source || "connecting…"}</span>
      <span className="sep">·</span>
      <span className="muted">{updated}</span>
    </div>
  );
}
