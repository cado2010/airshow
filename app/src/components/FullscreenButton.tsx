import { useEffect, useState } from "react";

/** Toggles real full screen (like the browser's F11) via the Fullscreen API.
 *  Works the same in a normal browser tab and inside the Electron shell. */
export function FullscreenButton() {
  const [isFull, setIsFull] = useState(false);

  const toggle = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);

    // Let F11 drive the same Fullscreen API path everywhere.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <button
      className="fullscreen-btn"
      onClick={toggle}
      title="Toggle full screen (F11)"
    >
      {isFull ? "🡼 Exit full screen" : "⛶ Full screen"}
    </button>
  );
}
