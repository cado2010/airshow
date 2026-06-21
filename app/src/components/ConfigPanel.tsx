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
  const [geoStatus, setGeoStatus] = useState<string>("");

  const update = (patch: Partial<AirShowConfig>) => setConfig(patch);

  // Falls back to server IP-based geolocation when the browser's WiFi/network
  // location service is unavailable.
  const geolocateByIp = async () => {
    try {
      const res = await fetch("/api/geolocate");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { lat: number; lon: number; label: string };
      update({
        centerLat: Number(d.lat.toFixed(4)),
        centerLon: Number(d.lon.toFixed(4)),
        locationLabel: d.label || "Current location",
      });
      setGeoStatus("");
    } catch (err) {
      setGeoStatus(
        `Location failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const useCurrentLocation = () => {
    setGeoStatus("Locating…");
    if (!navigator.geolocation) {
      void geolocateByIp();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        update({
          centerLat: Number(pos.coords.latitude.toFixed(4)),
          centerLon: Number(pos.coords.longitude.toFixed(4)),
          locationLabel: "Current location",
        });
        setGeoStatus("");
      },
      // Browser geo failed (e.g. network location service blocked) -> use IP.
      () => void geolocateByIp(),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  };

  const onPreset = (value: string) => {
    if (value === "__current__") {
      useCurrentLocation();
      return;
    }
    const p = PRESETS[value];
    if (p) update({ ...p, locationLabel: value });
  };

  // Reflect the current selection in the dropdown.
  const presetMatch = Object.keys(PRESETS).find((name) => {
    const p = PRESETS[name];
    return p.centerLat === config.centerLat && p.centerLon === config.centerLon;
  });
  const selectValue = presetMatch ?? "__custom__";
  const customLabel = config.locationLabel || "Custom";

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
        Location
        <select value={selectValue} onChange={(e) => onPreset(e.target.value)}>
          {selectValue === "__custom__" && (
            <option value="__custom__">{customLabel}</option>
          )}
          <option value="__current__">📍 Current location</option>
          {Object.keys(PRESETS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {geoStatus && <p className="config-note">{geoStatus}</p>}

      <label>
        Center latitude
        <input
          type="number"
          step="0.0001"
          value={config.centerLat}
          onChange={(e) =>
            update({ centerLat: Number(e.target.value), locationLabel: "Custom" })
          }
        />
      </label>

      <label>
        Center longitude
        <input
          type="number"
          step="0.0001"
          value={config.centerLon}
          onChange={(e) =>
            update({ centerLon: Number(e.target.value), locationLabel: "Custom" })
          }
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

      <label>
        Aircraft size · {Math.round(config.aircraftScale * 100)}%
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={config.aircraftScale}
          onChange={(e) => update({ aircraftScale: Number(e.target.value) })}
        />
      </label>

      <label>
        Logo offset · {Math.round(config.logoOffset * 100)}%
        <input
          type="range"
          min={0}
          max={2.5}
          step={0.1}
          value={config.logoOffset}
          onChange={(e) => update({ logoOffset: Number(e.target.value) })}
        />
      </label>

      <label className="config-check">
        <input
          type="checkbox"
          checked={config.hideGround}
          onChange={(e) => update({ hideGround: e.target.checked })}
        />
        Hide aircraft on the ground
      </label>

      <p className="config-note">Live stream · server pushes updates ~1×/sec</p>
    </div>
  );
}
