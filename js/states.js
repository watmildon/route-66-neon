// Which state a sign on Route 66 is in. Pure; shared with the tests.
//
// The route crosses each state line once, at a known place, so a sign's
// longitude (plus latitude for the short Kansas corner) is enough. No boundary
// data to download. A sign's own addr:state wins when it names a Route 66 state.

/** The eight states in driving order, Chicago → Santa Monica. */
export const ROUTE_STATES = ["Illinois", "Missouri", "Kansas", "Oklahoma", "Texas", "New Mexico", "Arizona", "California"];

const BY_CODE = { IL: "Illinois", MO: "Missouri", KS: "Kansas", OK: "Oklahoma", TX: "Texas", NM: "New Mexico", AZ: "Arizona", CA: "California" };

function fromTag(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const code = BY_CODE[v.toUpperCase()];
  if (code) return code;
  return ROUTE_STATES.find((s) => s.toLowerCase() === v.toLowerCase()) || null;
}

/** State for a [lon, lat] on the route; addr:state=* overrides when valid. */
export function routeState([lon, lat], tags = {}) {
  const tagged = fromTag(tags["addr:state"]);
  if (tagged) return tagged;
  if (lon > -90.18) return "Illinois"; // the Mississippi at St. Louis
  if (lon > -94.618) return "Missouri"; // west of Joplin
  if (lon > -95.0 && lat >= 37.0) return "Kansas"; // Galena – Baxter Springs
  if (lon > -100.0) return "Oklahoma"; // Texola
  if (lon > -103.042) return "Texas"; // Glenrio
  if (lon > -109.045) return "New Mexico"; // Lupton
  if (lon > -114.56) return "Arizona"; // the Colorado River at Topock
  return "California";
}
