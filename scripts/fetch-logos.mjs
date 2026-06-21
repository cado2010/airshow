// Exports airline logos into app/public/logos, keyed by operator ICAO code,
// and writes a manifest. Two sources are combined:
//   1. soaring-symbols (MIT) -> crisp SVGs for ~88 major/flag carriers, pulled
//      from the GitHub repo (the npm package ships metadata but not the SVGs).
//   2. sexym0nk3y/airline-logos -> 900+ PNGs for broad coverage (fetched by
//      scripts/fetch-airline-pngs.ps1 into the same folder beforehand).
// The runtime loader prefers .svg, then .png, then a generic fallback.
//
// Usage: node scripts/fetch-logos.mjs   (run fetch-airline-pngs.ps1 first)

// Some networks intercept TLS; relax verification for this one-off build fetch.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// soaring-symbols' ESM entry uses the legacy `assert { type: 'json' }` import
// syntax that Node 24 rejects; load its working CommonJS build instead.
const require = createRequire(import.meta.url);
const { listAirlines } = require("soaring-symbols");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "app", "public", "logos");
mkdirSync(outDir, { recursive: true });

const RAW_BASE =
  "https://raw.githubusercontent.com/anhthang/soaring-symbols/main/assets";

let svgCount = 0;
for (const airline of listAirlines()) {
  const icao = airline.icao?.toUpperCase();
  const slug = airline.slug;
  if (!icao || !slug) continue;
  // Prefer the symbol/roundel (reads better small) over the wordmark.
  for (const name of ["icon.svg", "logo.svg"]) {
    try {
      const res = await fetch(`${RAW_BASE}/${slug}/${name}`);
      if (!res.ok) continue;
      const svg = await res.text();
      if (!svg.includes("<svg")) continue;
      writeFileSync(join(outDir, `${icao}.svg`), svg, "utf8");
      svgCount++;
      break;
    } catch {
      /* try next variant */
    }
  }
}

// Build manifest: ICAO -> extension, preferring svg over png.
const manifest = {};
for (const file of readdirSync(outDir)) {
  const ext = extname(file).toLowerCase();
  if (ext !== ".svg" && ext !== ".png") continue;
  const code = basename(file, ext).toUpperCase();
  if (manifest[code] === "svg") continue; // keep svg if both exist
  manifest[code] = ext.slice(1);
}
writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify(manifest, null, 0),
  "utf8",
);

console.log(
  `logos: wrote ${svgCount} SVGs; manifest has ${Object.keys(manifest).length} operators`,
);
