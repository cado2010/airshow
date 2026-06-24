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
  /** Hide aircraft reported as on the ground. */
  hideGround: boolean;
  /** Logo offset from the aircraft center, as a multiple of its size. */
  logoOffset: number;
  /** Multiplier applied to the rendered airline logo size. */
  logoScale: number;
  /** Show city names instead of airport codes in the route line. */
  routeCityNames: boolean;
  /** Highlight aircraft that lose separation from each other (proximity alert). */
  conflictEnabled: boolean;
  /** Horizontal separation threshold, nautical miles (both must be breached). */
  conflictHorizNm: number;
  /** Vertical separation threshold, feet (both must be breached). */
  conflictVertFt: number;
  /** Use a tighter threshold when both aircraft are in terminal (near-airport) airspace. */
  conflictTighterNearAirport: boolean;
  /** Terminal-airspace horizontal threshold, nautical miles. */
  conflictNearHorizNm: number;
  /** Terminal-airspace vertical threshold, feet. */
  conflictNearVertFt: number;
  /** Auto-show mode: cycle a large flight card through aircraft (for projection). */
  autoShowEnabled: boolean;
}
