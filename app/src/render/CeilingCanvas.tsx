import { useEffect, useMemo, useRef } from "react";
import { useStore } from "../state/store";
import { PlanarProjection, type Viewport, type ScreenPoint } from "../geo/projection";
import { milesToMeters, toLocalMeters } from "../geo/geo";
import type { Aircraft, AirShowConfig } from "../types";

interface Plotted {
  ac: Aircraft;
  pt: ScreenPoint;
}

const OVERLAY = "rgba(120, 200, 160, 0.16)"; // faint radar green, ~16% opacity
const OVERLAY_TEXT = "rgba(150, 220, 180, 0.55)";

/** Pale, desaturated altitude tint (low = warm white, high = cool). */
function altitudeColor(ac: Aircraft): string {
  if (ac.onGround) return "rgba(140, 150, 160, 0.85)";
  const alt = ac.altFt ?? 0;
  const t = Math.max(0, Math.min(1, alt / 40000));
  const r = Math.round(245 - t * 70);
  const g = Math.round(245 - t * 20);
  const b = Math.round(220 + t * 35);
  return `rgb(${r}, ${g}, ${b})`;
}

export function CeilingCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const config = useStore((s) => s.config);

  // Latest values exposed to the persistent animation loop via refs.
  const aircraftRef = useRef<Aircraft[]>([]);
  const configRef = useRef<AirShowConfig>(config);
  const plottedRef = useRef<Plotted[]>([]);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);

  aircraftRef.current = useStore((s) => s.aircraft);
  configRef.current = config;

  const projection = useMemo(
    () => new PlanarProjection(milesToMeters(config.radiusMiles)),
    [config.radiusMiles],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let vp: Viewport = { width: 0, height: 0 };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
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
      const { width, height } = vp;
      const cx = width / 2;
      const cy = height / 2;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);

      drawRadarOverlay(ctx, projection, vp, cx, cy, configRef.current);

      // Plot aircraft as dots with a short heading vector.
      const plotted: Plotted[] = [];
      for (const ac of aircraftRef.current) {
        const { east, north } = toLocalMeters(
          ac.lat,
          ac.lon,
          configRef.current.centerLat,
          configRef.current.centerLon,
        );
        const pt = projection.project(east, north, vp);
        if (pt.x < -20 || pt.x > width + 20 || pt.y < -20 || pt.y > height + 20) {
          continue;
        }
        plotted.push({ ac, pt });
        drawAircraftDot(ctx, ac, pt);
      }
      plottedRef.current = plotted;

      drawHover(ctx, plottedRef.current, mouseRef.current);

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

function drawRadarOverlay(
  ctx: CanvasRenderingContext2D,
  projection: PlanarProjection,
  vp: Viewport,
  cx: number,
  cy: number,
  config: AirShowConfig,
) {
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

  // Crosshair
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, vp.height);
  ctx.moveTo(0, cy);
  ctx.lineTo(vp.width, cy);
  ctx.stroke();

  // Slow rotating sweep
  const outer = projection.metersToPixels(milesToMeters(config.radiusMiles), vp);
  const angle = (Date.now() / 4000) % (Math.PI * 2);
  const grad = ctx.createLinearGradient(
    cx,
    cy,
    cx + Math.cos(angle) * outer,
    cy + Math.sin(angle) * outer,
  );
  grad.addColorStop(0, "rgba(120, 200, 160, 0.18)");
  grad.addColorStop(1, "rgba(120, 200, 160, 0)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
  ctx.stroke();

  // Compass labels
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

function drawAircraftDot(
  ctx: CanvasRenderingContext2D,
  ac: Aircraft,
  pt: ScreenPoint,
) {
  const color = altitudeColor(ac);

  // Heading vector
  if (ac.headingDeg !== undefined) {
    const rad = (ac.headingDeg * Math.PI) / 180;
    const len = 12;
    const dx = Math.sin(rad) * len;
    const dy = -Math.cos(rad) * len;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(pt.x + dx, pt.y + dy);
    ctx.stroke();
  }

  // Glow + dot
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawHover(
  ctx: CanvasRenderingContext2D,
  plotted: Plotted[],
  mouse: { x: number; y: number } | null,
) {
  if (!mouse) return;
  let nearest: Plotted | null = null;
  let bestDist = 18; // px hit radius
  for (const p of plotted) {
    const d = Math.hypot(p.pt.x - mouse.x, p.pt.y - mouse.y);
    if (d < bestDist) {
      bestDist = d;
      nearest = p;
    }
  }
  if (!nearest) return;

  const { ac, pt } = nearest;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
  ctx.stroke();

  const lines = [
    ac.callsign || ac.hex.toUpperCase(),
    ac.typeCode ? `Type ${ac.typeCode}` : "Type ?",
    ac.onGround ? "On ground" : `${Math.round(ac.altFt ?? 0).toLocaleString()} ft`,
    ac.groundSpeedKt !== undefined ? `${Math.round(ac.groundSpeedKt)} kt` : "",
    ac.headingDeg !== undefined ? `${Math.round(ac.headingDeg)}\u00b0` : "",
  ].filter(Boolean);

  ctx.font = "12px system-ui, sans-serif";
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  const h = lines.length * 16 + 12;
  let bx = pt.x + 14;
  let by = pt.y - h / 2;
  bx = Math.min(bx, ctx.canvas.clientWidth - w - 4);
  by = Math.max(4, by);

  ctx.fillStyle = "rgba(10, 14, 18, 0.92)";
  ctx.strokeStyle = "rgba(150, 220, 180, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(235, 245, 240, 0.95)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.fillStyle =
      i === 0 ? "rgba(235, 245, 240, 0.98)" : "rgba(190, 205, 200, 0.9)";
    ctx.fillText(line, bx + 8, by + 8 + i * 16);
  });
}
