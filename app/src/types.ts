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
  now: number;
  source: string;
  cached: boolean;
  aircraft: Aircraft[];
}

export interface AirShowConfig {
  centerLat: number;
  centerLon: number;
  radiusMiles: number;
  refreshSeconds: number;
  /** Multiplier applied to altitude-derived aircraft size (declutter). */
  aircraftScale: number;
  /** Human-readable label for the current center (preset name, city, Custom). */
  locationLabel: string;
}
