import { useStream } from "./data/useStream";
import { CeilingCanvas } from "./render/CeilingCanvas";
import { ConfigPanel } from "./components/ConfigPanel";
import { StatusBar } from "./components/StatusBar";

export default function App() {
  useStream();

  return (
    <div className="app">
      <CeilingCanvas />
      <header className="app-title">
        AirShow <span className="phase">Phase 1 · ceiling dot-map</span>
      </header>
      <StatusBar />
      <ConfigPanel />
    </div>
  );
}
