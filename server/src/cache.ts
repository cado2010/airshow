import { fetchAircraft, type ProviderQuery, type FetchResult } from "./providers.js";

interface CacheEntry {
  at: number;
  result: FetchResult;
}

export interface CachedResult extends FetchResult {
  cached: boolean;
  at: number;
}

/**
 * Caches upstream responses per query and enforces the providers' ~1 req/sec
 * limit. Concurrent identical requests share one in-flight fetch, and a stale
 * last-good value is served if all providers fail.
 */
export class AircraftCache {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<FetchResult>>();
  private lastUpstreamAt = 0;

  constructor(
    // Short TTL dedupes concurrent/burst reads (e.g. REST calls landing next to
    // a stream tick) without starving the ~1s stream poller of fresh data.
    private readonly ttlMs = 500,
    // Keeps total upstream load to ~1 req/sec (providers' limit) across all
    // consumers. Slightly under 1s so the 1s stream poller is never skipped.
    private readonly minUpstreamIntervalMs = 900,
  ) {}

  private key(q: ProviderQuery): string {
    return `${q.lat.toFixed(3)}|${q.lon.toFixed(3)}|${q.distNm}`;
  }

  async get(query: ProviderQuery): Promise<CachedResult> {
    const key = this.key(query);
    const now = Date.now();
    const entry = this.cache.get(key);

    if (entry && now - entry.at < this.ttlMs) {
      return { ...entry.result, cached: true, at: entry.at };
    }

    // Respect the global upstream rate limit; serve stale cache if too soon.
    const sinceLast = now - this.lastUpstreamAt;
    if (sinceLast < this.minUpstreamIntervalMs && entry) {
      return { ...entry.result, cached: true, at: entry.at };
    }

    let pending = this.inflight.get(key);
    if (!pending) {
      this.lastUpstreamAt = Date.now();
      pending = fetchAircraft(query).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }

    try {
      const result = await pending;
      const at = Date.now();
      this.cache.set(key, { at, result });
      return { ...result, cached: false, at };
    } catch (err) {
      if (entry) {
        return { ...entry.result, cached: true, at: entry.at };
      }
      throw err;
    }
  }
}
