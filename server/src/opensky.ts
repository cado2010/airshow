import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outboundDispatcher } from "./providers.js";

// OpenSky Network — free, track-derived per-leg origin/destination by icao24.
// Used to fill the "far end" the local trajectory can't see. All lookups are
// cached; the client calls this lazily and never blocks rendering on it.

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const API = "https://opensky-network.org/api";

export interface OpenSkyRoute {
  depIcao: string | null;
  arrIcao: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
  callsign: string | null;
}

interface Creds {
  clientId: string;
  clientSecret: string;
}

function loadCreds(): Creds | null {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (id && secret) return { clientId: id, clientSecret: secret };

  // Resolve the module directory across runtimes: __dirname exists in the
  // esbuild CJS bundle (packaged app); under tsx/ESM dev it doesn't, so fall
  // back to the repo root via process.cwd().
  const here =
    typeof __dirname !== "undefined" ? __dirname : process.cwd();
  const candidates = [
    process.env.AIRSHOW_OPENSKY_CREDS,
    join(process.cwd(), "server", "creds", "opensky_credentials.json"),
    join(here, "creds", "opensky_credentials.json"),
    join(here, "..", "creds", "opensky_credentials.json"),
    join(here, "..", "server", "creds", "opensky_credentials.json"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      const raw = readFileSync(p, "utf8");
      const j = JSON.parse(raw) as Partial<Creds>;
      if (j.clientId && j.clientSecret) {
        return { clientId: j.clientId, clientSecret: j.clientSecret };
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

const creds = loadCreds();
export const openSkyEnabled = creds !== null;
if (!openSkyEnabled) {
  console.warn("[airshow] OpenSky credentials not found — far-end routes disabled");
}

let token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  if (!creds) return null;
  if (token && Date.now() < token.expiresAt) return token.value;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    ...(outboundDispatcher ? { dispatcher: outboundDispatcher } : {}),
  } as RequestInit);
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`opensky token ${res.status}`);
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = {
    value: j.access_token,
    expiresAt: Date.now() + (j.expires_in - 30) * 1000,
  };
  return token.value;
}

interface CacheEntry {
  value: OpenSkyRoute | null;
  at: number;
}
const POSITIVE_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<OpenSkyRoute | null>>();

interface OpenSkyFlight {
  icao24: string;
  firstSeen: number | null;
  lastSeen: number | null;
  estDepartureAirport: string | null;
  estArrivalAirport: string | null;
  callsign: string | null;
}

async function fetchFlights(icao24: string): Promise<OpenSkyRoute | null> {
  const tok = await getToken();
  if (!tok) return null;

  const end = Math.floor(Date.now() / 1000);
  const begin = end - 18 * 60 * 60; // last 18h covers the current/most-recent leg
  const url = `${API}/flights/aircraft?icao24=${encodeURIComponent(
    icao24.toLowerCase(),
  )}&begin=${begin}&end=${end}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tok}`, "User-Agent": "AirShow/0.1" },
    ...(outboundDispatcher ? { dispatcher: outboundDispatcher } : {}),
  } as RequestInit);

  if (res.status === 404) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`opensky flights ${res.status}`);
  }

  const flights = (await res.json()) as OpenSkyFlight[];
  if (!Array.isArray(flights) || flights.length === 0) return null;

  // Most recent leg by lastSeen.
  const f = flights.reduce((a, b) => ((b.lastSeen ?? 0) > (a.lastSeen ?? 0) ? b : a));
  return {
    depIcao: f.estDepartureAirport,
    arrIcao: f.estArrivalAirport,
    firstSeen: f.firstSeen,
    lastSeen: f.lastSeen,
    callsign: f.callsign ? f.callsign.trim() : null,
  };
}

/** Cached, de-duplicated OpenSky lookup by icao24. null = none known. */
export async function lookupOpenSky(icao24: string): Promise<OpenSkyRoute | null> {
  const key = icao24.trim().toLowerCase();
  if (!key || !creds) return null;

  const now = Date.now();
  const hit = cache.get(key);
  if (hit) {
    const ttl = hit.value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    if (now - hit.at < ttl) return hit.value;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = fetchFlights(key)
    .then((value) => {
      cache.set(key, { value, at: Date.now() });
      return value;
    })
    .catch((err) => {
      // Cache a short negative on error so we don't hammer the API.
      cache.set(key, { value: null, at: Date.now() });
      throw err;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}
