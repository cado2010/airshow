export type AircraftClass =
  | "jumbo"
  | "widebody"
  | "narrowbody"
  | "regional"
  | "ga"
  | "helicopter"
  | "military"
  | "unknown";

export interface ClassMeta {
  label: string;
  /** Pale, desaturated fill (spec: "this is not a game UI"). */
  color: string;
}

export const CLASS_META: Record<AircraftClass, ClassMeta> = {
  jumbo: { label: "Jumbo Widebody", color: "#e6c45f" }, // pale gold
  widebody: { label: "Widebody Twin", color: "#8fbfe8" }, // pale blue
  narrowbody: { label: "Narrowbody", color: "#b9c4d2" }, // pale silver-blue
  regional: { label: "Regional Jet", color: "#92d18f" }, // pale green
  ga: { label: "General Aviation", color: "#ededed" }, // pale white
  helicopter: { label: "Helicopter", color: "#f0a85f" }, // pale orange
  military: { label: "Military", color: "#9bb487" }, // pale gray-green
  unknown: { label: "Unknown", color: "#a9aea9" }, // pale gray
};

/** Pale purple, applied when the operator is a known cargo carrier. */
export const CARGO_COLOR = "#c6a3e8";

const CARGO_OPERATORS = new Set([
  "FDX", // FedEx
  "UPS", // UPS
  "GTI", // Atlas Air
  "GEC", // Lufthansa Cargo
  "CLX", // Cargolux
  "CKS", // Kalitta
  "ABX", // ABX Air
  "BOX", // AeroLogic
  "ATN", // Air Transport Intl
  "PAC", // Polar Air Cargo
  "CPA", // (mixed) ignore
]);

/** Explicit ICAO type-code -> class map for common types. */
const EXACT: Record<string, AircraftClass> = {
  // Jumbo / 4-engine very large
  A388: "jumbo", A124: "jumbo", A225: "jumbo",
  B741: "jumbo", B742: "jumbo", B743: "jumbo", B744: "jumbo",
  B748: "jumbo", B74S: "jumbo", B74R: "jumbo",
  A342: "jumbo", A343: "jumbo", A345: "jumbo", A346: "jumbo",
  // Widebody twins (and trijets)
  A306: "widebody", A30B: "widebody", A310: "widebody",
  A332: "widebody", A333: "widebody", A338: "widebody", A339: "widebody",
  A337: "widebody",
  A359: "widebody", A35K: "widebody", A351: "widebody",
  B762: "widebody", B763: "widebody", B764: "widebody",
  B772: "widebody", B773: "widebody", B77L: "widebody", B77W: "widebody",
  B778: "widebody", B779: "widebody",
  B788: "widebody", B789: "widebody", B78X: "widebody",
  MD11: "widebody", DC10: "widebody", IL96: "widebody", A3ST: "widebody",
  // Narrowbody
  A318: "narrowbody", A319: "narrowbody", A320: "narrowbody", A321: "narrowbody",
  A19N: "narrowbody", A20N: "narrowbody", A21N: "narrowbody",
  BCS1: "narrowbody", BCS3: "narrowbody", A220: "narrowbody",
  B712: "narrowbody",
  B721: "narrowbody", B722: "narrowbody",
  B732: "narrowbody", B733: "narrowbody", B734: "narrowbody", B735: "narrowbody",
  B736: "narrowbody", B737: "narrowbody", B738: "narrowbody", B739: "narrowbody",
  B37M: "narrowbody", B38M: "narrowbody", B39M: "narrowbody", B3XM: "narrowbody",
  B752: "narrowbody", B753: "narrowbody",
  MD81: "narrowbody", MD82: "narrowbody", MD83: "narrowbody", MD87: "narrowbody",
  MD88: "narrowbody", MD90: "narrowbody",
  // Regional jets + turboprops
  CRJ1: "regional", CRJ2: "regional", CRJ7: "regional", CRJ9: "regional", CRJX: "regional",
  E135: "regional", E145: "regional", E45X: "regional",
  E170: "regional", E75S: "regional", E75L: "regional", E175: "regional",
  E190: "regional", E195: "regional", E290: "regional", E295: "regional",
  E290S: "regional",
  RJ85: "regional", RJ1H: "regional", B461: "regional", B462: "regional", B463: "regional",
  AT43: "regional", AT45: "regional", AT72: "regional", AT75: "regional", AT76: "regional",
  DH8A: "regional", DH8B: "regional", DH8C: "regional", DH8D: "regional",
  SF34: "regional", SB20: "regional", J328: "regional", D328: "regional",
  // General aviation (pistons, singles, light bizjets)
  C172: "ga", C152: "ga", C150: "ga", C162: "ga", C170: "ga", C177: "ga",
  C182: "ga", C206: "ga", C207: "ga", C208: "ga", C210: "ga", C72R: "ga", C82R: "ga",
  P28A: "ga", P28B: "ga", P28R: "ga", PA18: "ga", PA24: "ga", PA32: "ga", PA34: "ga",
  PA44: "ga", PA46: "ga", SR20: "ga", SR22: "ga", DA40: "ga", DA42: "ga", DA62: "ga",
  BE33: "ga", BE35: "ga", BE36: "ga", BE58: "ga", BE76: "ga", BE9L: "ga", BE20: "ga",
  M20P: "ga", M20T: "ga", PC12: "ga", TBM7: "ga", TBM8: "ga", TBM9: "ga", PA31: "ga",
  C25A: "ga", C25B: "ga", C25C: "ga", C500: "ga", C510: "ga", C525: "ga", C550: "ga",
  C56X: "ga", C68A: "ga", C750: "ga", LJ35: "ga", LJ45: "ga", LJ60: "ga", LJ75: "ga",
  E50P: "ga", E55P: "ga", PRM1: "ga", GLF4: "ga", GLF5: "ga", GLF6: "ga", GL5T: "ga",
  GLEX: "ga", CL30: "ga", CL35: "ga", CL60: "ga", F2TH: "ga", FA7X: "ga", FA8X: "ga",
  H25B: "ga", HDJT: "ga",
  // Helicopters
  R22: "helicopter", R44: "helicopter", R66: "helicopter",
  EC20: "helicopter", EC30: "helicopter", EC35: "helicopter", EC45: "helicopter",
  EC55: "helicopter", AS50: "helicopter", AS55: "helicopter", AS65: "helicopter",
  H500: "helicopter", B06: "helicopter", B407: "helicopter", B412: "helicopter",
  B429: "helicopter", B505: "helicopter", B47: "helicopter",
  A109: "helicopter", A119: "helicopter", A139: "helicopter", A169: "helicopter",
  S76: "helicopter", S92: "helicopter", H60: "helicopter", H47: "helicopter",
  // Military (common)
  F16: "military", F15: "military", F18: "military", F22: "military", F35: "military",
  A10: "military", C17: "military", C5M: "military", C130: "military", C30J: "military",
  K35R: "military", KC10: "military", E3CF: "military", E3TF: "military", B52: "military",
  B1: "military", B2: "military", P8: "military", P3: "military", H64: "military",
};

