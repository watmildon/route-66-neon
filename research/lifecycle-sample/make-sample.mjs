// A made-up set of signs for reviewing how lifecycle tagging looks on the map:
// one row per tagging variant, one column per colour, laid out as a grid in
// open desert near Amboy, CA. The ids are fake (900000xxxx), so the OSM and
// editor links don't point at these signs.
//
//   node research/lifecycle-sample/make-sample.mjs
//
// Writes research/lifecycle-sample/signs.geojson. To view it, serve a copy of
// the site with this file in place of data/signs.geojson (see README.md).

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { signLifecycle } from "../../js/signs.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CENTER = [-115.66, 34.57]; // lon, lat
const SPACING_M = 50;

const VARIANTS = [
  ["active", "Active", { advertising: "sign", luminous: "yes", "light:method": "neon" }],
  ["disused", "Disused sign", { "disused:advertising": "sign", luminous: "yes", "light:method": "neon" }],
  ["disused", "Disused neon", { advertising: "sign", "disused:luminous": "yes", "disused:light:method": "neon" }],
  ["disused", "disused=yes", { advertising: "sign", luminous: "yes", "light:method": "neon", disused: "yes" }],
  ["abandoned", "Abandoned neon", { advertising: "sign", "abandoned:luminous": "neon", "abandoned:light:method": "neon" }],
  ["abandoned", "Abandoned sign", { "abandoned:advertising": "sign", "abandoned:light:method": "neon" }],
  ["abandoned", "Mixed", { "disused:advertising": "sign", "abandoned:light:method": "neon" }],
];
const COLOURS = [null, "red", "pink", "blue", "turquoise", "green", "yellow", "orange", "white"];

const mPerDegLat = 111_320;
const mPerDegLon = mPerDegLat * Math.cos((CENTER[1] * Math.PI) / 180);
const round = (v) => Math.round(v * 1e7) / 1e7;

const features = [];
VARIANTS.forEach(([expected, label, tags], row) => {
  COLOURS.forEach((colour, col) => {
    const dx = (col - (COLOURS.length - 1) / 2) * SPACING_M;
    const dy = ((VARIANTS.length - 1) / 2 - row) * SPACING_M;
    const all = {
      ...tags,
      ...(colour ? { colour } : {}),
      inscription: `${label} · ${colour || "default"}`,
      description: Object.entries(tags).map(([k, v]) => `${k}=${v}`).join(" + "),
    };
    const got = signLifecycle(all);
    if (got !== expected) throw new Error(`${label}: expected ${expected}, signLifecycle says ${got}`);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [round(CENTER[0] + dx / mPerDegLon), round(CENTER[1] + dy / mPerDegLat)] },
      properties: { osm_type: "node", osm_id: 9_000_000_000 + row * 100 + col, tags: Object.fromEntries(Object.entries(all).sort()) },
    });
  });
});

const out = join(HERE, "signs.geojson");
writeFileSync(out, JSON.stringify({ type: "FeatureCollection", osm_base: "2026-11-20T00:00:00Z", source: "sample", features }, null, 0) + "\n");
console.log(`${features.length} sample signs (${VARIANTS.length} variants × ${COLOURS.length} colours) → ${out}`);
