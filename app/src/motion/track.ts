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
  /** Set by TrackManager.detectConflicts: too close to another aircraft. */
  conflict = false;
  /** hex of the nearest conflicting aircraft (for drawing the link), if any. */
  conflictPartner: string | null = null;
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

  // Pairs flagged on the previous scan, so hysteresis can hold a conflict until
  // separation grows past HOLD_FACTOR× the threshold (prevents boundary flicker).
  private prevPairs = new Set<string>();

  /**
   * Flag aircraft that lose separation from each other. Aviation separation is
   * two-dimensional: a conflict requires BOTH horizontal (< horizNm) AND
   * vertical (< vertFt) minima to be breached simultaneously. Cheap enough to
   * run on the data tick — uses raw positions, a bounding-box early-out, and
   * only marks a boolean per track (rendering just reads the flag).
   *
   * Terminal-airspace rule: aircraft on approach legitimately fly much closer
   * (in-trail / parallel runways), so when BOTH aircraft are low and near an
   * airport we switch to a tighter threshold — there's still a loss-of-
   * separation rule there, just a smaller one.
   */
  detectConflicts(opts: ConflictOptions): void {
    const tracks = [...this.tracks.values()];
    for (const t of tracks) {
      t.conflict = false;
      t.conflictPartner = null;
    }
    if (!opts.enabled) {
      this.prevPairs.clear();
      return;
    }

    // Only airborne aircraft with a known altitude can be in conflict.
    const cand = tracks.filter((t) => !t.data.onGround && t.data.altFt !== undefined);

    const HOLD = 1.2; // hysteresis factor
    const horizM = opts.horizNm * 1852;
    const vertFt = opts.vertFt;
    const nearHorizM = opts.nearHorizNm * 1852;
    const nearVertFt = opts.nearVertFt;
    // Widest gate any pair could need, for the bounding-box early-out.
    const maxHorizM = Math.max(horizM, nearHorizM) * HOLD;
    const maxVertFt = Math.max(vertFt, nearVertFt) * HOLD;

    // Precompute which candidates are in terminal (near-airport, low) airspace.
    const terminal = new Map<string, boolean>();
    if (opts.tighterNearAirport && opts.airports.length > 0) {
      const termM = opts.terminalRadiusNm * 1852;
      for (const t of cand) {
        terminal.set(t.data.hex, inTerminal(t, opts.airports, termM, opts.terminalMaxAltFt));
      }
    }

    const bestSep = new Map<string, number>(); // hex -> nearest partner horiz (m)
    const nextPairs = new Set<string>();

    for (let i = 0; i < cand.length; i++) {
      const a = cand[i];
      const aLat = a.data.lat;
      const aLon = a.data.lon;
      const aAlt = a.data.altFt!;
      const mPerDegLon = M_PER_DEG_LAT * Math.cos((aLat * Math.PI) / 180) || 1;

      for (let j = i + 1; j < cand.length; j++) {
        const b = cand[j];
        const dVert = Math.abs(aAlt - b.data.altFt!);
        if (dVert >= maxVertFt) continue; // vertical early-out

        const dN = (b.data.lat - aLat) * M_PER_DEG_LAT;
        if (Math.abs(dN) >= maxHorizM) continue; // latitude early-out
        const dE = (b.data.lon - aLon) * mPerDegLon;
        if (Math.abs(dE) >= maxHorizM) continue; // longitude early-out

        // Tighter minima when both are operating in the same terminal airspace.
        const tight =
          opts.tighterNearAirport &&
          terminal.get(a.data.hex) === true &&
          terminal.get(b.data.hex) === true;
        const hM = tight ? nearHorizM : horizM;
        const vF = tight ? nearVertFt : vertFt;

        const dHoriz = Math.hypot(dN, dE);
        const key = a.data.hex < b.data.hex
          ? `${a.data.hex}|${b.data.hex}`
          : `${b.data.hex}|${a.data.hex}`;

        const enter = dHoriz < hM && dVert < vF;
        const hold = dHoriz < hM * HOLD && dVert < vF * HOLD;
        const active = enter || (this.prevPairs.has(key) && hold);
        if (!active) continue;

        nextPairs.add(key);
        a.conflict = true;
        b.conflict = true;
        if (dHoriz < (bestSep.get(a.data.hex) ?? Infinity)) {
          bestSep.set(a.data.hex, dHoriz);
          a.conflictPartner = b.data.hex;
        }
        if (dHoriz < (bestSep.get(b.data.hex) ?? Infinity)) {
          bestSep.set(b.data.hex, dHoriz);
          b.conflictPartner = a.data.hex;
        }
      }
    }

    this.prevPairs = nextPairs;
  }
}

export interface ConflictOptions {
  enabled: boolean;
  horizNm: number;
  vertFt: number;
  tighterNearAirport: boolean;
  nearHorizNm: number;
  nearVertFt: number;
  /** Candidate airports (in view) used to detect terminal airspace. */
  airports: { lat: number; lon: number }[];
  terminalRadiusNm: number;
  terminalMaxAltFt: number;
}

function inTerminal(
  t: Track,
  airports: { lat: number; lon: number }[],
  radiusM: number,
  maxAltFt: number,
): boolean {
  if ((t.data.altFt ?? 0) > maxAltFt) return false;
  const lat = t.data.lat;
  const lon = t.data.lon;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180) || 1;
  for (const ap of airports) {
    const dN = (ap.lat - lat) * M_PER_DEG_LAT;
    if (Math.abs(dN) >= radiusM) continue;
    const dE = (ap.lon - lon) * mPerDegLon;
    if (Math.abs(dE) >= radiusM) continue;
    if (Math.hypot(dN, dE) < radiusM) return true;
  }
  return false;
}
