import { outboundDispatcher } from "./providers.js";

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

interface CacheEntry {
  value: FlightRoute | null;
  at: number;
}

// Routes are essentially static per callsign for the life of a flight, so cache
// hard. Negative results (unknown callsign) are cached for a shorter window so a
// callsign that gets a route later isn't blocked for hours.
const POSITIVE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 60 * 1000;

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<FlightRoute | null>>();

interface AdsbdbAirport {
  iata_code?: string;
  icao_code?: string;
  name?: string;
  municipality?: string;
  country_name?: string;
}

interface AdsbdbResponse {
  response?:
    | string
    | {
        flightroute?: {
          callsign?: string;
          origin?: AdsbdbAirport;
          destination?: AdsbdbAirport;
        };
      };
}

function mapAirport(a?: AdsbdbAirport): RouteAirport | undefined {
  if (!a) return undefined;
  return {
    iata: a.iata_code || undefined,
    icao: a.icao_code || undefined,
    name: a.name || undefined,
    municipality: a.municipality || undefined,
    countryName: a.country_name || undefined,
  };
}

async function fetchRoute(callsign: string): Promise<FlightRoute | null> {
  const url = `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "AirShow/0.1" },
    ...(outboundDispatcher ? { dispatcher: outboundDispatcher } : {}),
  } as RequestInit);

  // 404 => unknown callsign; treat as a (cached) negative result. Drain the
  // body on every non-JSON path so undici releases the keep-alive socket.
  if (res.status === 404) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`adsbdb ${res.status}`);
  }

  const data = (await res.json()) as AdsbdbResponse;
  if (!data.response || typeof data.response === "string") return null;
  const fr = data.response.flightroute;
  if (!fr) return null;

  const origin = mapAirport(fr.origin);
  const destination = mapAirport(fr.destination);
  if (!origin && !destination) return null;
  return { callsign, origin, destination };
}

/**
 * Look up a flight's origin/destination by callsign, with positive/negative
 * caching and in-flight de-duplication. Returns null when no route is known.
 */
export async function lookupRoute(
  rawCallsign: string,
): Promise<FlightRoute | null> {
  const callsign = rawCallsign.trim().toUpperCase();
  if (!callsign) return null;

  const now = Date.now();
  const hit = cache.get(callsign);
  if (hit) {
    const ttl = hit.value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    if (now - hit.at < ttl) return hit.value;
  }

  const existing = inflight.get(callsign);
  if (existing) return existing;

  const p = fetchRoute(callsign)
    .then((value) => {
      cache.set(callsign, { value, at: Date.now() });
      return value;
    })
    .finally(() => inflight.delete(callsign));

  inflight.set(callsign, p);
  return p;
}
