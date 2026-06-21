import { Agent } from "undici";
import { normalizeFeed } from "./normalize.js";
import type { Aircraft } from "./types.js";

/**
 * Some networks (corporate proxy / AV) intercept TLS, which makes Node's fetch
 * reject the provider certificates (UNABLE_TO_VERIFY_LEAF_SIGNATURE). When
 * AIRSHOW_INSECURE_TLS !== "0", route only these outbound provider calls
 * through a dispatcher that tolerates the intercepted cert. This does NOT
 * affect TLS verification anywhere else in the process.
 */
const insecureTls = process.env.AIRSHOW_INSECURE_TLS !== "0";
const dispatcher = insecureTls
  ? new Agent({ connect: { rejectUnauthorized: false } })
  : undefined;

export interface ProviderQuery {
  lat: number;
  lon: number;
  /** Search radius in nautical miles (provider max 250). */
  distNm: number;
}

interface Provider {
  name: string;
  url: (q: ProviderQuery) => string;
}

/**
 * Free, no-key, ADSBexchange-v2 compatible community providers.
 * Tried in this order; first success wins.
 */
const PROVIDERS: Provider[] = [
  {
    name: "adsb.lol",
    url: ({ lat, lon, distNm }) =>
      `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${distNm}`,
  },
  {
    name: "adsb.fi",
    url: ({ lat, lon, distNm }) =>
      `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${distNm}`,
  },
  {
    name: "airplanes.live",
    url: ({ lat, lon, distNm }) =>
      `https://api.airplanes.live/v2/point/${lat}/${lon}/${distNm}`,
  },
];

export interface FetchResult {
  source: string;
  aircraft: Aircraft[];
}

const FETCH_TIMEOUT_MS = 8000;

async function fetchProvider(
  provider: Provider,
  query: ProviderQuery,
): Promise<Aircraft[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(provider.url(query), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "AirShow/0.1 (local ceiling projection app)",
      },
      // `dispatcher` is a Node/undici extension not present in DOM fetch types.
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    return normalizeFeed(data);
  } finally {
    clearTimeout(timer);
  }
}

/** Try each provider in order until one succeeds. */
export async function fetchAircraft(query: ProviderQuery): Promise<FetchResult> {
  const errors: string[] = [];
  for (const provider of PROVIDERS) {
    try {
      const aircraft = await fetchProvider(provider, query);
      return { source: provider.name, aircraft };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.name}: ${msg}`);
    }
  }
  throw new Error(`All providers failed -> ${errors.join("; ")}`);
}
