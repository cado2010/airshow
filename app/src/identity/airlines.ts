type Manifest = Record<string, string>; // ICAO -> "svg" | "png"
type NameMap = Record<string, string>; // ICAO -> airline name

let manifest: Manifest = {};
let names: NameMap = {};
let manifestLoaded = false;
const imageCache = new Map<string, HTMLImageElement | null>();

export async function loadLogoManifest(): Promise<void> {
  if (manifestLoaded) return;
  try {
    const res = await fetch("/logos/manifest.json");
    if (res.ok) manifest = await res.json();
  } catch {
    /* logos simply won't render */
  }
  try {
    const res = await fetch("/logos/airlines-names.json");
    if (res.ok) names = await res.json();
  } catch {
    /* names simply won't show */
  }
  manifestLoaded = true;
}

/** Human-readable airline name for an operator ICAO, when known. */
export function airlineName(operator?: string): string | undefined {
  if (!operator) return undefined;
  return names[operator];
}

/**
 * Airline ICAO code is the 3-letter prefix of an airline callsign (e.g.
 * "AAL123" -> "AAL"). Registration-style callsigns (e.g. "N172SP") are not
 * airline flights and return undefined.
 */
export function operatorIcao(callsign?: string): string | undefined {
  if (!callsign) return undefined;
  const m = /^([A-Z]{3})(\d.*)?$/.exec(callsign.trim().toUpperCase());
  return m ? m[1] : undefined;
}

/**
 * Returns a logo image for an operator if available, kicking off the load on
 * first request. Returns null when there is no logo for that operator.
 */
export function getLogo(operator?: string): HTMLImageElement | null {
  if (!operator) return null;
  if (imageCache.has(operator)) return imageCache.get(operator)!;

  const ext = manifest[operator];
  if (!ext) {
    imageCache.set(operator, null);
    return null;
  }

  const img = new Image();
  img.decoding = "async";
  img.src = `/logos/${operator}.${ext}`;
  img.onerror = () => imageCache.set(operator, null);
  imageCache.set(operator, img);
  return img;
}

export function logoReady(img: HTMLImageElement | null): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}

/** URL of an operator's logo file for use in <img src>, or null if none. */
export function logoSrc(operator?: string): string | null {
  if (!operator) return null;
  const ext = manifest[operator];
  return ext ? `/logos/${operator}.${ext}` : null;
}
