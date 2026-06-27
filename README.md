# AirShow

**Real-time aircraft "ceiling projection" — turn any screen, wall, or ceiling into a live view of the sky above a chosen location, built entirely on free ADS-B data.**

Current version: **v0.6.0** · Author: **Srikanth Subramanian** · Repo: <https://github.com/cado2010/airshow>

---

## What it is

AirShow takes a latitude/longitude anywhere on Earth and renders the aircraft
currently flying near it as smoothly-moving, recognizable airplanes on a black,
faintly-radar-styled canvas. The design goal (from the original spec) is for it
to feel **magical rather than technical** — as if the roof disappeared and you're
looking straight up at the real sky. Point it at DFW, Heathrow, JFK, Dubai, or
your own backyard.

It runs three ways from one codebase:

- **Web app** — a React + Canvas SPA served by a small Node backend.
- **Desktop app** — an Electron shell (Windows `.exe`, macOS `.dmg`/`.zip`) that
  boots the backend in-process on loopback.
- **Self-hosted server** — the same backend exposed over HTTP/HTTPS with login,
  so you can reach it from your phone or the internet.

> **Note on the name "ceiling projection":** the primary intended use is to throw
> the image onto a ceiling or wall with a projector so a room becomes a live sky.
> It works equally well on a normal monitor or phone.

---

## Origins → present state

AirShow began as a written specification ([`doc/airshow.md`](doc/airshow.md))
describing an ambitious multi-mode sky visualizer, which was turned into a phased
build plan ([`doc/implementation-plan.md`](doc/implementation-plan.md)). The
project then grew iteratively. Here's the arc:

| Stage | What landed |
|------|-------------|
| **Foundation** | Vite + React + TypeScript + Zustand scaffold; Node/Express proxy with 3-provider ADS-B failover, throttling, normalization; live dot-map on a north-up planar projection with range rings + compass. |
| **Real-time streaming** | Replaced polling with **Server-Sent Events (SSE)** for low-latency push; added a client stall-watchdog and an honest connection status indicator (turns red when updates stop). |
| **Ceiling Mode** | Clamped altitude→size scaling (a 38,000 ft jet is never a dot), per-class aircraft **silhouettes**, pale class colors, dead-reckoning + interpolation for jitter-free 60 fps motion. |
| **Identity & life** | Airline **logos** (downloaded locally, never hotlinked) + airline names, ICAO type→class mapping, motion trails, hover detail popups, "intent" (climbing/cruising/landing) inference. |
| **Desktop packaging** | Electron shell; bundled Node server via esbuild; custom plane icon; Windows NSIS installer; macOS DMG/ZIP config + GitHub Actions workflow. |
| **Location search** | Offline search box over a bundled **~72k-airport** dataset — jump to any airport by IATA/ICAO code, airport name, or city, no geocoder needed. |
| **Accurate routes** | Hybrid origin→destination resolution reconciling **adsbdb** (scheduled), **OpenSky** (observed leg, async), and **trajectory inference** (the airport an aircraft is physically demonstrating now), with a low/high confidence label and zero render-loop blocking. |
| **Proximity alerts (v0.5)** | "Loss of separation" detection: a red translucent cloud + dashed link when two aircraft get genuinely close, with a tighter rule for terminal airspace, hysteresis, and an off-the-render-loop O(n²) scan. |
| **Attract mode (v0.5)** | Hands-free "auto-show" flight cards for projection: large airline logo / name / flight / route cycling through on-screen aircraft (now **off by default**). |
| **Mobile + zoom/pan** | Touch-first config bottom-sheet, safe-area insets, `100dvh`, PWA manifest, robust fullscreen (incl. iOS fallback). Zoom changes the **radar radius**, pan **recenters** the map (lat/lon) and re-fetches. |
| **Self-hosted exposure (v0.6)** | HTTPS via Let's Encrypt, **JWT-based login** (scrypt-hashed passwords, no admin portal), all API/SSE routes gated except login; PowerShell helper scripts for serving and user management. |

### What is *not* yet built

The original spec scoped several further modes that remain on the roadmap:

- **3D modes** (Three.js free-fly, chase camera, GLB models) — design only.
- **Replay UI** — the server keeps a 15-min ring buffer, but the scrubber UI is
  not wired up.
- **Native mobile apps** (Capacitor Android/iOS) — designed in the plan, not built.
- Audio ambience, weather overlays, AI spotter — future enhancements.

---

## Features (current)

- Live ADS-B from **adsb.lol → adsb.fi → airplanes.live** with automatic failover.
- North-up planar projection with configurable **radius**, range rings, crosshair,
  compass labels, and a faint optional radar sweep.
- Altitude-aware aircraft sizing/brightness; per-class silhouettes and pale colors.
- Airline logo + name, aircraft type, altitude, speed, heading, and inferred
  **intent** on hover.
