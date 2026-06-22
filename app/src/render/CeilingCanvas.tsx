import { useEffect, useMemo, useRef } from "react";
import { useStore } from "../state/store";
import { PlanarProjection, type Viewport, type ScreenPoint } from "../geo/projection";
import { milesToMeters } from "../geo/geo";
import { TrackManager, type Track } from "../motion/track";
import { classifyType, colorFor, CLASS_META, type AircraftClass } from "../identity/types";
import { drawSilhouette } from "./silhouettes";
import {
  getLogo,
  logoReady,
  operatorIcao,
  airlineName,
  loadLogoManifest,
} from "../identity/airlines";
import { getRoute, type RouteAirport } from "../identity/routes";
import { getOpenSky } from "../identity/opensky";
import {
  airportByCode,
  airportsInView,
  airportsReady,
  loadAirports,
  type Airport,
} from "../identity/airports";
import { inferEndpoint } from "../identity/arrivals";
import type { AirShowConfig } from "../types";

const OVERLAY = "rgba(120, 200, 160, 0.16)";
const OVERLAY_TEXT = "rgba(150, 220, 180, 0.55)";
const M_PER_DEG_LAT = 111_132;

interface Plotted {
  track: Track;
  pt: ScreenPoint;
  size: number;
  cls: AircraftClass;
  operator?: string;
}

