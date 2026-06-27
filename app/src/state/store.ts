import { create } from "zustand";
import type { Aircraft, AirShowConfig } from "../types";

export type FeedStatus = "idle" | "loading" | "ok" | "error";

const STORAGE_KEY = "airshow.config";

const DEFAULT_CONFIG: AirShowConfig = {
  centerLat: 33.1976,
  centerLon: -96.6153,
  radiusMiles: 30,
  refreshSeconds: 5,
  aircraftScale: 0.3,
  locationLabel: "DFW Area",
  hideGround: true,
  logoOffset: 0.8,
  logoScale: 1.0,
  routeCityNames: true,
  // Thresholds are deliberately well BELOW ATC separation minima (3 NM / 1000 ft):
  // those minima are normal required spacing, so alerting at them flags ordinary
  // traffic. These values target a genuine close call (~TCAS RA territory).
  conflictEnabled: true,
  conflictHorizNm: 1,
  conflictVertFt: 700,
  conflictTighterNearAirport: true,
  conflictNearHorizNm: 0.5,
  conflictNearVertFt: 400,
  autoShowEnabled: false,
};

function loadConfig(): AirShowConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    /* ignore malformed storage */
  }
  return DEFAULT_CONFIG;
}

interface AppState {
  config: AirShowConfig;
  aircraft: Aircraft[];
  status: FeedStatus;
  source: string;
  lastUpdated: number;
  error?: string;
  hoveredHex?: string;

  setConfig: (patch: Partial<AirShowConfig>) => void;
  applySnapshot: (data: {
    aircraft: Aircraft[];
    source: string;
    now: number;
  }) => void;
  applyDelta: (data: {
    updated: Aircraft[];
    removed: string[];
    source: string;
    now: number;
  }) => void;
  setStatus: (status: FeedStatus, error?: string) => void;
  setHovered: (hex?: string) => void;
}

export const useStore = create<AppState>((set) => ({
  config: loadConfig(),
  aircraft: [],
  status: "idle",
  source: "",
  lastUpdated: 0,

  setConfig: (patch) =>
    set((state) => {
      const config = { ...state.config, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      } catch {
        /* ignore */
      }
      return { config };
    }),

  applySnapshot: ({ aircraft, source, now }) =>
    set({
      aircraft,
      source,
      lastUpdated: now,
      status: "ok",
      error: undefined,
    }),

  applyDelta: ({ updated, removed, source, now }) =>
    set((state) => {
      const map = new Map(state.aircraft.map((a) => [a.hex, a]));
      for (const a of updated) map.set(a.hex, a);
      for (const hex of removed) map.delete(hex);
      return {
        aircraft: Array.from(map.values()),
        source,
        lastUpdated: now,
        status: "ok",
        error: undefined,
      };
    }),

  setStatus: (status, error) => set({ status, error }),

  setHovered: (hex) => set({ hoveredHex: hex }),
}));
