// Optional faint gray map overlay drawn beneath the aircraft (coastlines, lake
// outlines, country/state borders, and city names). Data is the bundled
// Natural Earth set produced by scripts/fetch-mapdata.mjs (app/public/mapdata.json).
//
// Everything is drawn with the SAME lat/lon -> screen projection the renderer
// uses for aircraft (passed in as px/py), so the map aligns exactly and pans/
// zooms with the traffic. Per-line bounding boxes let us cull off-screen
// geometry cheaply each frame; only in-view lines are projected and stroked.

interface Line {
  c: number[]; // flat [lat, lon, lat, lon, ...]
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

interface Place {
  lat: number;
  lon: number;
  name: string;
  rank: number; // lower = bigger/more important
}

interface RawData {
  water: number[][];
  borders: number[][];
  urban?: number[][];
  places: [number, number, string, number][];
}

let water: Line[] | null = null;
let borders: Line[] | null = null;
let urban: Line[] | null = null;
let places: Place[] | null = null;
let loading: Promise<void> | null = null;

export function mapReady(): boolean {
  return water !== null;
}

function toLines(raw: number[][]): Line[] {
  const out: Line[] = [];
  for (const c of raw) {
    let minLat = Infinity;
    let minLon = Infinity;
    let maxLat = -Infinity;
    let maxLon = -Infinity;
    for (let i = 0; i < c.length; i += 2) {
      const lat = c[i];
      const lon = c[i + 1];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    out.push({ c, minLat, minLon, maxLat, maxLon });
  }
  return out;
}

/** Fetch + index the dataset once. Safe to call repeatedly. */
export function loadMapData(): Promise<void> {
  if (water) return Promise.resolve();
  if (!loading) {
    loading = fetch("/mapdata.json")
      .then((r) => (r.ok ? (r.json() as Promise<RawData>) : Promise.reject()))
      .then((d) => {
        water = toLines(d.water || []);
        borders = toLines(d.borders || []);
        urban = toLines(d.urban || []);
        places = (d.places || []).map((p) => ({
          lat: p[0],
          lon: p[1],
          name: p[2],
          rank: p[3],
        }));
      })
      .catch(() => {
        water = [];
        borders = [];
        urban = [];
        places = [];
      });
  }
  return loading;
}

export interface MapView {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
  /** Current radar radius (miles) — used to scale how many city labels show. */
  radiusMiles: number;
}

type Proj = (lat: number, lon: number) => number;

function strokeLines(
  ctx: CanvasRenderingContext2D,
  lines: Line[],
  px: Proj,
  py: Proj,
  view: MapView,
  style: string,
  width: number,
): void {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const ln of lines) {
    // Bounding-box reject: skip lines entirely outside the visible window.
    if (
      ln.maxLat < view.minLat ||
      ln.minLat > view.maxLat ||
      ln.maxLon < view.minLon ||
      ln.minLon > view.maxLon
    ) {
      continue;
    }
    const c = ln.c;
    ctx.moveTo(px(c[0], c[1]), py(c[0], c[1]));
    for (let i = 2; i < c.length; i += 2) {
      ctx.lineTo(px(c[i], c[i + 1]), py(c[i], c[i + 1]));
    }
  }
  ctx.stroke();
}

function fillRegions(
  ctx: CanvasRenderingContext2D,
  lines: Line[],
  px: Proj,
  py: Proj,
  view: MapView,
  fill: string,
  stroke: string,
): void {
  ctx.beginPath();
  for (const ln of lines) {
    if (
      ln.maxLat < view.minLat ||
      ln.minLat > view.maxLat ||
      ln.maxLon < view.minLon ||
      ln.minLon > view.maxLon
    ) {
      continue;
    }
    const c = ln.c;
    ctx.moveTo(px(c[0], c[1]), py(c[0], c[1]));
    for (let i = 2; i < c.length; i += 2) {
      ctx.lineTo(px(c[i], c[i + 1]), py(c[i], c[i + 1]));
    }
    ctx.closePath();
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * Draw the map overlay. `px(lat,lon)`/`py(lat,lon)` are the renderer's
 * projection; `view` is the current geographic window (for culling + label
 * density). Cheap enough to call every frame: most geometry is bbox-rejected and
 * only visible lines are projected.
 */
export function drawMapOverlay(
  ctx: CanvasRenderingContext2D,
  px: Proj,
  py: Proj,
  view: MapView,
): void {
  if (!water || !borders || !urban || !places) return;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Urban footprints at the bottom (very faint gray fill), then borders, then
  // water/coastlines/rivers on top (slightly brighter).
  fillRegions(
    ctx,
    urban,
    px,
    py,
    view,
    "rgba(150, 160, 180, 0.06)",
    "rgba(150, 160, 180, 0.12)",
  );
  strokeLines(ctx, borders, px, py, view, "rgba(150, 160, 180, 0.13)", 1);
  strokeLines(ctx, water, px, py, view, "rgba(150, 175, 195, 0.20)", 1);

  // City labels: take the most important in-view places (the source is sorted by
  // rank ascending), gate by zoom so a wide view doesn't clutter, and de-conflict
  // with a coarse occupancy grid so labels don't overlap.
  const maxLabels = view.radiusMiles > 120 ? 14 : view.radiusMiles > 50 ? 22 : 36;
  const rankCutoff = view.radiusMiles > 120 ? 4 : view.radiusMiles > 50 ? 6 : 10;
  const cell = 64;
  const occupied = new Set<string>();

  ctx.font = "11px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const dotColor = "rgba(170, 185, 205, 0.55)";
  const textColor = "rgba(180, 195, 215, 0.6)";

  let shown = 0;
  for (const p of places) {
    if (shown >= maxLabels) break;
    if (p.rank > rankCutoff) continue;
    if (
      p.lat < view.minLat ||
      p.lat > view.maxLat ||
      p.lon < view.minLon ||
      p.lon > view.maxLon
    ) {
      continue;
    }
    const x = px(p.lat, p.lon);
    const y = py(p.lat, p.lon);
    const key = `${Math.round(x / cell)},${Math.round(y / cell)}`;
    if (occupied.has(key)) continue;
    occupied.add(key);

    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = textColor;
    ctx.fillText(p.name, x + 5, y);
    shown++;
  }

  ctx.restore();
}
