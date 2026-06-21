export const METERS_PER_MILE = 1609.344;
export const METERS_PER_NM = 1852;
export const MILES_PER_NM = METERS_PER_NM / METERS_PER_MILE;

const M_PER_DEG_LAT = 111_132;

/** Local east/north offset (meters) of a point from a center lat/lon. */
export interface LocalOffset {
  east: number;
  north: number;
}

/**
 * Equirectangular ("flat earth") projection of lat/lon to local meters,
 * centered on (centerLat, centerLon). Accurate enough for a <=50 mi radius,
 * per the spec (terrain and curvature ignored).
 */
export function toLocalMeters(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number,
): LocalOffset {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
  return {
    east: (lon - centerLon) * mPerDegLon,
    north: (lat - centerLat) * M_PER_DEG_LAT,
  };
}

export function milesToMeters(miles: number): number {
  return miles * METERS_PER_MILE;
}

export function milesToNm(miles: number): number {
  return miles / MILES_PER_NM;
}
