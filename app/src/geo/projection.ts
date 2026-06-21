export interface Viewport {
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Maps local east/north meters (relative to the configured center) to screen
 * pixels. Swappable so a sky-dome / fisheye projection can replace the planar
 * one later without touching the renderer.
 */
export interface Projection {
  readonly id: string;
  project(east: number, north: number, vp: Viewport): ScreenPoint;
  /** Convert a ground distance in meters to a pixel length (for range rings). */
  metersToPixels(meters: number, vp: Viewport): number;
}

/**
 * Top-down, north-up planar projection. The configured radius maps to the
 * usable half-extent of the smaller viewport dimension.
 */
export class PlanarProjection implements Projection {
  readonly id = "planar";

  constructor(
    private readonly radiusMeters: number,
    private readonly paddingFactor = 0.92,
  ) {}

  private scale(vp: Viewport): number {
    const half = (Math.min(vp.width, vp.height) / 2) * this.paddingFactor;
    return half / this.radiusMeters;
  }

  project(east: number, north: number, vp: Viewport): ScreenPoint {
    const s = this.scale(vp);
    return {
      x: vp.width / 2 + east * s,
      y: vp.height / 2 - north * s, // screen y grows downward; north is up
    };
  }

  metersToPixels(meters: number, vp: Viewport): number {
    return meters * this.scale(vp);
  }
}
