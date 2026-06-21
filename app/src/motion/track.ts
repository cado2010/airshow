import type { Aircraft } from "../types";

const KNOTS_TO_MPS = 0.514444;
const M_PER_DEG_LAT = 111_132;

export interface RenderState {
  lat: number;
  lon: number;
  altFt: number;
  headingDeg: number;
}

export interface TrailPoint {
  lat: number;
  lon: number;
  t: number;
}

interface Fix {
  lat: number;
  lon: number;
  altFt: number;
  headingDeg: number;
  gs: number;
  vrate: number;
  t: number;
}

function bearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = lat2 - lat1;
  const dLon = (lon2 - lon1) * Math.cos((lat1 * Math.PI) / 180);
  const deg = (Math.atan2(dLon, dLat) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Shortest signed angular difference a->b in degrees, range (-180, 180]. */
function angleDelta(a: number, b: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (d === -180) d = 180;
  return d;
}

export class Track {
  data: Aircraft;
  render: RenderState;
  trail: TrailPoint[] = [];
  firstSeen: number;
  isNew: boolean;
  lastUpdate: number;
  private fix: Fix;
  private lastTrailAt = 0;

  constructor(a: Aircraft, now: number, markNew: boolean) {
    this.data = a;
    this.fix = toFix(a, now);
    this.render = {
      lat: a.lat,
      lon: a.lon,
      altFt: a.altFt ?? 0,
      headingDeg: this.fix.headingDeg,
      // keep order tidy
    };
    this.firstSeen = now;
    this.isNew = markNew;
    this.lastUpdate = now;
  }

  update(a: Aircraft, now: number): void {
    const prev = this.fix;
    const next = toFix(a, now);
    // Derive heading from movement when the feed doesn't report a track.
    if (a.headingDeg === undefined) {
      const moved =
        Math.abs(next.lat - prev.lat) > 1e-5 ||
        Math.abs(next.lon - prev.lon) > 1e-5;
      if (moved) next.headingDeg = bearing(prev.lat, prev.lon, next.lat, next.lon);
      else next.headingDeg = prev.headingDeg;
    }
    this.data = a;
    this.fix = next;
    this.lastUpdate = now;
  }

  /** Advance render state toward the dead-reckoned target. */
  step(now: number, frameDt: number): void {
    const f = this.fix;
    const dt = Math.min((now - f.t) / 1000, 12); // cap extrapolation
    const distM = f.gs * KNOTS_TO_MPS * dt;
    const hdgRad = (f.headingDeg * Math.PI) / 180;
    const north = Math.cos(hdgRad) * distM;
    const east = Math.sin(hdgRad) * distM;
    const mPerDegLon = M_PER_DEG_LAT * Math.cos((f.lat * Math.PI) / 180) || 1;
    const targetLat = f.lat + north / M_PER_DEG_LAT;
    const targetLon = f.lon + east / mPerDegLon;
    const targetAlt = f.altFt + (f.vrate / 60) * dt;

    const k = 1 - Math.exp(-frameDt / 0.4); // ~0.4s smoothing time constant
    this.render.lat += (targetLat - this.render.lat) * k;
    this.render.lon += (targetLon - this.render.lon) * k;
    this.render.altFt += (targetAlt - this.render.altFt) * k;
    this.render.headingDeg +=
      angleDelta(this.render.headingDeg, f.headingDeg) * k;

    if (now - this.lastTrailAt > 1000) {
      this.lastTrailAt = now;
      this.trail.push({ lat: this.render.lat, lon: this.render.lon, t: now });
    }
  }

  trimTrail(now: number, durationMs: number): void {
    const cutoff = now - durationMs;
    let i = 0;
    while (i < this.trail.length && this.trail[i].t < cutoff) i++;
    if (i > 0) this.trail.splice(0, i);
  }
}

function toFix(a: Aircraft, now: number): Fix {
  return {
    lat: a.lat,
    lon: a.lon,
    altFt: a.altFt ?? 0,
    headingDeg: a.headingDeg ?? 0,
    gs: a.onGround ? 0 : a.groundSpeedKt ?? 0,
    vrate: a.verticalRateFpm ?? 0,
    t: now,
  };
}

export class TrackManager {
  private tracks = new Map<string, Track>();
  private initialized = false;
  private lastFrame = 0;
  trailDurationMs = 120_000;
  /** Drop tracks not seen for this long. */
  private dropAfterMs = 30_000;

  ingest(list: Aircraft[], now: number): void {
    const seen = new Set<string>();
    for (const a of list) {
      seen.add(a.hex);
      const existing = this.tracks.get(a.hex);
      if (existing) {
        existing.update(a, now);
      } else {
        this.tracks.set(a.hex, new Track(a, now, this.initialized));
      }
    }
    for (const [hex, t] of this.tracks) {
      if (!seen.has(hex) && now - t.lastUpdate > this.dropAfterMs) {
        this.tracks.delete(hex);
      }
    }
    this.initialized = true;
  }

  frame(now: number): Track[] {
    const frameDt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : 0.016;
    this.lastFrame = now;
    const out: Track[] = [];
    for (const t of this.tracks.values()) {
      t.step(now, frameDt);
      t.trimTrail(now, this.trailDurationMs);
      out.push(t);
    }
    return out;
  }
}
