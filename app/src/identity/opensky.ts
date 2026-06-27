import { apiFetch } from "../auth/auth";

// Non-blocking client cache for OpenSky track-derived routes (by icao24/hex).
// Mirrors identity/routes.ts: the render loop calls getOpenSky() synchronously
// every frame — it returns the cached value (or undefined while loading) and
// kicks off a background fetch on first use. Rendering never awaits this.

export interface OpenSkyRoute {
  depIcao: string | null;
  arrIcao: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
  callsign: string | null;
}

type CacheValue = OpenSkyRoute | null; // null = looked up, none known
const cache = new Map<string, CacheValue>();
const pending = new Set<string>();

/**
 * Cached OpenSky route for an icao24/hex. Returns undefined while the
 * background lookup is in flight, null when nothing is known, otherwise the
 * route. Safe (and cheap) to call every frame.
 */
export function getOpenSky(hex?: string): CacheValue | undefined {
  if (!hex) return null;
  const key = hex.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  if (!pending.has(key)) {
    pending.add(key);
    void fetchOpenSky(key);
  }
  return undefined;
}

async function fetchOpenSky(hex: string): Promise<void> {
  try {
    const res = await apiFetch(`/api/opensky?icao24=${encodeURIComponent(hex)}`);
    if (res.status === 204 || !res.ok) {
      cache.set(hex, null);
      return;
    }
    cache.set(hex, (await res.json()) as OpenSkyRoute);
  } catch {
    cache.set(hex, null);
  } finally {
    pending.delete(hex);
  }
}
