// Downloads Natural Earth (public-domain) vector data and writes a compact,
// pre-flattened JSON to app/public/mapdata.json. This powers the optional faint
// gray "map overlay" (coastlines, lakes, country/state borders, and city names)
// drawn beneath the aircraft. The overlay is opt-in (config: mapOverlay) and
// off by default.
//
// Output format (small on purpose — coordinates rounded to 4 decimals,
// stored as flat [lat, lon, lat, lon, ...] polylines):
//   {
//     "water":   [ [lat,lon,...], ... ],   // coastlines, lakes, rivers
//     "borders": [ [lat,lon,...], ... ],   // country + state/province lines
//     "urban":   [ [lat,lon,...], ... ],   // built-up-area outlines (rings)
//     "places":  [ [lat, lon, "Name", rank], ... ]   // rank: lower = bigger
//   }
//
// Regenerate with:  npm run fetch:mapdata
// Switch resolution by setting SCALE below ("10m" detailed / "50m" smaller).
import { Agent, setGlobalDispatcher } from "undici";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Tolerate corporate TLS interception (same posture as the rest of the repo).
setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

// Per-layer resolution. Coastlines/lakes and city points stay detailed (10m)
// because their shape/position is what makes the map recognizable; the abstract
// country/state border lines use 50m to keep the file small (10m admin_1 alone
// is ~10MB). Override all via NE_SCALE.
const OVERRIDE = process.env.NE_SCALE;
const COAST_SCALE = OVERRIDE || "10m";
const BORDER_SCALE = OVERRIDE || "50m";
const URBAN_SCALE = OVERRIDE || "50m"; // 10m urban polygons are huge
const PLACES_SCALE = OVERRIDE || "10m";
const BASE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "app", "public", "mapdata.json");

// 3 decimals (~110 m) is ample for a faint background overlay and collapses many
// near-coincident 10m vertices, shrinking the file substantially.
const round = (n) => Math.round(n * 1e3) / 1e3;
// Drop vertices closer than this (in degrees, ~250 m) to the previously kept
// one. At the overlay's zoom levels sub-250 m detail is invisible, and dense 10m
// rivers/coastlines shrink dramatically with no perceptible shape loss.
const MIN_STEP = 0.0025;
const MIN_STEP_SQ = MIN_STEP * MIN_STEP;

async function getJson(name, optional = false) {
  const url = `${BASE}/${name}`;
  console.log("downloading", url);
  const res = await fetch(url);
  if (!res.ok) {
    if (optional) {
      console.warn(`  skipped ${name} (HTTP ${res.status})`);
      return { features: [] };
    }
    throw new Error(`HTTP ${res.status} for ${name}`);
  }
  return res.json();
}

// Push every ring/line of a feature's geometry as a flat [lat,lon,...] polyline,
// dropping consecutive duplicates produced by rounding and any degenerate runs.
function pushGeometry(geom, out) {
  if (!geom) return;
  const addRing = (coords) => {
    const flat = [];
    let pLat = NaN;
    let pLon = NaN;
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      const lon = round(c[0]);
      const lat = round(c[1]);
      const last = i === coords.length - 1;
      // Decimate: skip points too close to the last kept one, but always keep
      // the final vertex so line/ring endpoints stay put.
      if (flat.length > 0 && !last) {
        const dLat = lat - pLat;
        const dLon = lon - pLon;
        if (dLat * dLat + dLon * dLon < MIN_STEP_SQ) continue;
      }
      if (lat === pLat && lon === pLon) continue;
      flat.push(lat, lon);
      pLat = lat;
      pLon = lon;
    }
    if (flat.length >= 4) out.push(flat); // at least 2 distinct points
  };
  switch (geom.type) {
    case "LineString":
      addRing(geom.coordinates);
      break;
    case "MultiLineString":
    case "Polygon":
      for (const part of geom.coordinates) addRing(part);
      break;
    case "MultiPolygon":
      for (const poly of geom.coordinates) for (const ring of poly) addRing(ring);
      break;
    default:
      break;
  }
}

function collectLines(geojson, out) {
  for (const f of geojson.features || []) pushGeometry(f.geometry, out);
}

const water = [];
const borders = [];
const urban = [];

const coastline = await getJson(`ne_${COAST_SCALE}_coastline.geojson`);
collectLines(coastline, water);

const lakes = await getJson(`ne_${COAST_SCALE}_lakes.geojson`);
collectLines(lakes, water);

// Rivers (global major + North America supplement for finer inland detail like
// the Trinity), and the North America lakes/reservoirs supplement.
collectLines(await getJson(`ne_${COAST_SCALE}_rivers_lake_centerlines.geojson`, true), water);
collectLines(await getJson(`ne_${COAST_SCALE}_rivers_north_america.geojson`, true), water);
collectLines(await getJson(`ne_${COAST_SCALE}_lakes_north_america.geojson`, true), water);

const adm0 = await getJson(`ne_${BORDER_SCALE}_admin_0_boundary_lines_land.geojson`);
collectLines(adm0, borders);

const adm1 = await getJson(`ne_${BORDER_SCALE}_admin_1_states_provinces_lines.geojson`);
collectLines(adm1, borders);

// Urban-area footprints give metros a recognizable shape at closer zooms.
collectLines(await getJson(`ne_${URBAN_SCALE}_urban_areas.geojson`, true), urban);

// Populated places: keep name + position + a 0..10 importance rank (lower is a
// bigger/more important city), derived from scalerank, falling back to pop_max.
const placesSrc = await getJson(`ne_${PLACES_SCALE}_populated_places_simple.geojson`);
const places = [];
for (const f of placesSrc.features || []) {
  const p = f.properties || {};
  const name = (p.name || p.NAME || "").trim();
  const coords = f.geometry?.coordinates;
  if (!name || !coords) continue;
  const lon = round(coords[0]);
  const lat = round(coords[1]);
  let rank = p.scalerank ?? p.SCALERANK;
  if (rank == null) {
    const pop = Number(p.pop_max ?? p.POP_MAX ?? 0);
    rank = pop > 5e6 ? 0 : pop > 1e6 ? 2 : pop > 3e5 ? 4 : pop > 5e4 ? 6 : 8;
  }
  places.push([lat, lon, name, rank]);
}
// Most important cities first so the client can cap labels by simply taking the
// head of the in-view subset.
places.sort((a, b) => a[3] - b[3]);

const data = { water, borders, urban, places };
const json = JSON.stringify(data);
await writeFile(outFile, json);
const kb = (json.length / 1024).toFixed(0);
console.log(
  `wrote ${water.length} water + ${borders.length} border + ${urban.length} urban lines, ` +
    `${places.length} places -> app/public/mapdata.json (${kb} KB)`,
);
