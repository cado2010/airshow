type Manifest = Record<string, string>; // ICAO -> "svg" | "png"

let manifest: Manifest = {};
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
  manifestLoaded = true;
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
