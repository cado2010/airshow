// Trajectory inference: derive the airport an aircraft is arriving at / departing
// from, using only live ADS-B state + the local airport set. This is the "near
// end" the aircraft is physically demonstrating; it's authoritative and real
// time, and it tells us which leg OpenSky/adsbdb data actually refers to.
import { airportsInView, type Airport } from "./airports";

export type EndpointKind = "arrival" | "departure";

export interface ObservedEndpoint {
  kind: EndpointKind;
  airport: Airport;
  distanceNm: number;
}

export interface AircraftLike {
  lat: number;
  lon: number;
  altFt: number;
  verticalRateFpm: number;
  headingDeg?: number;
  onGround: boolean;
}

const NM_PER_DEG = 60;

function distanceNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat2 - lat1) * NM_PER_DEG;
  const dLon =
    (lon2 - lon1) * NM_PER_DEG * Math.cos(((lat1 + lat2) / 2 * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = lat2 - lat1;
  const dLon = (lon2 - lon1) * Math.cos((lat1 * Math.PI) / 180);
  return (((Math.atan2(dLon, dLat) * 180) / Math.PI) + 360) % 360;
}

function angleDelta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

/**
 * Returns the airport the aircraft is observably arriving at or departing from,
 * or null when it can't be determined (e.g. at cruise, or no terminal in view).
 * Pure + cheap: scans only the memoized in-view airport set.
 */
export function inferEndpoint(
  ac: AircraftLike,
  centerLat: number,
  centerLon: number,
  viewRadiusNm: number,
): ObservedEndpoint | null {
  if (ac.onGround) return null;
  if (ac.altFt > 12000) return null; // too high to be terminal traffic

  const vr = ac.verticalRateFpm;
  const climbing = vr > 300;
  const descending = vr < -300;
  if (!climbing && !descending) return null;

  const candidates = airportsInView(centerLat, centerLon, viewRadiusNm + 15);
  if (candidates.length === 0) return null;

  const hdg = ac.headingDeg ?? 0;
  let best: ObservedEndpoint | null = null;
  let bestScore = -Infinity;

  for (const a of candidates) {
    const d = distanceNm(ac.lat, ac.lon, a.lat, a.lon);
    if (d > 18) continue;
    const off = Math.abs(angleDelta(hdg, bearing(ac.lat, ac.lon, a.lat, a.lon)));

    let kind: EndpointKind | null = null;
    if (descending && off < 70) kind = "arrival";
    else if (climbing && off > 110) kind = "departure";
    if (!kind) continue;

    const align = kind === "arrival" ? 70 - off : off - 110;
    const score = (18 - d) * 2 + align * 0.5 + a.importance * 2;
    if (score > bestScore) {
      bestScore = score;
      best = { kind, airport: a, distanceNm: d };
    }
  }
  return best;
}
