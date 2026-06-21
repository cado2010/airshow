import { create } from "zustand";
import type { Aircraft, AirShowConfig } from "../types";

export type FeedStatus = "idle" | "loading" | "ok" | "error";

const STORAGE_KEY = "airshow.config";

const DEFAULT_CONFIG: AirShowConfig = {
  centerLat: 33.1976,
  centerLon: -96.6153,
  radiusMiles: 50,
  refreshSeconds: 5,
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
