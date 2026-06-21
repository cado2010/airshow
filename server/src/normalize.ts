import type { Aircraft } from "./types.js";

/**
 * Raw aircraft shape from readsb / re-api (ADSBexchange v2-compatible).
 * Fields are optional because providers omit anything they don't have.
 */
interface RawAircraft {
  hex?: string;
  flight?: string;
  r?: string; // registration
  t?: string; // ICAO type code
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  track?: number;
  true_heading?: number;
  mag_heading?: number;
  gs?: number;
  baro_rate?: number;
  geom_rate?: number;
}

interface RawFeed {
  ac?: RawAircraft[];
  aircraft?: RawAircraft[];
  now?: number;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function normalizeOne(raw: RawAircraft): Aircraft | null {
  if (!raw.hex) return null;
  const lat = num(raw.lat);
  const lon = num(raw.lon);
  if (lat === undefined || lon === undefined) return null;

  const onGround = raw.alt_baro === "ground";
  const altFt = onGround ? 0 : num(raw.alt_baro) ?? num(raw.alt_geom);

  const heading =
    num(raw.track) ?? num(raw.true_heading) ?? num(raw.mag_heading);

  const callsign = raw.flight?.trim() || undefined;

  return {
    hex: raw.hex.toLowerCase(),
    callsign,
    typeCode: raw.t?.trim() || undefined,
    lat,
    lon,
    altFt,
    onGround,
    headingDeg: heading,
    groundSpeedKt: num(raw.gs),
    verticalRateFpm: num(raw.baro_rate) ?? num(raw.geom_rate),
  };
}

/** Convert a provider's raw JSON feed into normalized aircraft. */
export function normalizeFeed(data: unknown): Aircraft[] {
  const feed = data as RawFeed;
  const list = feed?.ac ?? feed?.aircraft ?? [];
  if (!Array.isArray(list)) return [];
  const out: Aircraft[] = [];
  for (const raw of list) {
    const a = normalizeOne(raw);
    if (a) out.push(a);
  }
  return out;
}
