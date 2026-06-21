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
}
