// Builds an ICAO -> airline name map for hover popups, written to
// app/public/logos/airlines-names.json. Source: OpenFlights airlines.dat
// (open data). Only entries with a valid 3-letter ICAO and a real name are
// kept; active carriers win over defunct ones when codes collide.
//
// Usage: node scripts/fetch-airline-names.mjs

// Some networks intercept TLS; relax verification for this one-off build fetch.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "app", "public", "logos", "airlines-names.json");

const SRC =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat";

// Minimal CSV line parser: handles quoted fields that may contain commas.
function parseLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const res = await fetch(SRC);
if (!res.ok) {
  console.error(`failed to fetch airlines.dat: ${res.status}`);
  process.exit(1);
}
const text = await res.text();

const names = {};
const haveActive = new Set();
for (const line of text.split("\n")) {
  if (!line.trim()) continue;
  // id, name, alias, iata, icao, callsign, country, active
  const f = parseLine(line);
  const name = (f[1] || "").trim();
  const icao = (f[4] || "").trim().toUpperCase();
  const active = (f[7] || "").trim().toUpperCase() === "Y";
  if (!/^[A-Z]{3}$/.test(icao)) continue;
  if (!name || name === "\\N" || name.toLowerCase() === "unknown") continue;
  if (names[icao] && haveActive.has(icao) && !active) continue;
  names[icao] = name;
  if (active) haveActive.add(icao);
}

writeFileSync(outFile, JSON.stringify(names, null, 0), "utf8");
console.log(`airline names: wrote ${Object.keys(names).length} operators`);
