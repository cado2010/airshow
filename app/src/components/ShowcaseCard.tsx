import { useStore } from "../state/store";
import { airlineName, logoSrc, operatorIcao } from "../identity/airlines";
import { resolveRouteParts, endpointText } from "../identity/routeResolve";
import { intentFor } from "../identity/intent";
import type { AirShowConfig } from "../types";

/**
 * Large, projection-friendly flight card used by the auto-show. Intentionally
 * minimal — airline logo, airline name, flight number, origin → destination —
 * with oversized type so it reads on a ceiling/wall projection. Reads the live
 * aircraft from the store by hex so the route refreshes as lookups resolve.
 */
export function ShowcaseCard({ hex, cfg }: { hex: string; cfg: AirShowConfig }) {
  const aircraft = useStore((s) => s.aircraft.find((a) => a.hex === hex));
  if (!aircraft) return null;

  const operator = operatorIcao(aircraft.callsign);
  const logo = logoSrc(operator);
  const name = airlineName(operator) || operator || "";
  const flight = aircraft.callsign?.trim() || aircraft.hex.toUpperCase();

  const { from, to } = resolveRouteParts(aircraft, cfg);
  const cn = cfg.routeCityNames;
  const hasRoute = Boolean(from || to);

  const intent = intentFor(
    aircraft.onGround,
    aircraft.altFt ?? 0,
    aircraft.verticalRateFpm ?? 0,
  );

  return (
    <div className="showcase-card">
      {logo ? (
        <img className="showcase-logo" src={logo} alt={name} />
      ) : (
        name && <div className="showcase-logo-text">{name}</div>
      )}
      {name && <div className="showcase-airline">{name}</div>}
      <div className="showcase-flight">{flight}</div>
      {hasRoute && (
        <div className="showcase-route">
          <span className="showcase-ep">{endpointText(from, cn)}</span>
          <span className="showcase-arrow">{"\u2192"}</span>
          <span className="showcase-ep">{endpointText(to, cn)}</span>
        </div>
      )}
      <div className="showcase-intent">{intent}</div>
    </div>
  );
}
