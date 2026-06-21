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