- Hybrid, confidence-rated **origin → destination** (optionally shown as city names).
- **Proximity / loss-of-separation** visualization (configurable thresholds).
- **Auto-show** projection cards (toggle, default off).
- Offline **airport/city search** to recenter anywhere instantly.
- **Zoom** (changes radar radius) and **pan** (recenters lat/lon), mouse + touch.
- **Fullscreen** button, dark window chrome, About dialog, version readout.
- **Configuration** persisted to `localStorage`; "use my location" via IP geolocation.
- Desktop builds for **Windows** and **macOS**.
- Optional **HTTPS + login** for safe self-hosting.

---

## Architecture

```
ADS-B providers ──▶ server/ (Node + Express)
                       • provider failover + 1 req/s throttle + last-good cache
                       • normalize vendor JSON → Aircraft DTO
                       • 15-min replay ring buffer
                       • SSE fan-out  (/api/stream)
                       • route lookup (/api/route, /api/opensky)
                       • IP geolocate (/api/geolocate)
                       • auth (JWT) + optional HTTPS termination
                              │
                              ▼  SSE / JSON
                    app/ (React 18 + TS + Vite, Zustand)
                       • Canvas 2D renderer (CeilingCanvas)
                       • motion: interpolation + dead-reckoning + trails
                       • identity: type→class, airline logos, route resolve
                       • showcase/attract controller, proximity rendering
                              │
                  ┌───────────┴───────────┐
                  ▼                         ▼
         electron/ (desktop shell)   self-hosted host (serve / serve-https)
         boots server on loopback    serves built app/dist + gated API
```

### Repository layout

```
airshow/
  app/                     React + Vite SPA (the UI/renderer)
    public/                airports.json, logos, version.txt, manifest
    src/
      render/CeilingCanvas.tsx   flagship 2D renderer + zoom/pan
      render/silhouettes.ts      per-class aircraft shapes
      motion/track.ts            Track + TrackManager (smoothing, conflicts)
      identity/                  airlines, airports, routes, opensky, intent
      showcase/                  attract-mode controller
      components/                ConfigPanel, ShowcaseCard, LoginScreen, …
      auth/auth.ts               client JWT storage + apiFetch + SSE token
      state/store.ts             Zustand store + DEFAULT_CONFIG
      data/useStream.ts          SSE client + stall watchdog
  server/                  Node/Express backend
    src/
      index.ts                   createApp/startServer (+ HTTPS, auth gate)
      dev.ts                     standalone entry (PORT/STATIC_DIR/TLS/AUTH)
      providers.ts               adsb.lol / adsb.fi / airplanes.live + failover
      normalize.ts cache.ts replayBuffer.ts stream.ts
      routes.ts opensky.ts       route/origin-destination lookups
      auth.ts                    scrypt hashing, JWT sign/verify, requireAuth
    creds/                       git-ignored: users.json, session_secret, tls/, opensky_credentials.json
  electron/                desktop shell (main.cjs) + bundled server.cjs
  scripts/                 build-electron, make-icon, fetch-airports/logos, add-user, set-password
  doc/                     airshow.md (spec) + implementation-plan.md
  serve.ps1 serve-https.ps1 add-user.ps1 set-password.ps1 open-firewall.ps1 install-cert.ps1
```

### Tech stack

- **Frontend:** React 18, TypeScript, Vite, Zustand, HTML Canvas 2D.
- **Backend:** Node.js, Express, TypeScript, SSE; `undici` for upstream fetches.
- **Desktop:** Electron + electron-builder; server bundled with esbuild.
- **Data:** OurAirports (airports dataset), ICAO-keyed airline logos, OpenSky API.

---

## Getting started (development)

Requirements: **Node.js 20+** (24 recommended) and npm.

```bash
npm install
npm run dev
```

