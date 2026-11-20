// Shared between the browser (js/app.js) and the Node data scripts, so the
// definition of "a neon sign" lives in exactly one place.

/** Split an OSM multi-value tag ("a;b; c") into trimmed, non-empty parts. */
export function splitValues(value) {
  return String(value ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** advertising=* values that count. A neon roof sign is sometimes tagged billboard. */
export const SIGN_TYPES = ["sign", "billboard"];

/**
 * Lifecycle stages the map shows, least to most decayed
 * (https://wiki.openstreetmap.org/wiki/Lifecycle_prefix). A stage applies as a
 * prefix on the sign's own keys: disused:advertising=sign for a sign that's out
 * of service, or abandoned:light:method=neon for a sign whose neon is wrecked.
 * Later stages (demolished:, removed:, was: …) mean the sign is gone, so
 * they aren't read and such signs drop off the map.
 */
export const LIFECYCLE = ["active", "disused", "abandoned"];
const PREFIXES = ["", "disused:", "abandoned:"];
/** The keys a stage can prefix, for the data queries. */
export const LIFECYCLE_KEYS = (key) => PREFIXES.map((p) => p + key);

/**
 * The project's tagging: advertising=sign (or billboard) that is lit from
 * within, i.e. luminous=yes or neon, or light:method=neon. light:method=neon
 * is the preferred tag because it tells neon apart from other luminous signs;
 * it counts on its own. Multi-valued tags ("sign;letter_board") are fine, and
 * values are compared case-insensitively.
 *
 * Each of those keys may carry a disused: or abandoned: prefix. The sign's
 * stage is the worst one on any of them, so advertising=sign with
 * abandoned:light:method=neon is an abandoned neon sign. The older
 * disused=yes / abandoned=yes on the sign count too.
 *
 * animated=* other than "no" (screen, digital_display, scrolling …) marks a
 * digital billboard or similar, so it's left out unless light:method=neon says
 * otherwise (some classic neon signs have chasing or sequenced tubes).
 *
 * Returns "active", "disused" or "abandoned", or null if it isn't a neon sign.
 */
export function signLifecycle(tags = {}) {
  const values = (key) => splitValues(tags[key]).map((v) => v.toLowerCase());
  // The worst stage at which `key` has a matching value, or -1 if none.
  const stage = (key, ok) => PREFIXES.reduce((worst, p, i) => (values(p + key).some(ok) ? i : worst), -1);

  const advertising = stage("advertising", (v) => SIGN_TYPES.includes(v));
  if (advertising < 0) return null;
  const neon = stage("light:method", (v) => v === "neon");
  const luminous = stage("luminous", (v) => v === "yes" || v === "neon");
  if (neon < 0 && values("animated").some((v) => v !== "no")) return null;
  if (neon < 0 && luminous < 0) return null;

  const yes = (key) => values(key).includes("yes");
  const bare = yes("abandoned") ? 2 : yes("disused") ? 1 : 0;
  return LIFECYCLE[Math.max(advertising, neon, luminous, bare)];
}

export function isNeonSign(tags = {}) {
  return signLifecycle(tags) !== null;
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
