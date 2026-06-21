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

## Risks tracked (and mitigations)

- **CORS / endpoint flakiness** → the proxy + 3-provider failover + last-good cache.
- **Logo licensing / coverage gaps** → local download (no hotlinking), generic fallback, monochrome tail-color generation when a logo is missing.
- **3D model sourcing** → V1 needs quality shaded per-class GLBs (PBR + lighting + shadows); the work is sourcing/vetting license-clean (CC0/CC-BY) models and optimizing them (draco/meshopt compression, LOD) so 200+ render at 60fps. Per-type (individual aircraft) models deferred (spec scopes V1 to classes).
- **"Magical" is subjective** → smoothing + the altitude-never-disappears floor + spotter/fly-by life are the levers; tune against the real sky.

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
