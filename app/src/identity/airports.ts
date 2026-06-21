// Offline airport search ("Layer 1"): loads the bundled OurAirports dataset
// (app/public/airports.json) once and matches by IATA/ICAO code, airport name,
// or city. The JSON is a columnar array-of-arrays produced by
// scripts/fetch-airports.mjs.

export interface Airport {
  icao: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  importance: number;
}

type Row = [
  string, // icao / primary code
  string, // iata
  string, // name
  string, // city
  string, // country
  number, // lat
  number, // lon
  number, // importance
];

let data: Airport[] | null = null;
let loading: Promise<void> | null = null;

/** Fetch + decode the dataset once. Safe to call repeatedly. */
export function loadAirports(): Promise<void> {
  if (data) return Promise.resolve();
  if (!loading) {
    loading = fetch("/airports.json")
      .then((r) => (r.ok ? (r.json() as Promise<Row[]>) : Promise.reject()))
      .then((rows) => {
        data = rows.map((r) => ({
          icao: r[0],
          iata: r[1],
          name: r[2],
          city: r[3],
          country: r[4],
          lat: r[5],
          lon: r[6],
          importance: r[7],
        }));
      })
      .catch(() => {
        data = [];
      });
  }
  return loading;
}

export function airportsReady(): boolean {
  return data !== null;
}

/**
 * Rank airports against a free-text query. Exact code matches win, then code
 * prefixes, then city/name (startsWith beats substring); importance breaks ties
 * so major airports surface above tiny strips with similar names.
 */
export function searchAirports(query: string, limit = 8): Airport[] {
  if (!data) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  const ql = q.toLowerCase();
  const qu = q.toUpperCase();

  const scored: { a: Airport; score: number }[] = [];
  for (const a of data) {
    let score = -1;

    if (a.iata && a.iata === qu) score = 100;
    else if (a.icao && a.icao === qu) score = Math.max(score, 96);
    else if (a.iata && a.iata.startsWith(qu)) score = Math.max(score, 84);
    else if (a.icao && a.icao.startsWith(qu)) score = Math.max(score, 82);

    const nl = a.name.toLowerCase();
    const cl = a.city.toLowerCase();
    if (cl && cl === ql) score = Math.max(score, 90);
    else if (cl && cl.startsWith(ql)) score = Math.max(score, 72);
    else if (nl.startsWith(ql)) score = Math.max(score, 70);
    else if (cl && cl.includes(ql)) score = Math.max(score, 56);
    else if (nl.includes(ql)) score = Math.max(score, 52);

    if (score >= 0) scored.push({ a, score: score + a.importance });
  }

  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map((s) => s.a);
}

/** Short label for the config dropdown / current-location chip. */
export function airportLabel(a: Airport): string {
  const code = a.iata || a.icao;
  const place = a.city || a.name;
  return code ? `${place} (${code})` : place;
}
