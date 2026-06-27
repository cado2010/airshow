import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { Viewport, ScreenPoint } from "../geo/projection";
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
import { airportsInView, airportsReady, loadAirports } from "../identity/airports";
import { resolveRouteLine } from "../identity/routeResolve";
import { intentFor } from "../identity/intent";
import { ShowcaseController } from "../showcase/ShowcaseController";
import { ShowcaseCard } from "../components/ShowcaseCard";
import type { AirShowConfig } from "../types";

const OVERLAY = "rgba(120, 200, 160, 0.16)";
const OVERLAY_TEXT = "rgba(150, 220, 180, 0.55)";
const M_PER_DEG_LAT = 111_132;
// Fraction of the half-viewport the outermost radar ring fills (matches the
// PlanarProjection default so committed zoom levels look identical pre/post).
const PADDING_FACTOR = 0.92;
// Radar radius bounds (miles) for zoom; mirrors the config slider range.
const RADIUS_MIN = 2;
const RADIUS_MAX = 150;

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

export function CeilingCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);

  const aircraft = useStore((s) => s.aircraft);
  const configRef = useRef<AirShowConfig>(config);
  const tmRef = useRef<TrackManager>(new TrackManager());
  const plottedRef = useRef<Plotted[]>([]);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const lastConflictRef = useRef(0);
  // Live gesture-preview of the map view. While a zoom/pan gesture is in
  // progress, `active` is true and the render loop reads radius/center from here
  // (smooth, no re-fetch). On gesture end we commit these into config (which
  // re-centers the radar + re-fetches), and a layout effect clears `active` so
  // the committed values take over with no visual jump.
  const viewRef = useRef({
    active: false,
    radiusMiles: config.radiusMiles,
    centerLat: config.centerLat,
    centerLon: config.centerLon,
  });
  const showcaseRef = useRef<ShowcaseController>(new ShowcaseController());
  const showcaseAnchorRef = useRef<HTMLDivElement>(null);
  const showcaseHexRef = useRef<string | null>(null);
  const showcaseKeyRef = useRef("");
  const [showcaseHex, setShowcaseHex] = useState<string | null>(null);

  configRef.current = config;

  // Whenever the committed view (center/radius) changes from any source —
  // gesture commit, preset pick, search, slider — drop the live preview so the
  // config values are what we render. Runs before paint to avoid a flicker.
  useLayoutEffect(() => {
    viewRef.current.active = false;
  }, [config.radiusMiles, config.centerLat, config.centerLon]);

  useEffect(() => {
    void loadLogoManifest();
  }, []);

  // Feed new server data into the interpolating track manager.
  useEffect(() => {
    tmRef.current.ingest(aircraft, Date.now());
  }, [aircraft]);

  // Zoom + pan interactions. Zoom changes the radar RADIUS (zoom in = smaller
  // radius); pan recenters the map (lat/lon). Desktop: wheel = zoom (about the
  // center), click-drag = pan. Touch: one finger = pan, pinch = zoom. During a
  // gesture we mutate the live-preview viewRef for smooth feedback, then commit
  // to config on gesture end (which re-fetches for the new area). Native
  // listeners (not React props) so we can preventDefault on wheel/touch and keep
  // dragging outside the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const clamp = (v: number, lo: number, hi: number) =>
      Math.max(lo, Math.min(hi, v));

    // Seed the live preview from the current committed config when a gesture
    // starts, so we mutate from the right baseline.
    const begin = () => {
      const v = viewRef.current;
      if (!v.active) {
        const c = configRef.current;
        v.radiusMiles = c.radiusMiles;
        v.centerLat = c.centerLat;
        v.centerLon = c.centerLon;
        v.active = true;
      }
    };

    // Pixels per meter at the current live radius for the given canvas rect.
    const ppm = (rect: DOMRect) =>
      ((Math.min(rect.width, rect.height) / 2) * PADDING_FACTOR) /
      milesToMeters(viewRef.current.radiusMiles);

    // factor < 1 shrinks the radius (zoom in), > 1 grows it (zoom out).
    const zoomBy = (factor: number) => {
      begin();
      const v = viewRef.current;
      v.radiusMiles = clamp(v.radiusMiles * factor, RADIUS_MIN, RADIUS_MAX);
    };

    // Drag delta in CSS pixels -> shift of the geographic center.
    const panBy = (dx: number, dy: number) => {
      begin();
      const v = viewRef.current;
      const s = ppm(canvas.getBoundingClientRect());
      const mPerDegLon =
        M_PER_DEG_LAT * Math.cos((v.centerLat * Math.PI) / 180) || 1;
      v.centerLon -= dx / (mPerDegLon * s);
      v.centerLat += dy / (M_PER_DEG_LAT * s);
    };

    // Push the live preview into config; the layout effect clears `active`.
    const commit = () => {
      const v = viewRef.current;
      if (!v.active) return;
      setConfig({
        radiusMiles: Number(v.radiusMiles.toFixed(1)),
        centerLat: Number(v.centerLat.toFixed(4)),
        centerLon: Number(v.centerLon.toFixed(4)),
        locationLabel: "Custom",
      });
    };

    let wheelTimer = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Scroll up (deltaY < 0) -> factor < 1 -> smaller radius -> zoom in.
      zoomBy(Math.exp(e.deltaY * 0.0015));
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(commit, 350);
    };

    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.style.cursor = "grabbing";
    };
    const onMove = (e: MouseEvent) => {
      if (dragging) {
        moved = true;
        panBy(e.clientX - lastX, e.clientY - lastY);
        lastX = e.clientX;
        lastY = e.clientY;
        mouseRef.current = null; // suppress hover tooltip while panning
      } else if (e.target === canvas) {
        const rect = canvas.getBoundingClientRect();
        mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      } else {
        mouseRef.current = null;
      }
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = "grab";
      if (moved) commit();
    };
    const onLeave = () => {
      mouseRef.current = null;
    };

    let touchMode: "none" | "pan" | "pinch" = "none";
    let tx = 0;
    let ty = 0;
    let pinchDist = 0;
    const tdist = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchMode = "pan";
        tx = e.touches[0].clientX;
        ty = e.touches[0].clientY;
        mouseRef.current = null;
      } else if (e.touches.length >= 2) {
        touchMode = "pinch";
        pinchDist = tdist(e.touches[0], e.touches[1]);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (touchMode === "pan" && e.touches.length === 1) {
        const t = e.touches[0];
        panBy(t.clientX - tx, t.clientY - ty);
        tx = t.clientX;
        ty = t.clientY;
      } else if (touchMode === "pinch" && e.touches.length >= 2) {
        const nd = tdist(e.touches[0], e.touches[1]);
        // Expand (nd > pinchDist) -> ratio < 1 -> smaller radius -> zoom in.
        if (pinchDist > 0 && nd > 0) zoomBy(pinchDist / nd);
        pinchDist = nd;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        touchMode = "none";
        commit();
      } else if (e.touches.length === 1) {
        touchMode = "pan";
        tx = e.touches[0].clientX;
        ty = e.touches[0].clientY;
      }
    };

    // iOS Safari fires non-standard gesture* events for pinch and will page-zoom
    // even with touch-action:none unless we cancel them. Our touch handlers do
    // the actual zooming, so here we just block the browser's default.
    const onGesture = (e: Event) => e.preventDefault();

    canvas.style.cursor = "grab";
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("gesturestart", onGesture as EventListener);
    canvas.addEventListener("gesturechange", onGesture as EventListener);
    canvas.addEventListener("gestureend", onGesture as EventListener);

    return () => {
      window.clearTimeout(wheelTimer);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("gesturestart", onGesture as EventListener);
      canvas.removeEventListener("gesturechange", onGesture as EventListener);
      canvas.removeEventListener("gestureend", onGesture as EventListener);
    };
  }, [setConfig]);

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

      const cfg = configRef.current;
      // During a zoom/pan gesture the live preview drives radius+center (smooth,
      // no re-fetch); otherwise we use the committed config. The radar is always
      // centered on the screen — pan is baked into centerLat/centerLon.
      const view = viewRef.current;
      const radiusMiles = view.active ? view.radiusMiles : cfg.radiusMiles;
      const centerLat = view.active ? view.centerLat : cfg.centerLat;
      const centerLon = view.active ? view.centerLon : cfg.centerLon;
      const s =
        ((Math.min(vp.width, vp.height) / 2) * PADDING_FACTOR) /
        milesToMeters(radiusMiles);
      const cx = vp.width / 2;
      const cy = vp.height / 2;

      drawRadarOverlay(ctx, vp, radiusMiles, cx, cy, s);

      const mPerDegLon = M_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
      const px = (_lat: number, lon: number): number =>
        cx + (lon - centerLon) * mPerDegLon * s;
      const py = (lat: number, _lon: number): number =>
        cy - (lat - centerLat) * M_PER_DEG_LAT * s;
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

      // Auto-show ("attract mode"): cheap per-frame selection; only flips React
      // state when the featured aircraft changes (~every 5–8s).
      const sc = showcaseRef.current.update(
        plotted.map((p) => p.track.data.hex),
        now,
        cfg.autoShowEnabled,
      );
      const scKey = `${sc.visible ? 1 : 0}:${sc.hex ?? ""}`;
      if (scKey !== showcaseKeyRef.current) {
        showcaseKeyRef.current = scKey;
        showcaseHexRef.current = sc.visible ? sc.hex : null;
        setShowcaseHex(sc.visible ? sc.hex : null);
      }
      const selHex = showcaseHexRef.current;
      if (selHex) {
        const p = byHex.get(selHex);
        if (p) {
          drawShowcaseHighlight(ctx, p.pt, p.size, now);
          positionShowcase(showcaseAnchorRef.current, p.pt, vp);
        }
      }

      plottedRef.current = plotted;
      drawHover(ctx, plotted, mouseRef.current, cfg);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="ceiling-canvas" />
      {showcaseHex && (
        <div className="showcase-anchor" ref={showcaseAnchorRef}>
          <ShowcaseCard hex={showcaseHex} cfg={config} />
        </div>
      )}
    </>
  );
}

