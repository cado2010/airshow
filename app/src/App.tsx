import { useEffect, useState } from "react";
import { useStream } from "./data/useStream";
import { CeilingCanvas } from "./render/CeilingCanvas";
import { ConfigPanel } from "./components/ConfigPanel";
import { StatusBar } from "./components/StatusBar";
import { FullscreenButton } from "./components/FullscreenButton";
import { LoginScreen } from "./components/LoginScreen";
import { isAuthed, subscribeAuth } from "./auth/auth";

function MainApp() {
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
      <div className="bottom-bar">
        <StatusBar />
        <FullscreenButton />
      </div>
      <ConfigPanel />
    </div>
  );
}

export default function App() {
  // Token lives in memory only, so every fresh load starts at the login screen.
  const [authed, setAuthed] = useState(isAuthed());
  useEffect(() => subscribeAuth(() => setAuthed(isAuthed())), []);

  if (!authed) return <LoginScreen />;
  return <MainApp />;
}
