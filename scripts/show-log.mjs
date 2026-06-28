// Decode + list the AirShow access log (JSON-lines written by
// server/src/accesslog.ts). Prints a readable table of UTC time, remote WAN IP,
// and login user id (plus method/status/path), with a short summary.
//
// Usage:
//   npm run logs                       # list everything
//   node scripts/show-log.mjs --tail 50
//   node scripts/show-log.mjs --user cado2010@gmail.com
//   node scripts/show-log.mjs --ip 203.0.113.
//   node scripts/show-log.mjs --file C:\path\to\access.log
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const file =
  arg("--file") ||
  process.env.AIRSHOW_ACCESS_LOG ||
  join(root, "logs", "access.log");
const tail = Number(arg("--tail") || 0);
const userFilter = (arg("--user") || "").toLowerCase();
const ipFilter = arg("--ip") || "";

if (!existsSync(file)) {
  console.error(`No log file at ${file}`);
  console.error("(The server writes it once it has served at least one request.)");
  process.exit(1);
}

const rows = [];
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    rows.push(JSON.parse(line));
  } catch {
    /* skip malformed line */
  }
}

let view = rows.filter(
  (r) =>
    (!userFilter || String(r.user).toLowerCase().includes(userFilter)) &&
    (!ipFilter || String(r.ip).includes(ipFilter)),
);
if (tail > 0) view = view.slice(-tail);

const pad = (s, n) => String(s ?? "").padEnd(n);
console.log(
  pad("UTC TIME", 26) +
    pad("WAN IP", 20) +
    pad("USER", 28) +
    pad("METHOD", 7) +
    pad("STAT", 5) +
    "PATH",
);
console.log("-".repeat(110));
for (const r of view) {
  console.log(
    pad(r.ts, 26) +
      pad(r.ip, 20) +
      pad(r.user, 28) +
      pad(r.method, 7) +
      pad(r.status, 5) +
      (r.path ?? ""),
  );
}

// Summary: unique WAN IPs and users seen in the shown set.
const ipCounts = new Map();
const userSet = new Set();
for (const r of view) {
  ipCounts.set(r.ip, (ipCounts.get(r.ip) || 0) + 1);
  if (r.user && r.user !== "-") userSet.add(r.user);
}
console.log("-".repeat(110));
console.log(
  `${view.length} request(s)${tail ? ` (last ${tail})` : ""} · ` +
    `${ipCounts.size} unique IP(s) · ${userSet.size} user(s)`,
);
if (ipCounts.size) {
  const top = [...ipCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log("Top WAN IPs: " + top.map(([ip, n]) => `${ip} (${n})`).join(", "));
}
console.log(`Source: ${file}`);
