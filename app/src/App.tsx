import { useEffect, useState } from "react";
import { useStream } from "./data/useStream";
import { CeilingCanvas } from "./render/CeilingCanvas";
import { ConfigPanel } from "./components/ConfigPanel";
import { StatusBar } from "./components/StatusBar";
import { FullscreenButton } from "./components/FullscreenButton";

export default function App() {
  useStream();
  const [version, setVersion] = useState("");

  useEffect(() => {
    fetch("/version.txt")
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => setVersion(t.trim()))
      .catch(() => {});
  }, []);

  return (
    <div className="app">
      <CeilingCanvas />
      <header className="app-title">
        AirShow <span className="phase">live ceiling radar</span>
        {version && <span className="version">{version}</span>}
      </header>
      <StatusBar />
      <FullscreenButton />
      <ConfigPanel />
    </div>
  );
}
