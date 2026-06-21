// Downloads the open OurAirports dataset and writes a compact, search-ready
// JSON to app/public/airports.json. This powers the offline "Layer 1" location
// search (by IATA/ICAO code, airport name, or city) in the config panel.
//
// Output format is a columnar array-of-arrays to keep the file small:
//   [ icao, iata, name, city, country, lat, lon, importance ]
// where importance (0..5) ranks bigger / scheduled-service airports higher.
import { Agent, setGlobalDispatcher } from "undici";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Tolerate corporate TLS interception (same posture as the rest of the repo).
setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

const SRC = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "app", "public", "airports.json");

/** Minimal RFC-4180 CSV parser (handles quotes, commas/newlines in fields). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignore; handled by the following \n
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const TYPE_WEIGHT = {
  large_airport: 4,
  medium_airport: 3,
  small_airport: 2,
  seaplane_base: 1,
  heliport: 1,
  balloonport: 0,
};

console.log("downloading", SRC);
const res = await fetch(SRC);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const csv = await res.text();

const rows = parseCsv(csv);
const header = rows[0];
const idx = (name) => header.indexOf(name);
const iType = idx("type");
const iName = idx("name");
const iLat = idx("latitude_deg");
const iLon = idx("longitude_deg");
const iCountry = idx("iso_country");
const iMunicipality = idx("municipality");
const iScheduled = idx("scheduled_service");
const iGps = idx("gps_code");
const iIdent = idx("ident");
const iIata = idx("iata_code");
const iLocal = idx("local_code");

const out = [];
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  if (!row || row.length < header.length) continue;
  const type = row[iType];
  if (type === "closed") continue;

  const lat = Number(row[iLat]);
  const lon = Number(row[iLon]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

  const name = (row[iName] || "").trim();
  if (!name) continue;

  const icao = (row[iGps] || row[iIdent] || "").trim().toUpperCase();
  const iata = (row[iIata] || "").trim().toUpperCase();
  const local = (row[iLocal] || "").trim().toUpperCase();
  const city = (row[iMunicipality] || "").trim();
  const country = (row[iCountry] || "").trim().toUpperCase();

  // Keep a usable code in the icao slot even for tiny fields-only airports.
  const code = icao || local;

  const weight = TYPE_WEIGHT[type] ?? 0;
  const importance = weight + (row[iScheduled] === "yes" ? 1 : 0);

  out.push([
    code,
    iata,
    name,
    city,
    country,
    Number(lat.toFixed(5)),
    Number(lon.toFixed(5)),
    importance,
  ]);
}

// Bigger/scheduled airports first so the file is naturally pre-ranked.
out.sort((a, b) => b[7] - a[7]);

await writeFile(outFile, JSON.stringify(out));
const kb = (JSON.stringify(out).length / 1024).toFixed(0);
console.log(`wrote ${out.length} airports -> app/public/airports.json (${kb} KB)`);
