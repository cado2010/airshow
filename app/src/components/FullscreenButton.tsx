import { useEffect, useState } from "react";

// Cross-browser fullscreen, including older WebKit (Safari) prefixes.
type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

const docEl = document.documentElement as FsEl;
const fsSupported =
  typeof docEl.requestFullscreen === "function" ||
  typeof docEl.webkitRequestFullscreen === "function";

function fsActive(): boolean {
  const d = document as FsDoc;
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}

// Running as an installed app (Android PWA / iOS "Add to Home Screen") — there's
// no browser chrome to toggle, so the button is unnecessary.
//
// NOTE: deliberately does NOT test `display-mode: fullscreen`. That media query
// also matches while the Fullscreen API is active, so testing it here would make
// the button try to unmount the instant we enter fullscreen — and because this
// value gates an early return, that changed the hook count between renders and
// threw React error #300 ("rendered fewer hooks than expected"), blanking the
// whole app. Evaluate once at mount and only for genuinely installed PWAs.
function isInstalled(): boolean {
  const mm = window.matchMedia;
  return Boolean(
    (mm && mm("(display-mode: standalone)").matches) ||
      (navigator as unknown as { standalone?: boolean }).standalone === true,
  );
}

/**
 * Toggles full screen. Uses the Fullscreen API (with WebKit fallback) where
 * available — desktop browsers, the Electron shell, and Android Chrome. On iOS
 * Safari (no Fullscreen API for non-video) it falls back to an "immersive" mode
 * that hides the on-screen chrome to maximize the radar; true fullscreen there
 * comes from installing via Add to Home Screen (see PWA manifest).
 */
export function FullscreenButton() {
  const [active, setActive] = useState(false);
  // Evaluate installed-PWA state once at mount. Doing this as a hook (and never
  // conditionally) keeps the hook order stable across renders.
  const [installed] = useState(isInstalled);

  const enter = () => {
    if (fsSupported) {
      (docEl.requestFullscreen ?? docEl.webkitRequestFullscreen)?.call(docEl);
    } else {
      document.documentElement.classList.add("immersive");
      setActive(true);
    }
  };
  const exit = () => {
    if (fsSupported) {
      const d = document as FsDoc;
      (d.exitFullscreen ?? d.webkitExitFullscreen)?.call(d);
    } else {
      document.documentElement.classList.remove("immersive");
      setActive(false);
    }
  };
  const toggle = () => (active ? exit() : enter());

  useEffect(() => {
    const onChange = () => {
      if (fsSupported) setActive(fsActive());
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Safe early return: it comes AFTER every hook, so the hook count never
  // changes between renders.
  if (installed) return null;

  return (
    <button
      className="fullscreen-btn"
      onClick={toggle}
      title="Toggle full screen (F11)"
    >
      {active ? "\u{1F87C} Exit full screen" : "\u26F6 Full screen"}
    </button>
  );
}
