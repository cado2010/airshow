/** Normalized aircraft DTO shared across the wire (server -> app). */
export interface Aircraft {
  hex: string;
  callsign?: string;
  typeCode?: string;
  lat: number;
  lon: number;
  altFt?: number;
  onGround: boolean;
  headingDeg?: number;
  groundSpeedKt?: number;
  verticalRateFpm?: number;
}

export interface AircraftResponse {
  /** Server timestamp (ms) when this snapshot was produced. */
  now: number;
  /** Which upstream provider served the data (or "cache"). */
  source: string;
  /** Whether this payload came from the cache rather than a fresh fetch. */
  cached: boolean;
  aircraft: Aircraft[];
}
