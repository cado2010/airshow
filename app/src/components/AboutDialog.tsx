import { useEffect, useState } from "react";

const GITHUB_URL = "https://github.com/cado2010/airshow/";

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    fetch("/version.txt")
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => setVersion(t.trim()))
      .catch(() => {});

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="about-overlay" onClick={onClose}>
      <div
        className="about-dialog"
        role="dialog"
        aria-label="About AirShow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="about-header">
          <span>About AirShow</span>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <h2 className="about-title">
          AirShow <span className="about-sub">live ceiling radar</span>
        </h2>

        <dl className="about-grid">
          <dt>Author</dt>
          <dd>Srikanth Subramanian</dd>
          <dt>Version</dt>
          <dd>{version || "—"}</dd>
          <dt>GitHub</dt>
          <dd>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              {GITHUB_URL}
            </a>
          </dd>
        </dl>
      </div>
    </div>
  );
}
