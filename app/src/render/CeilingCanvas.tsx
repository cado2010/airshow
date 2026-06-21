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
import { getRoute, airportCode, airportCity } from "../identity/routes";
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

/** Popup route line: "Route: ORIG → DEST", "Route: …" while loading, or "". */
function routeLine(callsign: string | undefined, cityNames: boolean): string {
  const route = getRoute(callsign);
  if (route === undefined) return "Route: \u2026";
  if (route === null) return "";
  const pick = cityNames ? airportCity : airportCode;
  const from = pick(route.origin);
  const to = pick(route.destination);
  if (!from && !to) return "";
  return `Route: ${from ?? "?"} \u2192 ${to ?? "?"}`;
}

export function CeilingCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const config = useStore((s) => s.config);

  const aircraft = useStore((s) => s.aircraft);
  const configRef = useRef<AirShowConfig>(config);
  const tmRef = useRef<TrackManager>(new TrackManager());
  const plottedRef = useRef<Plotted[]>([]);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);

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
      const plotted: Plotted[] = [];

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

        // Silhouette (rotated to heading)
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate((r.headingDeg * Math.PI) / 180);
        ctx.globalAlpha = track.data.onGround ? 0.8 : alpha;
        drawSilhouette(ctx, cls, size, color);
        ctx.restore();

        drawLogo(ctx, operator, pt, size, cfg.logoOffset);
        if (track.isNew) drawSpotterPulse(ctx, track, pt, size, now);

        plotted.push({ track, pt, size, cls, operator });
      }

      plottedRef.current = plotted;
      drawHover(ctx, plotted, mouseRef.current, cfg.routeCityNames);

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
): void {
  const img = getLogo(operator);
  if (!logoReady(img)) return;
  const w = Math.max(10, Math.min(30, size * 0.6));
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
  const grad = ctx.createLinearGradient(
    cx,
    cy,
    cx + Math.cos(angle) * outer,
    cy + Math.sin(angle) * outer,
  );
  grad.addColorStop(0, "rgba(120, 200, 160, 0.16)");
  grad.addColorStop(1, "rgba(120, 200, 160, 0)");
  ctx.strokeStyle = grad;
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
  cityNames: boolean,
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
    routeLine(a.callsign, cityNames),
    `Intent: ${intent}${vrTxt}`,
    a.typeCode ? `Type ${a.typeCode}` : "Type ?",
    a.onGround ? "On ground" : `${Math.round(track.render.altFt).toLocaleString()} ft`,
    a.groundSpeedKt !== undefined ? `${Math.round(a.groundSpeedKt)} kt` : "",
    a.headingDeg !== undefined ? `Hdg ${Math.round(a.headingDeg)}\u00b0` : "",
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
