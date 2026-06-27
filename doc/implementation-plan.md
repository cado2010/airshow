# AirShow — Implementation Plan

This plan turns [`doc/airshow.md`](./airshow.md) into a concrete, phased build.

## Confirmed decisions

- **Projection:** Planar (north-up, top-down) for V1, behind a swappable `Projection` interface so a sky-dome/fisheye mode can drop in later. Altitude → size/brightness/opacity (per the spec's tables).
- **Backend:** Minimal local Node proxy sidecar (CORS, provider failover across adsb.lol → adsb.fi → airplanes.live, request caching at ≤1 req/s, and the replay ring buffer).
- **Logos:** ICAO-keyed airline logo repository. Primary: `Jxck-S/airline-logos` (large, ICAO-keyed, used across the ADS-B community); clean-license fallback: `soaring-symbols` (MIT, programmatic ICAO lookup). Downloaded once into `/assets/logos`, never hotlinked (per spec).
- **3D models:** Well-rendered, properly shaded GLB aircraft per class (PBR materials, real lighting, shadows) — **not** low-poly placeholders. Source license-clean, quality models (CC0/CC-BY) per class and store locally in `/assets/models`.
- **Tooling defaults:** npm, Node 20+, default config = DFW-area coords (33.1976, -96.6153), 50 mi radius, 5 s refresh.
- **Process:** Implementation plan reviewed/approved before code is written.

## Data sources (verified)

All free, no API key, ADSBexchange-v2 compatible. Rate limit ~1 request/sec, radius ≤ 250 nm (50 mi ≈ 43 nm fits comfortably).

- airplanes.live: `/v2/point/{lat}/{lon}/{radius}`
- adsb.lol: `/v2/lat/{lat}/lon/{lon}/dist/{radius}`
- adsb.fi: `/api/v3/lat/{lat}/lon/{lon}/dist/{dist}`

Feed provides `lat, lon, alt_baro/alt_geom, track, gs, baro_rate, flight (callsign), t (type), hex` — every field the spec requires (with graceful handling of missing fields).

## Tech stack

- Frontend: React 18 + TypeScript + Vite, Zustand for state.
- Rendering: a 2D WebGL/Canvas layer for Ceiling Mode + Three.js/WebGL for 3D modes (shared scene-data model).
- Backend: Node + Express (or Fastify) sidecar, TypeScript, run from the same repo (`npm run dev` starts both via concurrently).
- Tooling: ESLint + Prettier, Vitest for the math/derivation units.

## Repository structure

```text
airshow/
  doc/airshow.md
  doc/implementation-plan.md
  package.json                # workspaces: app + server
  server/                     # Node proxy + replay buffer
    src/index.ts
    src/providers.ts          # adsb.lol / adsb.fi / airplanes.live + failover
    src/normalize.ts          # vendor JSON -> Aircraft DTO
    src/replayBuffer.ts       # 15-min ring buffer
    src/cache.ts              # 1 req/s throttle + last-good cache
  app/
    index.html
    src/main.tsx
    src/state/store.ts        # Zustand: aircraft, config, mode, time
    src/data/useFeed.ts       # polling, diffing, smoothing handoff
    src/geo/projection.ts     # Projection interface + PlanarProjection (+ DomeProjection stub)
    src/geo/geo.ts            # lat/lon -> local ENU meters, bearing/distance
    src/motion/interpolate.ts # position/alt slerp + dead reckoning
    src/motion/attitude.ts    # roll/pitch/yaw estimation from history
    src/render/ceiling/       # Mode 1 (flagship): canvas/WebGL renderer
    src/render/three/         # Mode 2/3: free-fly + chase
    src/identity/types.ts     # ICAO type -> class map
    src/identity/airlines.ts  # callsign -> operator ICAO -> logo
    src/components/           # UI: list, search, filters, settings, labels
    src/modes/projector.ts    # fullscreen/hide UI+cursor
    src/audio/audio.ts
  assets/
    logos/                    # downloaded ICAO-keyed logos (script-populated)
    silhouettes/              # 2D top-down SVGs per class
    models/                   # GLB per class (Phase 4)
    audio/                    # optional, user-supplied
  scripts/
    fetch-logos.ts            # one-time downloader into assets/logos
    fetch-typedb.ts           # ICAO type -> class dataset builder
```

## Core data model

```ts
interface Aircraft {
  hex: string;            // ICAO 24-bit id
  callsign?: string;      // "AAL123"
  typeCode?: string;      // "B738"
  lat: number; lon: number;
  altFt?: number;         // baro/geom altitude
  headingDeg?: number;    // track
  groundSpeedKt?: number;
  verticalRateFpm?: number;
  // derived (client):
  class: AircraftClass;
  operatorIcao?: string;
  attitude: { roll: number; pitch: number; yaw: number };
  history: Sample[];      // for trails + smoothing + attitude
  firstSeen: number;      // for spotter pulse
}
```

## Key algorithms (the parts that decide "feel")

1. **Projection (planar):** convert `(lat,lon)` to local ENU meters relative to `(centerLat,centerLon)` (flat-earth equirectangular — spec explicitly allows ignoring curvature/terrain for ≤50 mi). Map meters → screen with north up; range rings at configurable mile intervals.
2. **Altitude scaling:** non-linear clamped curve hitting the spec table exactly (0–3k→90–110px … 25k–45k→32–50px), hard floor 34px so a 38,000 ft jet is never a dot. Altitude also drives brightness/opacity within a "never disappears" floor.
3. **Smoothing:** feed arrives every ~5 s; render at 60 fps via dead-reckoning (project position forward using gs+heading) + critically-damped interpolation toward each new fix; slerp heading; lerp altitude. This is what kills jitter.
4. **Attitude estimation (no attitude in ADS-B):** yaw from heading/track; pitch from `verticalRate` vs ground speed; roll from heading-change-rate × speed → bank angle, clamped ±35° (per spec).
5. **Replay:** server keeps a 15-min ring buffer of frames; client time controls (Live/Pause/Replay) scrub it; trails/labels reconstructed from buffered history.

## Phased build + milestones

Each phase ends in something runnable and visible.

### Phase 1 — Foundation + dot-map (Option B)

Vite + React + TS + Zustand scaffold; Node proxy with 3-provider failover, throttle, normalize; config (`centerLat/Lon/radiusMiles/refreshSeconds`); polling hook. Instead of a text-only list, render aircraft as simple positioned **dots** on the planar (north-up) projection with range rings, crosshair, and compass labels. These projection + overlay pieces are real Phase 2 components reused as-is (no throwaway work); only silhouettes, altitude scaling, and smoothing are deferred to Phase 2.

*Milestone: real aircraft near the configured coords appear as live dots on a north-up sky map with range rings, updating every 5 s.*

### Phase 2 — Ceiling Mode (the flagship)

Planar projection + range rings/crosshair/compass overlay (10–20% opacity, optional sweep); clamped altitude scaling; class silhouettes + pale class colors; smoothing/interpolation; dead-reckoning.

*Milestone: the "roof disappears" core experience works.*

### Phase 3 — Identity & life

ICAO type→class DB; callsign→operator→logo (belly + tail), generic fallback; trails (30s/2m/5m, airline/altitude/speed coloring); hover labels; fly-by labels; new-aircraft red spotter pulse (3–5s); rare-aircraft gold outline (A380/747/mil); nav lights (night) + contrails (>30k ft).

*Milestone: you can ID airline/type/altitude with no labels.*

### Phase 4 — 3D

Three.js free-fly (WASD/QE/mouse); well-shaded GLB models per class with PBR materials, HDRI/environment-map lighting, and shadows; airline livery/logo applied to the model where feasible; chase mode + camera hotkeys (C/B/S/U/T).

*Milestone: follow a real, good-looking shaded aircraft in 3D.*

### Phase 5 — Polish & ops

Time controls/replay UI; Projector mode (P: fullscreen/hide UI+cursor); audio (optional local files); performance (instancing/LOD/frustum culling, 200+ aircraft @ 60fps); settings/filters/search UI.

*Milestone: meets all 8 success criteria.*

### Location search — Layer 1 (offline airport/city) — **implemented**

A search box in the config panel lets the user jump to any airport by **IATA/ICAO
code, airport name, or city** — fully offline, no geocoding service.

- **Data:** `scripts/fetch-airports.mjs` downloads the open **OurAirports**
  dataset and writes a compact, pre-ranked columnar JSON to
  `app/public/airports.json` (~72k airports, excludes closed). Format:
  `[icao, iata, name, city, country, lat, lon, importance]`, where `importance`
  (0–5) is derived from airport type + scheduled-service so major fields rank
  above small strips. Ships as an external resource (served from `dist/`),
  consistent with the logos/version files.
- **Client:** `app/src/identity/airports.ts` lazy-loads the dataset on first
  focus of the search box (never blocks first paint) and ranks matches: exact
  code > code prefix > city/name `startsWith` > substring, with `importance` as
  the tie-breaker. `ConfigPanel` renders a results dropdown; selecting a result
  sets `centerLat/centerLon/locationLabel` (reusing the existing "Custom"
  selection path), so the map recenters and the stream re-subscribes.
- **Regenerate:** `npm run fetch:airports` (re-run to refresh the dataset).

> **Layer 2 (future, online geocoder):** for arbitrary places/landmarks beyond
> airports, add an `/api/search` proxy endpoint backed by a free geocoder
> (Open-Meteo recommended) with server-side caching — see the location-search
> strategy. Not required for Layer 1.

### Route accuracy — hybrid origin/destination — **implemented**

adsbdb only knows a flight number's *scheduled* route, which is often wrong for
the leg you're watching (codeshares, repositioning, intermediate stops). We now
reconcile **three non-blocking sources** in the aircraft popup and label
confidence. Critically, the render loop only ever does **synchronous cache
reads** — no source is ever awaited during a frame, so route resolution can
never introduce rendering lag.

- **adsbdb scheduled route** (`/api/route`): shown immediately as the baseline →
  **confidence: low**.
- **OpenSky track-derived leg** (`server/src/opensky.ts` → `/api/opensky`):
  OAuth2 client-credentials against the free OpenSky API, `flights/aircraft` by
  `icao24` over the last 18h, returns the observed `estDeparture/ArrivalAirport`
  for the most recent leg. Token + per-aircraft results are cached server-side
  (10 min positive / 5 min negative, de-duplicated in-flight). The client
  (`app/src/identity/opensky.ts`) mirrors the `getRoute` pattern: a synchronous
  getter returns the cached value (or `undefined` while a background fetch runs)
  and never blocks. When it resolves it overrides the relevant end →
  **confidence: high**. Credentials live in `server/creds/opensky_credentials.json`
  (git-ignored, bundled into the local build via `electron-builder` `files`); env
  vars `OPENSKY_CLIENT_ID/SECRET` take precedence. Resolves `__dirname` (bundle)
  or `cwd` (dev) so it works both packaged and in dev.
- **Trajectory inference** (`app/src/identity/arrivals.ts`): authoritative for
  the *near end* — the airport the aircraft is physically demonstrating right
  now. Pure, cheap heuristic on live ADS-B (altitude < 12k ft, vertical rate,
  heading vs. bearing to field) scanning only a **memoized in-view airport set**
  (`airportsInView` in `airports.ts`, a few dozen entries, never the full 72k per
  frame). A descending aircraft pointed at a nearby field → arrival there; a
  climbing aircraft moving away → departure from there. This fixes the original
  symptom (flights clearly landing at DFW showing a different airport).

Reconciliation order each frame (all sync): adsbdb baseline → OpenSky override →
trajectory override of the observed end. Popup shows `Route: FROM → TO (low|high)`,
honoring the city-names toggle (ICAO codes resolved to cities via the airport
index).

### Proximity / loss-of-separation alerts — **implemented (v0.5)**

Highlights aircraft that get uncomfortably close to each other with a red
translucent "danger cloud" and a dashed link between the pair, until they
separate again. Thresholds are configurable.

- **Two-dimensional rule.** Aviation separation is judged on two independent
  axes, so a conflict requires **both** to be breached at once:
  `horizontalDist < conflictHorizNm` **AND** `verticalDist < conflictVertFt`.
  A jet 2,000 ft directly above another is *not* flagged. **Thresholds are set
  below ATC separation minima, not at them**: the minima (3 NM / 1000 ft) are the
  *normal required spacing*, so alerting at them flags ordinary dense traffic.
  Defaults target a genuine close call (~TCAS RA): **1 NM horizontal, 700 ft
  vertical** (configurable; horizontal 0.5–10 NM, vertical 200–2,000 ft). Note
  radius elsewhere in the UI is statute miles, but separation is conventionally
  nautical miles.
- **Performance — never per frame.** The pairwise scan
  (`TrackManager.detectConflicts`) runs **~1×/sec** off the data tick, decoupled
  from the 60 fps redraw; the render loop only reads a `conflict` boolean per
  track, so it adds no per-frame cost. The scan is O(n²) but with cheap
  vertical + lat/lon **bounding-box early-outs**, and n in a 30 mi radius is
  typically 50–150 (≤~250 worst case → ~31k trivial pair checks). A uniform
  spatial grid is the next step only if n routinely grows much larger.
- **Hysteresis.** A flagged pair stays flagged until separation grows past
  **1.2×** the threshold, preventing flicker at the boundary (previous-tick
  pairs are remembered in `prevPairs`).
- **Terminal-airspace rule (tighter near airports).** Aircraft on approach
  legitimately fly much closer (in-trail ~2.5–3 NM, parallel runways < 1 NM), so
  instead of suppressing alerts near airports we apply a **tighter** minimum
  there — loss of separation still exists, just at smaller numbers. When **both**
  aircraft are low (< 10,000 ft) and within ~10 NM of an airport (from
  `airports.json` via `airportsInView`), the thresholds switch to the tighter
  terminal values (defaults **0.5 NM / 400 ft**, configurable). En-route vs.
  terminal pairs keep the en-route default. Toggle: `conflictTighterNearAirport`.
- **Filtering.** Only airborne aircraft with a known barometric altitude are
  considered (on-ground aircraft taxi within meters and would be 100% red).
- **Rendering.** A pulsing red radial-gradient cloud is drawn under the
  silhouette; conflicting pairs are joined by an animated dashed red line; the
  hover popup shows a "⚠ Proximity alert" line.
- **Caveat.** This is a **visualization, not a safety tool** — positions are
  interpolated and legal close spacing (in-trail / parallel approaches near a
  hub) will legitimately trigger it.

### Auto-show / projection flight cards ("attract mode") — **implemented (v0.5)**

A hands-free showcase for ceiling/wall projection: a large, minimal flight card
cycles through the aircraft currently on screen. The card shows only **airline
logo, airline name, flight number, and origin → destination** in oversized type,
and the featured aircraft gets a distinct cyan pulsing ring so viewers can find
it. Toggle: `autoShowEnabled` (default on).

- **Sequencing** (`showcase/ShowcaseController.ts`, pure timing/selection):
  pick a random on-screen aircraft → show **5 s** → hide → **3 s** gap → repeat.
- **New-aircraft priority:** when a small batch of newly-discovered aircraft
  appears (**1–4** at once), each is queued and shown next; a large influx
  (≥ 5, e.g. initial load) is ignored to avoid a spam burst.
- **Card** (`components/ShowcaseCard.tsx`): an HTML overlay (crisp SVG logo + big
  text, unlike the canvas hover popup). Reads the live aircraft from the store by
  hex so the route upgrades as lookups resolve; reuses the shared
  `identity/routeResolve.ts` (adsbdb → OpenSky → trajectory) used by the hover
  popup.
- **No mouse needed / no per-frame React churn.** The controller runs in the
  canvas rAF loop but only flips React state when the featured aircraft changes
  (~every 5–8 s). The card is positioned beside the aircraft by writing a
  `transform` directly to the DOM node each frame (clamped to the viewport), and
  the cyan ring is drawn on the canvas — so the 60 fps render path stays cheap.

### Zoom & pan + mobile layout — **implemented**

- **Semantics:** zoom changes the **radar radius** (zoom in ⇒ smaller radius)
  and pan **recenters** the map (new lat/lon) — both are committed to config when
  the gesture ends, so the data query re-fetches for the new area (not a purely
  visual magnification). **Desktop:** mouse wheel zooms about the center,
  left-click-drag pans. **Touch:** one-finger drag pans, two-finger pinch zooms
  (expand = in, pinch = out).
- **Implementation:** a live-preview `viewRef`
  (`{ active, radiusMiles, centerLat, centerLon }`) is seeded from config on
  gesture start and mutated by native listeners (wheel/touch use `passive:false`
  + `touch-action: none`) for smooth 60 fps feedback with no re-fetch mid-gesture.
  The render loop reads radius/center from the preview while `active`, otherwise
  from config. On gesture end (mouse-up, pinch/drag-up, or ~350 ms after the last
  wheel tick) the preview is written to config via `setConfig`; a
  `useLayoutEffect` keyed on `radiusMiles/centerLat/centerLon` then clears
  `active` before paint, so the committed values take over with no flicker, the
  SSE stream reconnects for the new region, and range rings/labels stay correct.
- **Mobile layout:** config panel becomes a bottom sheet with large touch
  targets (16px inputs to stop iOS zoom-on-focus, big range thumbs, sticky
  header); `100dvh` to avoid toolbar jumps; safe-area insets. Fullscreen uses the
  Fullscreen API (WebKit fallback) with an immersive UI-hide fallback on iOS
  Safari, plus a PWA manifest + Apple meta so "Add to Home Screen" runs
  standalone (button auto-hides when already standalone).
- **Auto-show toggle:** `autoShowEnabled` (default on) — "Auto random flight
  popup" checkbox enables/disables the random flight-card showcase.

### Self-hosted exposure: HTTPS + login — **design only**

> Status: **design only** (no code yet). Goal: safely expose the standalone HTTP
> host (the `server/dev.ts` + `STATIC_DIR` host currently on port 9443) to the
> network/internet with **TLS** and a **password gate**, without building a user-
> management UI. Self-signed cert now; real cert + domain later (drop-in swap).

**Where this applies (and where it doesn't).** The server has three run modes:
1. **Electron desktop** — embedded server on `localhost` (loopback, port 0). No
   TLS, no login (it's a single-user local app). Auth stays **off** here.
2. **Standalone host** (`server/dev.ts` + `STATIC_DIR`, e.g. port 9443) — the one
   reachable from other devices/the internet. TLS + login apply **here**.
3. **Vite dev** — unchanged; talks to the plain-HTTP API on 8787.

   So both new features are **opt-in flags** threaded through `createApp()` /
   `startServer()`; Electron passes them off.

#### 1) HTTPS with a self-signed cert (real cert later)

- **Termination in Node** (no nginx/Caddy): `startServer()` gains an optional
  `tls?: { key: string; cert: string }`. When present it uses
  `https.createServer({ key, cert }, app)`; otherwise it stays on `http` exactly
  as today. This keeps Electron/dev on HTTP and only the exposed host on HTTPS.
- **Cert location:** `server/creds/tls/key.pem` + `server/creds/tls/cert.pem`
  (the `server/creds/` folder is already git-ignored and already bundled by
  electron-builder's `files`). Resolution mirrors the existing OpenSky pattern
  (env override `TLS_KEY_PATH`/`TLS_CERT_PATH`, else the creds folder).
- **Generating the self-signed pair (Windows-friendly):** a one-time
  `scripts/gen-cert.mjs` using the `selfsigned` npm package (no OpenSSL needed),
  emitting a cert with SANs `localhost`, `127.0.0.1`, the LAN IP, and (later) the
  domain. Re-runnable; the real cert later just overwrites these two PEM files.
- **HTTP→HTTPS redirect (optional):** a tiny second listener (port 80/8080) that
  301-redirects to the HTTPS origin. Off by default; enabled by env when wanted.
- **Going to a real cert later:** drop the provider/Let's-Encrypt
  `privkey.pem`/`fullchain.pem` into `server/creds/tls/` (same filenames or via
  the env paths) and restart — **no code change**. Point the domain's DNS A/AAAA
  record (or the provider's redirect/proxy) at the host. Only **then** turn on
  HSTS and set the session-cookie `Domain` — never with the self-signed cert.
- **Caveats to expect with self-signed:** browsers show a one-time
  "Not secure / `ERR_CERT_AUTHORITY_INVALID`" interstitial; after "proceed",
  same-origin requests incl. **SSE/EventSource** work for that session. Service
  Workers and full **PWA install** require *trusted* TLS, so "Add to Home Screen"
  as a true standalone app is degraded until the real cert is in place (the app
  still runs fine in the browser tab). Trusting the cert in the OS/browser store
  removes the warning if desired.

#### 2) User database + login (no admin portal)

- **Store:** `server/creds/users.json` (git-ignored, server-side only — it is
  **never** part of the frontend bundle shipped to clients). Shape:
  `[{ "email": "...", "hash": "scrypt$N$r$p$<saltB64>$<hashB64>", "role": "admin", "createdAt": 169... }]`.
- **Password hashing — salted scrypt (Node built-in `crypto`, zero new deps).**
  The request says "simple one-way hash"; we implement it the correct way with a
  per-user random salt and the slow, memory-hard `scrypt` KDF so a leaked file
  can't be trivially reversed (a bare SHA-256 would also be one-way but is brute-
  forceable — scrypt is strictly better for the same effort). Verification uses
  `crypto.timingSafeEqual` (constant-time). Plaintext passwords are **never**
  written to disk or logged.
- **Adding users without a UI** — `scripts/add-user.mjs <email>`: prompts for the
  password with hidden input, computes the scrypt record, and upserts it into
  `users.json`. This is the "prompt to you only" flow: you tell me an
  email+password, I run the script (or write the hashed record), and only the
  **hash** is stored. No signup, no admin pages, no password reset surface.
- **Sessions fit SSE.** Because `EventSource` can't send `Authorization` headers
  but *does* send same-origin cookies, auth is **cookie-session** based:
  - `POST /api/login` `{ email, password }` → verify → set an **HttpOnly,
    Secure, SameSite=Lax** cookie holding a signed token
    (`base64(payload).hmacSHA256`, payload = `{ email, exp }`), signed with a
    server secret in `server/creds/session_secret` (auto-generated on first run
    if absent). Stateless — no server-side session table needed.
  - `POST /api/logout` clears the cookie. `GET /api/me` returns the current user
    (or 401) so the SPA knows whether to show the login screen.
  - **Gate:** a `requireAuth` middleware protects the data routes (`/api/stream`,
    `/api/aircraft`, `/api/route`, `/api/opensky`, `/api/geolocate`). Public:
    `/api/login`, `/api/me`, `/api/health`, and the **static frontend** (HTML/JS/
    CSS carry no secrets) — the SPA simply renders a login form until `/api/me`
    succeeds. Login is **rate-limited** (small in-memory per-IP throttle) to slow
    brute force.
  - `Secure` cookies require HTTPS, so this rides on feature (1); on the plain-
    HTTP dev/Electron paths auth is off so the flag never bites.
- **Frontend (described, not built):** a `LoginScreen` overlay shown when
  `/api/me` is 401; on submit it POSTs `/api/login` (cookie set automatically)
  then re-checks `/api/me` and mounts the app. `useStream` must **not** auto-retry
  on a 401 from `/api/stream` (it should close the `EventSource` and surface the
  login screen) to avoid a reconnect storm. A small "Sign out" affordance calls
  `/api/logout`.
- **Electron:** auth flag off (loopback, single user); the desktop app keeps
  working with no login prompt.

#### 3) Initial admin user

- Seed `server/creds/users.json` with **`cado2010@gmail.com`** as `role: admin`,
  stored only as a salted **scrypt** hash of the provided password (the plaintext
  is not recorded in the repo, this doc, or any log). Created via the same
  `add-user.mjs` flow during implementation.

#### New modules / touch-points (when implemented)

- `server/src/tls.ts` — load/resolve key+cert, pick `http` vs `https`.
- `server/src/auth.ts` — users.json load, scrypt hash/verify, session
  sign/verify (HMAC), `login`/`logout`/`me` handlers, `requireAuth`, login
  throttle.
- `server/src/index.ts` — `createApp({ auth })` mounts auth routes + gate;
  `startServer({ tls })` chooses the HTTPS listener.
- `server/src/dev.ts` — read `TLS_*`, `AIRSHOW_AUTH`, `STATIC_DIR`, `PORT`.
- `scripts/gen-cert.mjs`, `scripts/add-user.mjs` — one-off operator tools.
- `app/src/components/LoginScreen.tsx` + a `useAuth` check; `useStream` 401
  handling.
- Deps: `selfsigned` (cert script only); password/session use built-in `crypto`.
  Cookie parsing is a few lines off `req.headers.cookie` (or a tiny
  `cookie-parser`).

### Phase 6 — Mobile apps (Android + iOS)

> Status: **design only** (this section). No code yet. Goal: ship native
> **Android** and **iPhone** apps that deliver the Ceiling Mode experience on a
> phone/tablet, reusing as much of the existing web app as possible.

#### 6.0 Where we're starting from

Today the product is three pieces in one repo:

- `app/` — React 18 + TS + Vite SPA, **Canvas 2D** renderer (`CeilingCanvas`),
  Zustand state, an **SSE** client (`useStream`) with a stall watchdog.
- `server/` — Node/Express proxy: 3-provider ADS-B failover, caching/throttle,
  **SSE fan-out** (`/api/stream`), route lookup (`/api/route`), IP geolocation
  fallback (`/api/geolocate`).
- `electron/` — desktop shell that boots the server in-process and loads the
  SPA same-origin.

The mobile phase is mostly about **(a) where the server runs** and **(b) what
shell wraps the UI**. The rendering/feel logic (projection, smoothing,
silhouettes, trails, intent) is portable and should not be rewritten.

#### 6.1 Key architecture decision — back end goes hosted

On desktop the Node server runs locally inside Electron. Phones **cannot** run a
persistent Node sidecar cleanly (iOS forbids long-lived background servers;
`nodejs-mobile` is heavy/fragile), and we do **not** want thousands of mobile
clients each hammering the public ADS-B providers (rate limits / acceptable
use). So:

- **Promote `server/` to a single hosted backend** (e.g. Fly.io / Render /
  Railway / a small VPS) reachable over **HTTPS + SSE**. One server polls the
  providers and fans out deltas to all clients — exactly what `StreamHub`
  already does. The corporate-TLS `undici` workarounds become server-side only
  and disappear from clients.
- Clients (mobile **and** web) point at `https://api.<domain>` instead of
  `localhost`. The SPA already centralizes this in the `VITE_SSE_BASE` /
  relative-URL logic, so it's a config change, not a rearchitecture.
- Keep Electron's embedded-server mode as-is for the offline desktop build; add
  a build flag to target the hosted backend instead when desired.

New backend concerns to add: TLS/domain, basic rate limiting & abuse
protection per client/IP, CORS allow-list, horizontal-scale friendliness of the
SSE hub (sticky sessions or a shared pub/sub if we scale past one node),
uptime/logging.

#### 6.2 Shell strategy — two options

**Option A (recommended): Capacitor WebView wrapper.**
Wrap the *existing* React/Canvas SPA in a native [Capacitor](https://capacitorjs.com)
shell for Android (Gradle/APK/AAB) and iOS (Xcode/IPA). The web app runs almost
unchanged inside a system WebView; native capabilities come from Capacitor
plugins (Geolocation, StatusBar, SplashScreen, App lifecycle, Network, Browser
for external links). **Highest code reuse, fastest path, one codebase for web +
desktop + mobile.** Tradeoff: WebView Canvas perf is good for our scale (tens of
aircraft) but not as fast as fully native; 3D mode (Phase 4) would be the
stress test.

**Option B (alternative): React Native (+ Expo).**
More "native" feel and better long-term perf, reuses TS logic/state, but the
Canvas renderer must be **ported** to `@shopify/react-native-skia` (or
`expo-gl`/WebGL). That's a real rendering rewrite. Choose this only if WebView
performance proves insufficient or a deeply native UX is required.

Decision: **start with Capacitor (Option A)**; revisit RN only if profiling
demands it.

#### 6.3 What must change for touch / mobile (UI & UX)

The current UI assumes a mouse and a large window. Mobile needs a touch-first
pass (web app changes that also benefit the desktop build):

- **Interaction:** replace hover popups with **tap-to-select** + a dismissible
  detail card/bottom-sheet; add **pinch-to-zoom** and **drag-to-pan** of the
  map (currently fixed scale); larger hit targets for small aircraft.
- **Layout:** responsive config as a **bottom sheet/drawer** instead of the
  top-right panel; respect **safe-area insets** (notch/Dynamic Island, home
  indicator); support **portrait and landscape**.
- **Rendering:** keep the DPR cap, but tune for high-density phone screens and
  smaller GPUs; verify trail batching cost on mid-range Android.
- **Lifecycle:** on background/resume, **pause and cleanly reconnect** SSE
  (mobile OSes suspend timers/sockets); show the existing live/stalled status.
- **Location:** use the native Geolocation plugin (foreground only) with the
  IP fallback; handle permission prompts/denials gracefully.
- **Battery/data:** an explicit "reduce updates when backgrounded / on cellular"
  setting; the stream is light but the screen + canvas redraw are the cost.

#### 6.4 Platform specifics

**Android**
- Build via Capacitor → Android Studio/Gradle → **APK** (sideload) and **AAB**
  (Play). `minSdk` ~24+.
- `AndroidManifest`: `INTERNET`, `ACCESS_FINE/COARSE_LOCATION`; cleartext off
  (HTTPS only).
- Adaptive launcher icon + splash generated from the existing
  `assets/airshow-icon.png`.
- Distribution: **Google Play Console** ($25 one-time), or direct APK for
  side-loading/testing.

**iOS (iPhone)**
- Requires a **Mac + Xcode** to build/sign (cannot be produced from this
  Windows dev box); Capacitor → Xcode → **IPA**.
- `Info.plist`: `NSLocationWhenInUseUsageDescription`, ATS (HTTPS) compliance.
- App icon set + launch screen from the existing icon art.
- Distribution: **Apple Developer Program** ($99/yr), TestFlight for beta,
  **App Review** for the Store (expect content/usage questions; live-data apps
  are fine but review adds calendar time).

#### 6.5 Suggested sub-sequence

1. **Backend hosting**: deploy `server/` publicly (HTTPS, CORS allow-list, rate
   limiting), make the SPA's API base fully configurable.
2. **Responsive/touch web pass**: tap-select, bottom-sheet config, pan/zoom,
   safe-area, lifecycle reconnect — verified in a mobile browser first.
3. **Capacitor integration**: add Android + iOS projects, wire Geolocation /
   StatusBar / SplashScreen / App plugins, generate icons & splash.
4. **Android build & internal testing** (APK/Play internal track).
5. **iOS build on a Mac** (TestFlight) — gated on Apple account + Mac.
6. **Store submissions** (Play + App Store), privacy labels, screenshots.

#### 6.6 What this does *not* require

- No rewrite of the projection/smoothing/identity/render logic (reused as-is in
  Option A).
- No change to the ADS-B providers or the normalization/SSE design.
- Electron desktop continues to work unchanged.

## Risks tracked (and mitigations)

- **CORS / endpoint flakiness** → the proxy + 3-provider failover + last-good cache.
- **Logo licensing / coverage gaps** → local download (no hotlinking), generic fallback, monochrome tail-color generation when a logo is missing.
- **3D model sourcing** → V1 needs quality shaded per-class GLBs (PBR + lighting + shadows); the work is sourcing/vetting license-clean (CC0/CC-BY) models and optimizing them (draco/meshopt compression, LOD) so 200+ render at 60fps. Per-type (individual aircraft) models deferred (spec scopes V1 to classes).
- **"Magical" is subjective** → smoothing + the altitude-never-disappears floor + spotter/fly-by life are the levers; tune against the real sky.
- **Mobile — provider load & abuse (Phase 6)** → never let mobile clients hit ADS-B providers directly; the single hosted backend polls once and fans out via SSE, with per-client rate limiting and a CORS allow-list.
- **Mobile — WebView render perf (Phase 6)** → validate Canvas 2D in a WebView on mid-range Android early; if 3D (Phase 4) is too heavy, gate it on capability or port hot paths to Skia/WebGL (Option B) only if needed.
- **Mobile — background suspension (Phase 6)** → phones suspend sockets/timers; reuse the SSE stall watchdog to pause on background and reconnect on resume; add a cellular/background "reduce updates" setting.
- **iOS toolchain & store gating (Phase 6)** → iOS builds need a Mac + Xcode and a paid Apple Developer account; App Review adds calendar time. Plan accounts/hardware before committing to dates; Android can ship first.

## Resolved confirmations

- Package manager: **npm**; Node: **20+**.
- Default config: spec's DFW-area coords **(33.1976, -96.6153)**, **50 mi**, **5 s**.
- 3D models: **well-rendered, shaded per-class GLBs** (PBR + lighting + shadows), sourced license-clean — not low-poly placeholders.

## Success criteria (from spec)

The application succeeds if a user can:

1. Project onto a ceiling.
2. Feel like they are looking through the roof.
3. Instantly distinguish different aircraft classes.
4. Recognize major airlines.
5. Watch realistic aircraft movement.
6. Follow aircraft in 3D.
7. Replay recent traffic.
8. Run entirely from free ADS-B data sources.
