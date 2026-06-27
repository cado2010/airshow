import { apiFetch } from "../auth/auth";

export interface RouteAirport {
  iata?: string;
  icao?: string;
  name?: string;
  municipality?: string;
  countryName?: string;
}

export interface FlightRoute {
  callsign: string;
  origin?: RouteAirport;
  destination?: RouteAirport;
}

type CacheValue = FlightRoute | null; // null = looked up, none known
const cache = new Map<string, CacheValue>();
const pending = new Set<string>();

/**
 * Returns the cached route for a callsign, or undefined while unknown. The
 * first call for a callsign kicks off an async fetch; the continuous render
 * loop will pick up the result on a later frame. null means "looked up, no
 * route available".
 */
export function getRoute(callsign?: string): CacheValue | undefined {
  if (!callsign) return null;
  const key = callsign.trim().toUpperCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  if (!pending.has(key)) {
    pending.add(key);
    void fetchRoute(key);
  }
  return undefined;
}

async function fetchRoute(callsign: string): Promise<void> {
  try {
    const res = await apiFetch(`/api/route?callsign=${encodeURIComponent(callsign)}`);
    if (res.status === 204) {
      cache.set(callsign, null);
      return;
    }
    if (!res.ok) {
      cache.set(callsign, null);
      return;
    }
    cache.set(callsign, (await res.json()) as FlightRoute);
  } catch {
    cache.set(callsign, null);
  } finally {
    pending.delete(callsign);
  }
}

/** Short code for an airport: IATA preferred, then ICAO, then municipality. */
export function airportCode(a?: RouteAirport): string | undefined {
  if (!a) return undefined;
  return a.iata || a.icao || a.municipality || undefined;
}

/** City/municipality for an airport, falling back to the short code. */
export function airportCity(a?: RouteAirport): string | undefined {
  if (!a) return undefined;
  return a.municipality || airportCode(a);
}