const classCache = new Map<string, AircraftClass>();
function classOf(typeCode?: string): AircraftClass {
  const key = typeCode ?? "";
  let c = classCache.get(key);
  if (!c) {
    c = classifyType(typeCode);
    classCache.set(key, c);
  }
  return c;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/** Clamped, non-linear altitude -> wingspan px (spec tables, floor 34). */
function sizeForAlt(alt: number): number {
  let s: number;
  if (alt <= 3000) s = lerp(110, 90, alt / 3000);
  else if (alt <= 10000) s = lerp(90, 70, (alt - 3000) / 7000);
  else if (alt <= 25000) s = lerp(70, 50, (alt - 10000) / 15000);
  else if (alt <= 45000) s = lerp(50, 34, (alt - 25000) / 20000);
  else s = 34;
  return Math.max(34, s);
}

function alphaForAlt(alt: number): number {
  return lerp(1, 0.72, alt / 45000);
}

/** Infer a phase-of-flight from altitude and vertical rate. */
function intentFor(onGround: boolean, altFt: number, vrate: number): string {
  if (onGround) return "On ground";
  if (vrate >= 500 && altFt < 8000) return "Taking off";
  if (vrate >= 300) return "Climbing";
  if (vrate <= -500 && altFt < 8000) return "Landing";
  if (vrate <= -300) return "Descending";
  if (altFt >= 18000) return "Cruising";
  return "Level flight";
}

type Endpoint = { code: string; city: string } | null;

function epFromAirport(a: Airport): Endpoint {
  return { code: a.iata || a.icao || "?", city: a.city || a.name || a.icao || "?" };
}
function epFromRouteAirport(ra?: RouteAirport): Endpoint {
  if (!ra) return null;
  const code = ra.iata || ra.icao || ra.municipality;
  if (!code) return null;
  return { code, city: ra.municipality || code };
}
function epFromIcao(icao: string | null): Endpoint {
  if (!icao) return null;
  const a = airportByCode(icao);
  return a ? epFromAirport(a) : { code: icao, city: icao };
}
function epText(ep: Endpoint, cityNames: boolean): string {
  if (!ep) return "?";
  return cityNames ? ep.city : ep.code;
}

/**
 * Resolve a flight's origin/destination from three non-blocking sources and
 * report confidence. Order of trust, all read synchronously every frame:
 *   1. adsbdb scheduled route (shown immediately → low confidence)
 *   2. OpenSky track-derived leg by icao24 (background → upgrades to high)
 *   3. trajectory-observed near-end (authoritative for arrival/departure here)
 */
function resolveRoute(track: Track, cfg: AirShowConfig): string {
  const a = track.data;

  // Lazy-load the airport set so later hovers can do trajectory inference.
  if (!airportsReady()) void loadAirports();
  const viewNm = cfg.radiusMiles * 0.868976;
  const observed = airportsReady()
    ? inferEndpoint(
        {
          lat: a.lat,
          lon: a.lon,
          altFt: a.altFt ?? track.render.altFt,
          verticalRateFpm: a.verticalRateFpm ?? 0,
          headingDeg: a.headingDeg,
          onGround: a.onGround,
        },
        cfg.centerLat,
        cfg.centerLon,
        viewNm,
      )
    : null;

  const adsb = getRoute(a.callsign); // undefined=loading | null=none | route
  const osky = getOpenSky(a.hex); // undefined=loading | null=none | route

  let from: Endpoint = null;
  let to: Endpoint = null;

  if (adsb) {
    from = epFromRouteAirport(adsb.origin);
    to = epFromRouteAirport(adsb.destination);
  }

  const oskyData = osky && (osky.depIcao || osky.arrIcao) ? osky : null;
  if (oskyData) {
    if (oskyData.depIcao) from = epFromIcao(oskyData.depIcao);
    if (oskyData.arrIcao) to = epFromIcao(oskyData.arrIcao);
  }

  if (observed) {
    if (observed.kind === "arrival") to = epFromAirport(observed.airport);
    else from = epFromAirport(observed.airport);
  }

  if (!from && !to) {
    return adsb === undefined || osky === undefined ? "Route: \u2026" : "";
  }

  const conf = oskyData || observed ? "high" : "low";
  const cn = cfg.routeCityNames;
  return `Route: ${epText(from, cn)} \u2192 ${epText(to, cn)} (${conf})`;
}

export function CeilingCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const config = useStore((s) => s.config);

  const aircraft = useStore((s) => s.aircraft);
  const configRef = useRef<AirShowConfig>(config);
  const tmRef = useRef<TrackManager>(new TrackManager());
  const plottedRef = useRef<Plotted[]>([]);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const lastConflictRef = useRef(0);

  configRef.current = config;

  const projection = useMemo(
    () => new PlanarProjection(milesToMeters(config.radiusMiles)),
    [config.radiusMiles],
  );

  useEffect(() => {
    void loadLogoManifest();
  }, []);

  // Feed new server data into the interpolating track manager.
  useEffect(() => {
    tmRef.current.ingest(aircraft, Date.now());
  }, [aircraft]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let vp: Viewport = { width: 0, height: 0 };

    const resize = () => {
      // Cap DPR: on HiDPI/large windows a full backing store tanks the frame
      // rate (and thus makes interpolated motion look laggy) for little visual
      // gain on this dark, line-art scene.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const rect = canvas.getBoundingClientRect();
      vp = { width: rect.width, height: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      const now = Date.now();
      ctx.clearRect(0, 0, vp.width, vp.height);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, vp.width, vp.height);

      drawRadarOverlay(ctx, projection, vp, configRef.current);

      const cfg = configRef.current;
      // Precompute the (planar/equirectangular) projection once per frame so the
      // per-point hot path is pure arithmetic with no allocations or trig.
      const s = projection.metersToPixels(1, vp);
      const cx = vp.width / 2;
      const cy = vp.height / 2;
      const mPerDegLon = M_PER_DEG_LAT * Math.cos((cfg.centerLat * Math.PI) / 180);
      const px = (_lat: number, lon: number): number =>
        cx + (lon - cfg.centerLon) * mPerDegLon * s;
      const py = (lat: number, _lon: number): number =>
        cy - (lat - cfg.centerLat) * M_PER_DEG_LAT * s;
      const project = (lat: number, lon: number): ScreenPoint => ({
        x: px(lat, lon),
        y: py(lat, lon),
      });

      const tracks = tmRef.current.frame(now);

      // Proximity/loss-of-separation scan runs ~1×/sec (positions only change at
      // the feed rate), decoupled from the 60fps redraw so it can never add per-
      // frame cost. Tracks just carry a `conflict` flag the render loop reads.
      if (now - lastConflictRef.current > 1000) {
        lastConflictRef.current = now;
        // In-view airports power the tighter terminal-airspace rule; load lazily.
        if (cfg.conflictTighterNearAirport && !airportsReady()) void loadAirports();
        const airports =
          cfg.conflictTighterNearAirport && airportsReady()
            ? airportsInView(cfg.centerLat, cfg.centerLon, cfg.radiusMiles * 0.868976 + 15)
            : [];
        tmRef.current.detectConflicts({
          enabled: cfg.conflictEnabled,
          horizNm: cfg.conflictHorizNm,
          vertFt: cfg.conflictVertFt,
          tighterNearAirport: cfg.conflictTighterNearAirport,
          nearHorizNm: cfg.conflictNearHorizNm,
          nearVertFt: cfg.conflictNearVertFt,
          airports,
          terminalRadiusNm: 10,
          terminalMaxAltFt: 10000,
        });
      }

      const plotted: Plotted[] = [];
      const byHex = new Map<string, Plotted>();

      for (const track of tracks) {
        if (cfg.hideGround && track.data.onGround) continue;
        const r = track.render;
        const pt = project(r.lat, r.lon);
        if (pt.x < -60 || pt.x > vp.width + 60 || pt.y < -60 || pt.y > vp.height + 60) {
          continue;
        }
        const cls = classOf(track.data.typeCode);
        const operator = operatorIcao(track.data.callsign);
        const color = colorFor(cls, operator);
        const size = sizeForAlt(r.altFt) * cfg.aircraftScale;
        const alpha = alphaForAlt(r.altFt);

        drawTrail(ctx, track, px, py, color);
        if (r.altFt > 30000) drawContrail(ctx, track, px, py);
        if (track.conflict) drawConflictCloud(ctx, pt, size, now);

        // Silhouette (rotated to heading)
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate((r.headingDeg * Math.PI) / 180);
        ctx.globalAlpha = track.data.onGround ? 0.8 : alpha;
        drawSilhouette(ctx, cls, size, color);
        ctx.restore();

        drawLogo(ctx, operator, pt, size, cfg.logoOffset, cfg.logoScale);
        if (track.isNew) drawSpotterPulse(ctx, track, pt, size, now);

        const p: Plotted = { track, pt, size, cls, operator };
        plotted.push(p);
        byHex.set(track.data.hex, p);
      }

      drawConflictLinks(ctx, plotted, byHex, now);

      plottedRef.current = plotted;
      drawHover(ctx, plotted, mouseRef.current, cfg);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [projection]);

  return (
    <canvas
      ref={canvasRef}
      className="ceiling-canvas"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }}
      onMouseLeave={() => {
        mouseRef.current = null;
      }}
    />
  );
}