`npm run dev` starts the backend (port 8787) and the Vite dev server together;
open the URL Vite prints (default <http://localhost:5173>). Auth is off in dev.

> **Corporate TLS / antivirus note:** if `npm install` fails with
> `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, a `.npmrc` with `strict-ssl=false` is already
> included to work around TLS-intercepting proxies/AV.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run server + app in watch mode |
| `npm run build` | Type-check and build server + web app |
| `npm run fetch:airports` | Regenerate `app/public/airports.json` from OurAirports |
| `npm run build:icon` | Generate `.ico`/`.icns`/`.png` from `assets/airshow-icon.png` |
| `npm run build:electron` | Build web app + bundle server + icons for desktop |
| `npm run dist` | Build the Windows NSIS installer (output in `release/`) |
| `npm run dist:portable` | Build a portable Windows `.exe` |
| `npm run dist:mac` | Build macOS `.dmg`/`.zip` (**must run on macOS**) |
| `npm run serve` | Self-host over **HTTP** on port 9443 |
| `npm run serve:https` | Self-host over **HTTPS** on port 9443 |
| `npm run add-user` | Add/update a login user (hidden prompt) |
| `npm run set-password` | Update an existing user's password (preserves role) |

---

## Configuration

Settings live in the in-app **Config** panel and persist to `localStorage`.
Defaults (`app/src/state/store.ts`) include:

- **Radius:** 30 miles · **Aircraft size:** 30% · **Logo offset:** 80%
- **Hide aircraft on the ground:** on · **Show city names in routes:** on
- **Proximity alerts:** on (1 NM / 700 ft en-route; 0.5 NM / 400 ft terminal)
- **Auto random flight popup:** off

You can recenter via the **airport/city search**, "use my location" (IP-based), or
by **panning** the map; **zoom** adjusts the radar radius and re-fetches data.

---

## Building the desktop apps

**Windows:**

```bash
npm run dist          # NSIS installer in release/
```

**macOS** (must be built on a Mac, or via the included GitHub Actions workflow
`.github/workflows/build-mac.yml`, triggered by `workflow_dispatch` or a `v*` tag):

```bash
npm run dist:mac      # .dmg + .zip in release/
```

Artifacts are written to `release/`. (The macOS CI workflow uploads them as
build artifacts; it does not publish a GitHub Release by default.)

> If `electron-builder` can't download NSIS/helpers due to a TLS-intercepting AV
> (e.g. Norton), prefix the command with `NODE_TLS_REJECT_UNAUTHORIZED=0`.

---

## Self-hosting (HTTP / HTTPS + login)

The standalone host serves the built SPA from `app/dist` and gates every API/SSE
route behind a JWT login (except `/api/login`).

### 1. Build the web app

```bash
npm run build
```

### 2A. HTTP (testing on a trusted LAN)

```bash
npm run serve         # http://<host>:9443
```

### 2B. HTTPS (recommended)

Place your certificate as `server/creds/tls/fullchain.pem` and the key as
`server/creds/tls/privkey.pem`, then:

```bash
npm run serve:https   # https://airshow.<your-domain>:9443
```

For **Let's Encrypt**, `install-cert.ps1` (run as Administrator) copies certbot's
restricted live files into `server/creds/tls/` and grants read permission so the
non-elevated Node process can load them.

### Users

There is no signup or admin UI by design — manage users from the CLI:

```bash
npm run add-user            # create or update a user (email, role, password)
npm run set-password        # change an existing user's password only
```

Passwords are stored only as salted **scrypt** hashes in `server/creds/users.json`
(git-ignored). Sessions are stateless **HS256 JWTs**; the SPA sends the token as a
`Bearer` header for fetches and as a `?token=` query param for SSE (EventSource
can't set headers). The JWT secret lives in `server/creds/session_secret`
(auto-generated). Supported roles: `user` and `admin`.

### Opening the firewall

`open-firewall.ps1` (run as Administrator) adds the Windows Firewall inbound rule
for TCP 9443.

---

## Networking notes (read this if you can't reach it from outside)

- The server binds to `::` (IPv6 "any") in **dual-stack** mode, so it listens on
  **all** interfaces for both IPv4 and IPv6 — a single listener is correct.
- To reach it from the internet you need: a **Windows Firewall** inbound rule for
  9443 (`open-firewall.ps1`), any **antivirus firewall** allowance (and disable
  HTTPS/encrypted-traffic scanning so it doesn't replace your cert), and a
  **router port-forward** of `9443 → <LAN IP>:9443`.
- **NAT hairpinning gotcha:** many gateways (e.g. AT&T **BGW320-500**) can't loop
  a request for your *public* IP back to an internal host, **and** don't allow a
  local/split-horizon DNS override. So from inside your own Wi-Fi, the public
  hostname may fail (the cached UI can still appear while only the live login call
  hangs) even though it works perfectly over cellular. Fixes: add a **hosts-file**
  entry mapping the hostname to the LAN IP on each PC, run a **local DNS resolver**
  (Pi-hole/AdGuard) for the whole house, or put the gateway in **IP Passthrough**
  behind a router that supports NAT loopback.

---

## Data sources & credits

- **ADS-B:** [adsb.lol](https://adsb.lol), [adsb.fi](https://adsb.fi),
  [airplanes.live](https://airplanes.live) (free, no key, ADSBexchange-v2 compatible).
- **Routes:** [adsbdb](https://www.adsbdb.com) (scheduled) +
  [OpenSky Network](https://opensky-network.org) (observed legs; requires your own
  OAuth2 client credentials in `server/creds/opensky_credentials.json`).
- **Airports:** [OurAirports](https://ourairports.com) open dataset.
- **Logos:** ICAO-keyed airline logo repositories (downloaded locally, not hotlinked).

---

## Disclaimer

AirShow is a **visualization**, not an air-traffic or safety tool. Positions are
interpolated/dead-reckoned, routes are best-effort inferences, and the proximity
"loss of separation" overlay will legitimately trigger on normal close spacing
(in-trail or parallel approaches near a hub). Do not use it for any operational
purpose.
```