// Distinct (cyan) pulsing ring marking the aircraft featured by the auto-show,
// so viewers can spot which dot the card refers to.
function drawShowcaseHighlight(
  ctx: CanvasRenderingContext2D,
  pt: ScreenPoint,
  size: number,
  now: number,
): void {
  const pulse = (now % 1500) / 1500;
  const r = size * 0.6 + pulse * size * 0.9;
  ctx.strokeStyle = `rgba(120, 220, 255, ${0.85 * (1 - pulse)})`;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(150, 230, 255, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, size * 0.6, 0, Math.PI * 2);
  ctx.stroke();
}

// Position the (DOM) showcase card beside the featured aircraft each frame,
// clamped to the viewport. Done directly on the element to avoid React churn.
function positionShowcase(
  el: HTMLDivElement | null,
  pt: ScreenPoint,
  vp: Viewport,
): void {
  if (!el) return;
  const m = 16;
  const w = el.offsetWidth || 260;
  const h = el.offsetHeight || 160;
  let x = pt.x + 44;
  if (x + w > vp.width - m) x = pt.x - 44 - w; // flip to the left if no room
  x = Math.max(m, Math.min(x, vp.width - w - m));
  let y = pt.y - h / 2;
  y = Math.max(m, Math.min(y, vp.height - h - m));
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
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
  vp: Viewport,
  radiusMiles: number,
  cx: number,
  cy: number,
  ppm: number, // pixels per meter (includes zoom)
): void {
  const rings = 4;
  ctx.lineWidth = 1;
  ctx.strokeStyle = OVERLAY;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = OVERLAY_TEXT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  for (let i = 1; i <= rings; i++) {
    const miles = (radiusMiles / rings) * i;
    const r = milesToMeters(miles) * ppm;
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

  const outer = milesToMeters(radiusMiles) * ppm;
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
    resolveRouteLine(a, cfg),
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
