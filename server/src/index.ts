import http from "node:http";
import https from "node:https";
import express from "express";
import cors from "cors";
import { AircraftCache } from "./cache.js";
import { ReplayBuffer } from "./replayBuffer.js";
import { StreamHub } from "./stream.js";
import { outboundDispatcher } from "./providers.js";
import { lookupRoute } from "./routes.js";
import { lookupOpenSky, openSkyEnabled } from "./opensky.js";
import { loginHandler, meHandler, requireAuth } from "./auth.js";
import { createAccessLogger } from "./accesslog.js";
import type { AircraftResponse } from "./types.js";

const MAX_DIST_NM = 250;

export interface ServerOptions {
  /** TCP port to listen on (0 = OS-assigned free port). */
  port?: number;
  /** Directory of the built frontend to serve (Electron/standalone builds). */
  staticDir?: string;
  /** PEM key+cert to terminate TLS. When set the server listens over HTTPS. */
  tls?: { key: string; cert: string };
  /** Require a JWT (from /api/login) on every /api route except login/health. */
  auth?: boolean;
  /** When set, append a JSON-lines access log (ts, WAN IP, user, ...) to this file. */
  accessLog?: string;
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

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

/** Build the Express app (API + optional static frontend) without listening. */
export function createApp(opts: ServerOptions = {}): express.Express {
  const cache = new AircraftCache();
  const replay = new ReplayBuffer();
  const hub = new StreamHub(cache, replay);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // Access log (after body parsing so the login email is available, before the
  // auth gate; it logs on response finish, by which point req.user is set).
  if (opts.accessLog) {
    app.use(createAccessLogger(opts.accessLog));
  }

  // Auth gate: /api/login issues a JWT; everything else under /api requires it.
  // Public exceptions: /login, /health, /me (which checks the token itself).
  // The static frontend stays public so the SPA + login screen can load. The
  // SSE client passes the token via ?token= since EventSource can't set headers.
  if (opts.auth) {
    app.post("/api/login", loginHandler);
    app.get("/api/me", requireAuth, meHandler);
    app.use("/api", (req, res, next) => {
      if (req.path === "/login" || req.path === "/health" || req.path === "/me") {
        next();
        return;
      }
      requireAuth(req, res, next);
    });
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, replay: replay.span });
  });

  // Approximate location from public IP (fallback when browser geo fails).
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
          [d.city, d.regionName].filter(Boolean).join(", ") ||
          "Current location",
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Flight origin/destination by callsign (cached). 204 when unknown.
  app.get("/api/route", async (req, res) => {
    const callsign =
      typeof req.query.callsign === "string" ? req.query.callsign : "";
    if (!callsign.trim()) {
      res.status(400).json({ error: "callsign is required" });
      return;
    }
    try {
      const route = await lookupRoute(callsign);
      if (!route) {
        res.status(204).end();
        return;
      }
      res.json(route);
    } catch (err) {
      res
        .status(502)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Track-derived origin/destination by icao24 (OpenSky). 204 when unknown or
  // the feature is disabled (no credentials).
  app.get("/api/opensky", async (req, res) => {
    if (!openSkyEnabled) {
      res.status(204).end();
      return;
    }
    const icao24 = typeof req.query.icao24 === "string" ? req.query.icao24 : "";
    if (!icao24.trim()) {
      res.status(400).json({ error: "icao24 is required" });
      return;
    }
    try {
      const route = await lookupOpenSky(icao24);
      if (!route) {
        res.status(204).end();
        return;
      }
      res.json(route);
    } catch (err) {
      res
        .status(502)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Server-Sent Events stream: full snapshot on connect, then deltas.
  app.get("/api/stream", (req, res) => {
    const query = parseQuery(req);
    if (!query) {
      res
        .status(400)
        .json({ error: "lat, lon and dist (nm, > 0) are required" });
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

  // Serve the built frontend (Electron/standalone). In dev this is unset and
  // Vite serves the UI instead.
  if (opts.staticDir) {
    app.use(express.static(opts.staticDir));
  }

  return app;
}

/** Build and start the server, resolving once it is listening. */
export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const app = createApp(opts);
  const requestedPort =
    opts.port ?? Number(process.env.PORT ?? 8787);

  // HTTPS when a key+cert are supplied (exposed standalone host), plain HTTP
  // otherwise (Electron loopback, dev). Same Express app either way.
  const server = opts.tls
    ? https.createServer({ key: opts.tls.key, cert: opts.tls.cert }, app)
    : http.createServer(app);

  return new Promise((resolve, reject) => {
    server.listen(requestedPort, () => {
      const addr = server.address();
      const port =
        typeof addr === "object" && addr ? addr.port : requestedPort;
      const proto = opts.tls ? "https" : "http";
      console.log(`[airshow] proxy listening on ${proto}://localhost:${port}`);
      resolve({
        port,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
    server.on("error", reject);
  });
}
