import express from "express";
import cors from "cors";
import { AircraftCache } from "./cache.js";
import { ReplayBuffer } from "./replayBuffer.js";
import { StreamHub } from "./stream.js";
import { outboundDispatcher } from "./providers.js";
import type { AircraftResponse } from "./types.js";

const PORT = Number(process.env.PORT ?? 8787);
const MAX_DIST_NM = 250;

const cache = new AircraftCache();
const replay = new ReplayBuffer();
const hub = new StreamHub(cache, replay);

const app = express();
app.use(cors());

function parseQuery(req: express.Request): {
  lat: number;
  lon: number;
  distNm: number;
} | null {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const distNm = Math.min(Number(req.query.dist) || 0, MAX_DIST_NM);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || distNm <= 0) return null;
  return { lat, lon, distNm };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, replay: replay.span });
});

/** Approximate location from public IP (fallback when browser geo fails). */
app.get("/api/geolocate", async (_req, res) => {
  try {
    const r = await fetch(
      "http://ip-api.com/json/?fields=status,message,lat,lon,city,regionName",
      {
        headers: { "User-Agent": "AirShow/0.1" },
        ...(outboundDispatcher ? { dispatcher: outboundDispatcher } : {}),
      } as RequestInit,
    );
    const d = (await r.json()) as {
      status?: string;
      message?: string;
      lat?: number;
      lon?: number;
      city?: string;
      regionName?: string;
    };
    if (d.status !== "success" || typeof d.lat !== "number") {
      throw new Error(d.message || "IP lookup failed");
    }
    res.json({
      lat: d.lat,
      lon: d.lon,
      label:
        [d.city, d.regionName].filter(Boolean).join(", ") || "Current location",
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** Server-Sent Events stream: full snapshot on connect, then deltas. */
app.get("/api/stream", (req, res) => {
  const query = parseQuery(req);
  if (!query) {
    res.status(400).json({ error: "lat, lon and dist (nm, > 0) are required" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write("retry: 2000\n\n");

  const unsubscribe = hub.addClient(query, res);
  req.on("close", unsubscribe);
});

app.get("/api/aircraft", async (req, res) => {
  const query = parseQuery(req);
  if (!query) {
    res
      .status(400)
      .json({ error: "lat, lon and dist (nm, > 0) query params are required" });
    return;
  }

  try {
    const result = await cache.get(query);
    const payload: AircraftResponse = {
      now: result.at,
      source: result.cached ? `${result.source} (cache)` : result.source,
      cached: result.cached,
      aircraft: result.aircraft,
    };
    res.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`[airshow] proxy listening on http://localhost:${PORT}`);
});
