/** Infer a human-readable phase-of-flight from altitude and vertical rate. */
export function intentFor(onGround: boolean, altFt: number, vrate: number): string {
  if (onGround) return "On ground";
  if (vrate >= 500 && altFt < 8000) return "Taking off";
  if (vrate >= 300) return "Climbing";
  if (vrate <= -500 && altFt < 8000) return "Landing";
  if (vrate <= -300) return "Descending";
  if (altFt >= 18000) return "Cruising";
  return "Level flight";
}
