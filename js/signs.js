// Shared between the browser (js/app.js) and the Node data scripts, so the
// definition of "a neon sign" lives in exactly one place.

/** Split an OSM multi-value tag ("a;b; c") into trimmed, non-empty parts. */
export function splitValues(value) {
  return String(value ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The project's tagging: advertising=sign + luminous=yes.
 * Also accepts multi-valued advertising ("sign;letter_board") and
 * luminous=neon. That value is more specific than yes, so the map must keep
 * accepting it rather than nudge mappers to retag it as yes.
 */
export function isNeonSign(tags = {}) {
  const advertising = splitValues(tags.advertising).map((v) => v.toLowerCase());
  const luminous = splitValues(tags.luminous).map((v) => v.toLowerCase());
  return advertising.includes("sign") && luminous.some((v) => v === "yes" || v === "neon");
}

export const DEFAULT_NEON = "#ff2bd6";

// colour=* names mapped to tube-bright versions that read on a dark basemap.
const NEON_PALETTE = {
  red: "#ff3b4e",
  pink: "#ff4fd8",
  magenta: "#ff3df2",
  fuchsia: "#ff3df2",
  purple: "#b46bff",
  violet: "#b46bff",
  blue: "#3fa9ff",
  cyan: "#3ff8ff",
  aqua: "#3ff8ff",
  turquoise: "#3ff8e0",
  teal: "#2fe6c8",
  green: "#3dff7a",
  lime: "#a8ff3d",
  yellow: "#ffe94a",
  gold: "#ffd23f",
  amber: "#ffb000",
  orange: "#ff9a3c",
  white: "#f5f3ff",
};

/** Glow colour for a sign: first usable colour=* value, else hot pink. */
export function neonColour(tags = {}) {
  for (const raw of splitValues(tags.colour ?? tags.color)) {
    const v = raw.toLowerCase();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) return v;
    if (NEON_PALETTE[v]) return NEON_PALETTE[v];
  }
  return DEFAULT_NEON;
}

/** What to call a sign in the list and the detail panel. */
export function signTitle(tags = {}) {
  return (tags.inscription || tags.name || tags.brand || "Neon sign").trim();
}