// Trail fade is approximated with a few contiguous alpha bands instead of one
// stroke per segment, cutting draw calls from ~N to TRAIL_BANDS per aircraft.
const TRAIL_BANDS = 4;

function drawTrail(
  ctx: CanvasRenderingContext2D,
  track: Track,
  px: (lat: number, lon: number) => number,
  py: (lat: number, lon: number) => number,
  color: string,
): void {
  const pts = track.trail;
  const n = pts.length;
  if (n < 2) return;
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = color;
  for (let b = 0; b < TRAIL_BANDS; b++) {
    const lo = Math.floor((b / TRAIL_BANDS) * (n - 1));
    const hi = Math.floor(((b + 1) / TRAIL_BANDS) * (n - 1));
    if (hi <= lo) continue;
    ctx.globalAlpha = ((b + 1) / TRAIL_BANDS) * 0.45;
    ctx.beginPath();
    ctx.moveTo(px(pts[lo].lat, pts[lo].lon), py(pts[lo].lat, pts[lo].lon));
    for (let i = lo + 1; i <= hi; i++) {
      ctx.lineTo(px(pts[i].lat, pts[i].lon), py(pts[i].lat, pts[i].lon));
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawContrail(
  ctx: CanvasRenderingContext2D,
  track: Track,
  px: (lat: number, lon: number) => number,
  py: (lat: number, lon: number) => number,
): void {
  const pts = track.trail;
  const n = pts.length;
  if (n < 2) return;
  const start = Math.max(1, n - 30);
  ctx.strokeStyle = "rgba(245, 248, 255, 1)";
  ctx.lineCap = "round";
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.14;
  ctx.beginPath();
  ctx.moveTo(px(pts[start - 1].lat, pts[start - 1].lon), py(pts[start - 1].lat, pts[start - 1].lon));
  for (let i = start; i < n; i++) {
    ctx.lineTo(px(pts[i].lat, pts[i].lon), py(pts[i].lat, pts[i].lon));
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineCap = "butt";
}

function drawLogo(
  ctx: CanvasRenderingContext2D,
  operator: string | undefined,
  pt: ScreenPoint,
  size: number,
  offset: number,
  scale: number,
): void {
  const img = getLogo(operator);
  if (!logoReady(img)) return;
  const w = Math.max(10, Math.min(30, size * 0.6)) * scale;
  const h = (img.naturalHeight / img.naturalWidth) * w;
  const dy = offset * size;
  ctx.globalAlpha = 0.95;
  ctx.drawImage(img, pt.x - w / 2, pt.y + dy - h / 2, w, h);
  ctx.globalAlpha = 1;
}

function drawSpotterPulse(
  ctx: CanvasRenderingContext2D,
  track: Track,
  pt: ScreenPoint,
  size: number,
  now: number,
): void {
  const age = now - track.firstSeen;
  if (age > 5000) {
    track.isNew = false;
    return;
  }
  const phase = (age % 1200) / 1200;
  const radius = size * 0.55 + phase * size * 0.9;
  const fade = (1 - phase) * (1 - age / 5000);
  ctx.strokeStyle = `rgba(255, 80, 80, ${0.7 * fade})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

// Soft red "danger" cloud drawn under an aircraft that has lost separation.
// Gently pulses so it reads as an active alert without distracting hard edges.
function drawConflictCloud(
  ctx: CanvasRenderingContext2D,
  pt: ScreenPoint,
  size: number,
  now: number,
): void {
  const pulse = 0.85 + 0.15 * Math.sin(now / 300);
  const radius = Math.max(26, size * 1.7) * pulse;
  const g = ctx.createRadialGradient(pt.x, pt.y, radius * 0.2, pt.x, pt.y, radius);
  g.addColorStop(0, "rgba(255, 50, 50, 0.34)");
  g.addColorStop(0.6, "rgba(255, 40, 40, 0.16)");
  g.addColorStop(1, "rgba(255, 30, 30, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

// Thin link between each conflicting pair (drawn once per pair).
function drawConflictLinks(
  ctx: CanvasRenderingContext2D,
  plotted: Plotted[],
  byHex: Map<string, Plotted>,
  now: number,
): void {
  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 4]);
  ctx.lineDashOffset = -(now / 60) % 9;
  ctx.strokeStyle = "rgba(255, 90, 90, 0.55)";
  for (const p of plotted) {
    const partnerHex = p.track.conflictPartner;
    if (!partnerHex) continue;
    // Draw once: only from the lexicographically smaller hex.
    if (p.track.data.hex > partnerHex) continue;
    const q = byHex.get(partnerHex);
    if (!q) continue;
    ctx.beginPath();
    ctx.moveTo(p.pt.x, p.pt.y);
    ctx.lineTo(q.pt.x, q.pt.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRadarOverlay(
  ctx: CanvasRenderingContext2D,
  projection: PlanarProjection,
  vp: Viewport,
  config: AirShowConfig,
): void {
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  const rings = 4;
  ctx.lineWidth = 1;
  ctx.strokeStyle = OVERLAY;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = OVERLAY_TEXT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  for (let i = 1; i <= rings; i++) {
    const miles = (config.radiusMiles / rings) * i;
    const r = projection.metersToPixels(milesToMeters(miles), vp);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(`${Math.round(miles)} mi`, cx + 4, cy - r);
  }

  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, vp.height);
  ctx.moveTo(0, cy);
  ctx.lineTo(vp.width, cy);
  ctx.stroke();

  const outer = projection.metersToPixels(milesToMeters(config.radiusMiles), vp);
  const angle = (Date.now() / 4000) % (Math.PI * 2);

  // Trailing afterglow wedge behind the leading edge (conic gradient is bright
  // at the beam and fades out over SWEEP_TRAIL radians of just-swept sky).
  const SWEEP_TRAIL = Math.PI / 2.2;
  const trailFrac = SWEEP_TRAIL / (Math.PI * 2);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.clip();
  const cone = ctx.createConicGradient(angle, cx, cy);
  cone.addColorStop(0, "rgba(120, 200, 160, 0)");
  cone.addColorStop(Math.max(0, 1 - trailFrac), "rgba(120, 200, 160, 0)");
  cone.addColorStop(1 - trailFrac * 0.5, "rgba(120, 200, 160, 0.025)");
  cone.addColorStop(1, "rgba(150, 230, 185, 0.10)");
  ctx.fillStyle = cone;
  ctx.fillRect(cx - outer, cy - outer, outer * 2, outer * 2);
  ctx.restore();

  // Crisp leading edge of the beam.
  const lead = ctx.createLinearGradient(
    cx,
    cy,
    cx + Math.cos(angle) * outer,
    cy + Math.sin(angle) * outer,
  );
  lead.addColorStop(0, "rgba(170, 245, 200, 0.35)");
  lead.addColorStop(1, "rgba(150, 230, 185, 0)");
  ctx.strokeStyle = lead;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
  ctx.stroke();

  ctx.fillStyle = OVERLAY_TEXT;
  ctx.font = "bold 14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("N", cx, 6);
  ctx.textBaseline = "bottom";
  ctx.fillText("S", cx, vp.height - 6);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("W", 6, cy);
  ctx.textAlign = "right";
  ctx.fillText("E", vp.width - 6, cy);
}

function drawHover(
  ctx: CanvasRenderingContext2D,
  plotted: Plotted[],
  mouse: { x: number; y: number } | null,
  cfg: AirShowConfig,
): void {
  if (!mouse) return;
  let nearest: Plotted | null = null;
  let best = Infinity;
  for (const p of plotted) {
    const d = Math.hypot(p.pt.x - mouse.x, p.pt.y - mouse.y);
    const hit = p.size / 2 + 8;
    if (d < hit && d < best) {
      best = d;
      nearest = p;
    }
  }
  if (!nearest) return;

  const { track, pt, cls, operator } = nearest;
  const a = track.data;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, nearest.size / 2 + 6, 0, Math.PI * 2);
  ctx.stroke();

  const vrate = a.verticalRateFpm ?? 0;
  const intent = intentFor(a.onGround, track.render.altFt, vrate);
  const vrTxt =
    !a.onGround && Math.abs(vrate) >= 100
      ? ` (${vrate > 0 ? "+" : ""}${Math.round(vrate)} fpm)`
      : "";
  const airline = airlineName(operator);
  const operatorLine = airline
    ? `${airline} · ${CLASS_META[cls].label}`
    : `${operator ?? "—"} · ${CLASS_META[cls].label}`;
  const lines = [
    a.callsign || a.hex.toUpperCase(),
    operatorLine,
    resolveRoute(track, cfg),
    `Intent: ${intent}${vrTxt}`,
    a.typeCode ? `Type ${a.typeCode}` : "Type ?",
    a.onGround ? "On ground" : `${Math.round(track.render.altFt).toLocaleString()} ft`,
    a.groundSpeedKt !== undefined ? `${Math.round(a.groundSpeedKt)} kt` : "",
    a.headingDeg !== undefined ? `Hdg ${Math.round(a.headingDeg)}\u00b0` : "",
    track.conflict ? "\u26a0 Proximity alert" : "",
  ].filter(Boolean);

  ctx.font = "12px system-ui, sans-serif";
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  const h = lines.length * 16 + 12;
  let bx = pt.x + nearest.size / 2 + 10;
  let by = pt.y - h / 2;
  bx = Math.min(bx, ctx.canvas.clientWidth - w - 4);
  by = Math.max(4, Math.min(by, ctx.canvas.clientHeight - h - 4));

  ctx.fillStyle = "rgba(10, 14, 18, 0.92)";
  ctx.strokeStyle = "rgba(150, 220, 180, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 6);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.fillStyle =
      i === 0 ? "rgba(235, 245, 240, 0.98)" : "rgba(190, 205, 200, 0.9)";
    ctx.fillText(line, bx + 8, by + 8 + i * 16);
  });
}
