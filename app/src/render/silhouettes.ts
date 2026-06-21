import type { AircraftClass } from "../identity/types";

/**
 * Draws a top-down aircraft silhouette centered at the current origin, nose
 * pointing toward -y (up). The caller is expected to translate/rotate the
 * context first. `span` is the approximate wingspan in pixels.
 */
export function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  cls: AircraftClass,
  span: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  switch (cls) {
    case "helicopter":
      return drawHelicopter(ctx, span, color);
    case "ga":
      return drawGA(ctx, span, color);
    case "military":
      return drawMilitary(ctx, span);
    case "jumbo":
      return drawJet(ctx, span, { wing: 1.06, engines: 4, lenF: 1.12, sweep: 0.26 });
    case "widebody":
      return drawJet(ctx, span, { wing: 1.0, engines: 2, lenF: 1.08, sweep: 0.24 });
    case "regional":
      return drawJet(ctx, span, { wing: 0.86, engines: 2, lenF: 0.92, sweep: 0.16 });
    case "narrowbody":
      return drawJet(ctx, span, { wing: 0.95, engines: 2, lenF: 1.0, sweep: 0.2 });
    default:
      return drawJet(ctx, span, { wing: 0.9, engines: 2, lenF: 0.95, sweep: 0.18 });
  }
}

interface JetOpts {
  wing: number;
  engines: 2 | 4;
  lenF: number;
  sweep: number;
}

function drawWing(
  ctx: CanvasRenderingContext2D,
  sign: number,
  fw: number,
  wy: number,
  half: number,
  sweep: number,
  rootC: number,
  tipC: number,
): void {
  ctx.beginPath();
  ctx.moveTo(sign * fw * 0.6, wy - rootC * 0.4);
  ctx.lineTo(sign * half, wy + sweep);
  ctx.lineTo(sign * half, wy + sweep + tipC);
  ctx.lineTo(sign * fw * 0.6, wy + rootC * 0.6);
  ctx.closePath();
  ctx.fill();
}

function drawJet(ctx: CanvasRenderingContext2D, s: number, o: JetOpts): void {
  const L = s * 1.05 * o.lenF;
  const fw = s * 0.06 + 1.5; // fuselage half-width
  const wy = s * 0.02;
  const half = s * 0.5 * o.wing;
  const sweep = s * o.sweep;
  const rootC = s * 0.3;
  const tipC = s * 0.07;

  // Fuselage capsule + nose
  ctx.beginPath();
  ctx.ellipse(0, 0, fw, L / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -L / 2 - s * 0.05);
  ctx.lineTo(-fw, -L / 2 + s * 0.04);
  ctx.lineTo(fw, -L / 2 + s * 0.04);
  ctx.closePath();
  ctx.fill();

  // Main wings
  drawWing(ctx, -1, fw, wy, half, sweep, rootC, tipC);
  drawWing(ctx, +1, fw, wy, half, sweep, rootC, tipC);

  // Tailplane
  const ty = L / 2 - s * 0.1;
  const tHalf = s * 0.2;
  drawWing(ctx, -1, fw, ty, tHalf, sweep * 0.5, s * 0.12, s * 0.04);
  drawWing(ctx, +1, fw, ty, tHalf, sweep * 0.5, s * 0.12, s * 0.04);

  // Engines (nacelles under wings)
  const er = s * 0.05;
  const engY = wy + sweep * 0.55;
  const positions =
    o.engines === 4
      ? [half * 0.42, half * 0.7]
      : [half * 0.45];
  for (const px of positions) {
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sign * px, engY, er, er * 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawGA(ctx: CanvasRenderingContext2D, s: number, color: string): void {
  const L = s * 0.8;
  const fw = s * 0.06 + 1.2;
  // Fuselage
  ctx.beginPath();
  ctx.ellipse(0, 0, fw, L / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Straight (unswept) high wings
  const half = s * 0.5;
  const chord = s * 0.16;
  ctx.fillRect(-half, -chord / 2 - s * 0.02, half * 2, chord);
  // Tailplane
  const tHalf = s * 0.2;
  ctx.fillRect(-tHalf, L / 2 - s * 0.12, tHalf * 2, s * 0.07);
  // Propeller disc at nose
  ctx.save();
  ctx.globalAlpha *= 0.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, -L / 2 - s * 0.02, s * 0.16, s * 0.04, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHelicopter(
  ctx: CanvasRenderingContext2D,
  s: number,
  color: string,
): void {
  // Fuselage pod
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.12, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  // Tail boom
  ctx.fillRect(-s * 0.03, s * 0.18, s * 0.06, s * 0.34);
  // Tail rotor
  ctx.fillRect(-s * 0.1, s * 0.5, s * 0.2, s * 0.03);
  // Main rotor disc (translucent)
  ctx.save();
  ctx.globalAlpha *= 0.32;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2);
  ctx.stroke();
  // Rotor blades
  ctx.globalAlpha *= 1.6;
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, 0);
  ctx.lineTo(s * 0.5, 0);
  ctx.moveTo(0, -s * 0.5);
  ctx.lineTo(0, s * 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawMilitary(ctx: CanvasRenderingContext2D, s: number): void {
  const L = s * 1.0;
  const fw = s * 0.07;
  // Pointed fuselage
  ctx.beginPath();
  ctx.moveTo(0, -L / 2 - s * 0.08);
  ctx.lineTo(-fw, 0);
  ctx.lineTo(-fw * 0.7, L / 2);
  ctx.lineTo(fw * 0.7, L / 2);
  ctx.lineTo(fw, 0);
  ctx.closePath();
  ctx.fill();
  // Delta wings
  const half = s * 0.48;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.05);
  ctx.lineTo(-half, s * 0.34);
  ctx.lineTo(-fw * 0.7, s * 0.34);
  ctx.lineTo(0, s * 0.18);
  ctx.lineTo(fw * 0.7, s * 0.34);
  ctx.lineTo(half, s * 0.34);
  ctx.closePath();
  ctx.fill();
  // Tail fins
  ctx.beginPath();
  ctx.moveTo(0, s * 0.2);
  ctx.lineTo(-s * 0.16, s * 0.46);
  ctx.lineTo(s * 0.16, s * 0.46);
  ctx.closePath();
  ctx.fill();
}
