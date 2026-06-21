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
export const outboundDispatcher = insecureTls
  ? new Agent({
      connect: { rejectUnauthorized: false, timeout: 9_000 },
      // Reuse warm sockets across the ~1s poll cadence (cold connects through a
      // TLS-intercepting proxy can be slow). Header/body timeouts bound a hung
      // socket so a dropped connection fails fast and fails over instead of
      // freezing the whole feed.
      keepAliveTimeout: 10_000,
      headersTimeout: 9_000,
      bodyTimeout: 9_000,
      // Cap sockets per origin so a leak/slow upstream can't accumulate
      // connections unbounded.
      connections: 8,
      pipelining: 1,
    })
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

// Short enough to fail over quickly when a provider hangs (warm sockets to a
// healthy provider respond in well under a second), long enough to tolerate an
// occasional cold TLS connect through the proxy.
const FETCH_TIMEOUT_MS = 4500;

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
      ...(outboundDispatcher ? { dispatcher: outboundDispatcher } : {}),
    } as RequestInit);
    if (!res.ok) {
      // Drain the body so undici returns the socket to the keep-alive pool;
      // otherwise non-OK responses (429/503/etc) leak connections over time
      // until the agent runs out and the whole feed stalls.
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    return normalizeFeed(data);
  } finally {
    clearTimeout(timer);
  }
}

// Remember which provider last worked so we try it first. Otherwise a single
// slow/hanging provider at the head of the list costs a full timeout on every
// poll before failing over, throttling the whole feed.
let preferredIndex = 0;

/** Try each provider, starting with the last good one, until one succeeds. */
export async function fetchAircraft(query: ProviderQuery): Promise<FetchResult> {
  const errors: string[] = [];
  const order = [
    preferredIndex,
    ...PROVIDERS.map((_, i) => i).filter((i) => i !== preferredIndex),
  ];
  for (const idx of order) {
    const provider = PROVIDERS[idx];
    try {
      const aircraft = await fetchProvider(provider, query);
      preferredIndex = idx;
      return { source: provider.name, aircraft };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.name}: ${msg}`);
    }
  }
  throw new Error(`All providers failed -> ${errors.join("; ")}`);
}
