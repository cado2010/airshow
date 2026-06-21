import { useState } from "react";
import { useStore } from "../state/store";
import type { AirShowConfig } from "../types";

const PRESETS: Record<string, { centerLat: number; centerLon: number }> = {
  "DFW Area": { centerLat: 33.1976, centerLon: -96.6153 },
  "DFW Airport": { centerLat: 32.8998, centerLon: -97.0403 },
  Heathrow: { centerLat: 51.47, centerLon: -0.4543 },
  JFK: { centerLat: 40.6413, centerLon: -73.7781 },
  Bangalore: { centerLat: 13.1986, centerLon: 77.7066 },
};

export function ConfigPanel() {
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);
  const [open, setOpen] = useState(true);

  const update = (patch: Partial<AirShowConfig>) => setConfig(patch);

  if (!open) {
    return (
      <button className="config-toggle" onClick={() => setOpen(true)}>
        Config
      </button>
    );
  }

  return (
    <div className="config-panel">
      <div className="config-header">
        <span>Configuration</span>
        <button onClick={() => setOpen(false)}>×</button>
      </div>

      <label>
        Preset
        <select
          value=""
          onChange={(e) => {
            const p = PRESETS[e.target.value];
            if (p) update(p);
          }}
        >
          <option value="">Choose…</option>
          {Object.keys(PRESETS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Center latitude
        <input
          type="number"
          step="0.0001"
          value={config.centerLat}
          onChange={(e) => update({ centerLat: Number(e.target.value) })}
        />
      </label>

      <label>
        Center longitude
        <input
          type="number"
          step="0.0001"
          value={config.centerLon}
          onChange={(e) => update({ centerLon: Number(e.target.value) })}
        />
      </label>

      <label>
        Radius (miles)
        <input
          type="number"
          min={1}
          max={150}
          value={config.radiusMiles}
          onChange={(e) => update({ radiusMiles: Number(e.target.value) })}
        />
      </label>

      <p className="config-note">Live stream · server pushes updates ~1×/sec</p>
    </div>
  );
}
