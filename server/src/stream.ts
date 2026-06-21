import type { Response } from "express";
import type { AircraftCache } from "./cache.js";
import type { ReplayBuffer } from "./replayBuffer.js";
import type { ProviderQuery } from "./providers.js";
import type { Aircraft } from "./types.js";

interface Client {
  id: number;
  res: Response;
}

interface Region {
  key: string;
  query: ProviderQuery;
  clients: Map<number, Client>;
  timer: ReturnType<typeof setInterval> | null;
  initialized: boolean;
  prev: Map<string, Aircraft>;
  lastNow: number;
  lastSource: string;
  ticks: number;
}

/** Fields whose change marks an aircraft as "updated" in a delta. */
function changed(a: Aircraft, b: Aircraft): boolean {
  return (
    a.lat !== b.lat ||
    a.lon !== b.lon ||
    a.altFt !== b.altFt ||
    a.headingDeg !== b.headingDeg ||
    a.groundSpeedKt !== b.groundSpeedKt ||
    a.verticalRateFpm !== b.verticalRateFpm ||
    a.onGround !== b.onGround ||
    a.callsign !== b.callsign ||
    a.typeCode !== b.typeCode
  );
}

/**
 * Manages one upstream poll loop per unique region and fans out SSE updates to
 * all subscribed clients. The first message a client receives is a full
 * `snapshot`; subsequent messages are `delta`s (changed + removed only).
 */
export class StreamHub {
  private regions = new Map<string, Region>();
  private nextClientId = 1;

  constructor(
    private readonly cache: AircraftCache,
    private readonly replay: ReplayBuffer,
    private readonly intervalMs = 1000,
  ) {}

  private regionKey(q: ProviderQuery): string {
    return `${q.lat.toFixed(3)}|${q.lon.toFixed(3)}|${q.distNm}`;
  }

  addClient(query: ProviderQuery, res: Response): () => void {
    const key = this.regionKey(query);
    let region = this.regions.get(key);
    if (!region) {
      region = {
        key,
        query,
        clients: new Map(),
        timer: null,
        initialized: false,
        prev: new Map(),
        lastNow: 0,
        lastSource: "",
        ticks: 0,
      };
      this.regions.set(key, region);
      void this.poll(region);
      region.timer = setInterval(() => void this.poll(region!), this.intervalMs);
    }

    const client: Client = { id: this.nextClientId++, res };
    region.clients.set(client.id, client);

    // Late joiner: hand them the current world immediately.
    if (region.initialized) {
      this.send(client, {
        type: "snapshot",
        now: region.lastNow,
        source: region.lastSource,
        aircraft: Array.from(region.prev.values()),
      });
    }

    return () => this.removeClient(key, client.id);
  }

  private removeClient(key: string, id: number): void {
    const region = this.regions.get(key);
    if (!region) return;
    region.clients.delete(id);
    if (region.clients.size === 0) {
      if (region.timer) clearInterval(region.timer);
      this.regions.delete(key);
    }
  }

  private async poll(region: Region): Promise<void> {
    let result;
    try {
      result = await this.cache.get(region.query);
    } catch {
      return; // keep the loop alive; try again next tick
    }

    region.lastNow = result.at;
    region.lastSource = result.cached
      ? `${result.source} (cache)`
      : result.source;

    if (!result.cached) {
      this.replay.push({ at: result.at, aircraft: result.aircraft });
    }

    const newMap = new Map<string, Aircraft>(
      result.aircraft.map((a) => [a.hex, a]),
    );

    if (!region.initialized) {
      region.initialized = true;
      region.prev = newMap;
      this.broadcast(region, {
        type: "snapshot",
        now: region.lastNow,
        source: region.lastSource,
        aircraft: result.aircraft,
      });
      return;
    }

    const updated: Aircraft[] = [];
    for (const [hex, a] of newMap) {
      const prev = region.prev.get(hex);
      if (!prev || changed(prev, a)) updated.push(a);
    }
    const removed: string[] = [];
    for (const hex of region.prev.keys()) {
      if (!newMap.has(hex)) removed.push(hex);
    }
    region.prev = newMap;

    region.ticks++;
    if (updated.length || removed.length) {
      this.broadcast(region, {
        type: "delta",
        now: region.lastNow,
        source: region.lastSource,
        updated,
        removed,
      });
    } else if (region.ticks % 15 === 0) {
      // Heartbeat keeps proxies/connections from idling out.
      for (const client of region.clients.values()) {
        this.write(region, client, ": ping\n\n");
      }
    }

    // If every client dropped (e.g. all sockets died), stop polling upstream
    // for this region so dead regions don't keep hitting the providers.
    if (region.clients.size === 0 && region.timer) {
      clearInterval(region.timer);
      region.timer = null;
      this.regions.delete(region.key);
    }
  }

  private broadcast(region: Region, payload: unknown): void {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of region.clients.values()) {
      this.write(region, client, frame);
    }
  }

  private send(client: Client, payload: unknown): void {
    client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  /** Write to one client, dropping it if its socket has gone away. */
  private write(region: Region, client: Client, frame: string): void {
    try {
      client.res.write(frame);
    } catch {
      region.clients.delete(client.id);
      try {
        client.res.end();
      } catch {
        /* already closed */
      }
    }
  }
}
