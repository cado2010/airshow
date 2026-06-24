// Shared origin/destination resolution used by both the hover popup and the
// projection showcase card. Combines three non-blocking sources (all read
// synchronously, never awaited): adsbdb scheduled route (low confidence),
// OpenSky track-derived leg (high), and live trajectory inference (authoritative
// for the near end). See implementation-plan.md "Route accuracy".
import type { Aircraft, AirShowConfig } from "../types";
import { getRoute, type RouteAirport } from "./routes";
import { getOpenSky } from "./opensky";
import { airportByCode, airportsReady, loadAirports, type Airport } from "./airports";
import { inferEndpoint } from "./arrivals";

type Endpoint = { code: string; city: string } | null;

export interface RouteParts {
  from: Endpoint;
  to: Endpoint;
  confidence: "low" | "high" | null;
  /** No data yet, but a lookup is still in flight. */
  loading: boolean;
}

function epFromAirport(a: Airport): Endpoint {
  return { code: a.iata || a.icao || "?", city: a.city || a.name || a.icao || "?" };
}
function epFromRouteAirport(ra?: RouteAirport): Endpoint {
  if (!ra) return null;
  const code = ra.iata || ra.icao || ra.municipality;
  if (!code) return null;
  return { code, city: ra.municipality || code };
}
function epFromIcao(icao: string | null): Endpoint {
  if (!icao) return null;
  const a = airportByCode(icao);
  return a ? epFromAirport(a) : { code: icao, city: icao };
}

export function endpointText(ep: Endpoint, cityNames: boolean): string {
  if (!ep) return "?";
  return cityNames ? ep.city : ep.code;
}

/** Resolve from/to endpoints + confidence for an aircraft (synchronous). */
export function resolveRouteParts(a: Aircraft, cfg: AirShowConfig): RouteParts {
  if (!airportsReady()) void loadAirports();
  const viewNm = cfg.radiusMiles * 0.868976;
  const observed = airportsReady()
    ? inferEndpoint(
        {
          lat: a.lat,
          lon: a.lon,
          altFt: a.altFt ?? 0,
          verticalRateFpm: a.verticalRateFpm ?? 0,
          headingDeg: a.headingDeg,
          onGround: a.onGround,
        },
        cfg.centerLat,
        cfg.centerLon,
        viewNm,
      )
    : null;

  const adsb = getRoute(a.callsign); // undefined=loading | null=none | route
  const osky = getOpenSky(a.hex); // undefined=loading | null=none | route

  let from: Endpoint = null;
  let to: Endpoint = null;

  if (adsb) {
    from = epFromRouteAirport(adsb.origin);
    to = epFromRouteAirport(adsb.destination);
  }

  const oskyData = osky && (osky.depIcao || osky.arrIcao) ? osky : null;
  if (oskyData) {
    if (oskyData.depIcao) from = epFromIcao(oskyData.depIcao);
    if (oskyData.arrIcao) to = epFromIcao(oskyData.arrIcao);
  }

  if (observed) {
    if (observed.kind === "arrival") to = epFromAirport(observed.airport);
    else from = epFromAirport(observed.airport);
  }

  const loading = adsb === undefined || osky === undefined;
  const confidence = !from && !to ? null : oskyData || observed ? "high" : "low";
  return { from, to, confidence, loading };
}

/** Popup route line: "Route: ORIG → DEST (conf)", "Route: …", or "". */
export function resolveRouteLine(a: Aircraft, cfg: AirShowConfig): string {
  const { from, to, confidence, loading } = resolveRouteParts(a, cfg);
  if (!from && !to) return loading ? "Route: \u2026" : "";
  const cn = cfg.routeCityNames;
  return `Route: ${endpointText(from, cn)} \u2192 ${endpointText(to, cn)} (${confidence})`;
}