/** Heuristic prefix rules applied when no exact match exists. */
function classifyByHeuristic(t: string): AircraftClass {
  if (/^A38|^B74|^A124|^A225|^A34/.test(t)) return "jumbo";
  if (/^A33|^A35|^B77|^B78|^B76|^A31|^A30|^MD11|^DC10|^IL[78]/.test(t))
    return "widebody";
  if (/^A32|^A21N|^A20N|^A19N|^A22|^BCS|^B73|^B75|^B72|^MD[89]|^B71/.test(t))
    return "narrowbody";
  if (/^CRJ|^E1[3479]|^E29|^E75|^E45|^AT[47]|^DH8|^RJ|^B46|^SF|^D328|^J328/.test(t))
    return "regional";
  if (/^C1[567]|^C2[01]|^PA|^SR2|^DA[46]|^BE[0-9]|^M20|^P28|^TBM|^PC12|^LJ|^C25|^C5[0-9]|^C68|^C75|^GLF|^GLEX|^CL[36]|^FA[78]|^F2TH|^E5[05]P/.test(t))
    return "ga";
  if (/^R[24]4|^R22|^R66|^EC[0-9]|^AS[0-9]|^B40|^B06|^B42|^B50|^A1[0136]9|^S7[0-9]|^S92|^H[0-9]/.test(t))
    return "helicopter";
  if (/^F1[5678]|^F22|^F35|^A10|^C17|^C130|^C30J|^KC|^K35|^B52|^B1$|^B2$|^P8|^H64/.test(t))
    return "military";
  return "unknown";
}

export function classifyType(typeCode?: string): AircraftClass {
  if (!typeCode) return "unknown";
  const t = typeCode.toUpperCase();
  return EXACT[t] ?? classifyByHeuristic(t);
}

export function isCargoOperator(operatorIcao?: string): boolean {
  return !!operatorIcao && CARGO_OPERATORS.has(operatorIcao);
}

/** Final display color: cargo operators override class color with pale purple. */
export function colorFor(cls: AircraftClass, operatorIcao?: string): string {
  if (isCargoOperator(operatorIcao)) return CARGO_COLOR;
  return CLASS_META[cls].color;
}
