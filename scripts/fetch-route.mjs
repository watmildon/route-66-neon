// Fetch the Historic Route 66 alignment from Overpass, merge and simplify it,
// and write two files:
//
//   data/route66.geojson      the Historic Route 66 relations (one feature)
//   data/alignments.geojson   other former US 66 alignments that those
//                             relations leave out, one feature per stretch,
//                             with properties the map shows on hover
//
// The map draws both, and fetch-signs.mjs uses both as the corridor that
// decides which signs are "on Route 66".
//
//   node scripts/fetch-route.mjs
//
// The route rarely changes, so CI runs this weekly; a failure keeps the
// committed files.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTRA_RELATIONS, isFormerUS66 } from "./lib/alignments.mjs";
import { lineLengthM, linesBounds, mergeLines, round, SegmentIndex, simplify } from "./lib/geo.mjs";
import { overpassQuery } from "./lib/sources.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "data", "route66.geojson");
const ALIGNMENTS = join(ROOT, "data", "alignments.geojson");

const SIMPLIFY_M = Number(process.env.NEON_ROUTE_SIMPLIFY_M || 8);
const MIN_WAYS = 1000; // the full route is ~12k ways; far fewer means a partial answer
const MIN_EXTRA_WAYS = 500; // the extra alignments are ~4k ways
const DROP_THRESHOLD = Number(process.env.NEON_DROP_THRESHOLD || 50); // percent of total length
// An extra way that never strays more than this from the main line is the same
// road (a second carriageway, a way left out of the relation), so skip it.
const SAME_ROAD_M = 50;

// 93155 = superroute "Historic U.S. Route 66" (Chicago – Santa Monica). State
// routes hang off it up to three levels deep, and a few alignments are only
// tagged network=US:US:Historic + ref=66, so take both and recurse.
const QUERY = `[out:json][timeout:300];
(
  rel(93155);
  rel["type"~"^(route|superroute)$"]["network"="US:US:Historic"]["ref"="66"];
)->.top;
(.top; rel(r.top);)->.l2;
(.l2; rel(r.l2);)->.l3;
(.l3; rel(r.l3);)->.rels;
way(r.rels);
out geom qt;`;

const extraQuery = (bbox) => {
  const ids = Object.keys(EXTRA_RELATIONS).join(",");
  return `[out:json][timeout:600];
rel(id:${ids})->.top;
(.top; rel(r.top);)->.l2;
(.l2; rel(r.l2);)->.rels;
.rels out body qt;
(
  way(r.rels);
  way[highway][old_ref~"(^|[^0-9])66([^0-9]|$)"](${bbox});
);
out geom tags qt;`;
};

const toLine = (w) => w.geometry.filter(Boolean).map((p) => [p.lon, p.lat]);

function cleanLines(lines) {
  return lines
    .map((l) => simplify(l, SIMPLIFY_M).map(([x, y]) => [round(x, 5), round(y, 5)]))
    .map((l) => l.filter((p, i) => i === 0 || p[0] !== l[i - 1][0] || p[1] !== l[i - 1][1]))
    .filter((l) => l.length >= 2);
}

const totalKm = (lines) => Math.round(lines.reduce((m, l) => m + lineLengthM(l), 0) / 1000);

/** True if every point along the line (sampled every ~25 m) is within maxM of the index. */
function hugs(line, index, maxM) {
  for (let i = 0; i < line.length; i++) {
    if (index.nearestM(line[i], maxM) === Infinity) return false;
    if (i === 0) continue;
    const a = line[i - 1], b = line[i];
    const n = Math.ceil(lineLengthM([a, b]) / 25);
    for (let k = 1; k < n; k++) {
      const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      if (index.nearestM(p, maxM) === Infinity) return false;
    }
  }
  return true;
}

/** Which extra relation each way belongs to (the first listed wins). */
function wayRelations(elements) {
  const rels = new Map(elements.filter((e) => e.type === "relation").map((r) => [r.id, r]));
  const owner = new Map();
  for (const top of Object.keys(EXTRA_RELATIONS).map(Number)) {
    const stack = [top], seen = new Set();
    while (stack.length) {
      const r = rels.get(stack.pop());
      if (!r || seen.has(r.id)) continue;
      seen.add(r.id);
      for (const m of r.members || []) {
        if (m.type === "way" && !owner.has(m.ref)) owner.set(m.ref, top);
        else if (m.type === "relation") stack.push(m.ref);
      }
    }
  }
  return owner;
}

async function fetchExtras(mainWays, mainLines) {
  const [w, s, e, n] = linesBounds(mainLines);
  const pad = 0.1;
  const bbox = [s - pad, w - pad, n + pad, e + pad].map((v) => v.toFixed(3)).join(",");
  console.log("Querying Overpass for other former US 66 alignments…");
  const { json, label } = await overpassQuery(extraQuery(bbox), { repoRoot: ROOT });

  const owner = wayRelations(json.elements);
  const mainIds = new Set(mainWays.map((w) => w.id));
  const mainIndex = new SegmentIndex(mainLines);
  const groups = new Map();
  let total = 0, kept = 0;
  for (const way of json.elements) {
    if (way.type !== "way" || !Array.isArray(way.geometry)) continue;
    total++;
    if (mainIds.has(way.id)) continue;
    const rel = owner.get(way.id);
    const oldRef = way.tags?.old_ref;
    if (!rel && !isFormerUS66(oldRef)) continue;
    const line = toLine(way);
    if (line.length < 2 || hugs(line, mainIndex, SAME_ROAD_M)) continue;
    kept++;
    const props = rel
      ? { source: "relation", relation: rel, label: EXTRA_RELATIONS[rel].label, note: EXTRA_RELATIONS[rel].note }
      : { source: "old_ref", label: "Former US 66", note: `Tagged old_ref=${oldRef} in OSM.`, old_ref: oldRef };
    if (way.tags?.name) props.name = way.tags.name;
    const key = JSON.stringify(props);
    if (!groups.has(key)) groups.set(key, { props, lines: [] });
    groups.get(key).lines.push(line);
  }
  console.log(`${label}: ${total} ways; ${kept} are off the main line.`);
  if (total < MIN_EXTRA_WAYS) {
    throw new Error(`Only ${total} extra ways returned (expected ≥ ${MIN_EXTRA_WAYS}); not updating.`);
  }

  const features = [];
  for (const { props, lines } of groups.values()) {
    for (const line of cleanLines(mergeLines(lines))) features.push({ properties: props, coordinates: line });
  }
  // Stable order so unchanged data gives an unchanged file.
  features.sort((a, b) => b.coordinates[0][0] - a.coordinates[0][0] || a.coordinates[0][1] - b.coordinates[0][1]);
  return features;
}

function serializeMain(fc) {
  const f = fc.features[0];
  const head =
    `{"type":"FeatureCollection","osm_base":${JSON.stringify(fc.osm_base)},"features":[\n` +
    `{"type":"Feature","properties":${JSON.stringify(f.properties)},"geometry":{"type":"MultiLineString","coordinates":[\n`;
  return head + f.geometry.coordinates.map((l) => JSON.stringify(l)).join(",\n") + "\n]}}\n]}\n";
}

function serializeAlignments(osmBase, lengthKm, features) {
  const rows = features.map(
    (f) =>
      `{"type":"Feature","properties":${JSON.stringify(f.properties)},` +
      `"geometry":{"type":"LineString","coordinates":${JSON.stringify(f.coordinates)}}}`
  );
  return `{"type":"FeatureCollection","osm_base":${JSON.stringify(osmBase)},"length_km":${lengthKm},"features":[\n${rows.join(",\n")}\n]}\n`;
}

function checkDrop(file, lengthKm, readOld) {
  if (!existsSync(file)) return;
  let old;
  try {
    old = readOld(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    console.warn(`WARNING: could not read ${file}; skipping drop check.`);
    return;
  }
  const drop = ((old - lengthKm) / old) * 100;
  if (old && drop > DROP_THRESHOLD) {
    throw new Error(`Length of ${file} dropped ${old} → ${lengthKm} km (${drop.toFixed(0)}%); not updating.`);
  }
}

async function main() {
  console.log("Querying Overpass for the Historic Route 66 alignment…");
  const { json, timestamp, label } = await overpassQuery(QUERY, { repoRoot: ROOT });
  const ways = json.elements.filter((e) => e.type === "way" && Array.isArray(e.geometry));
  console.log(`${label}: ${ways.length} ways.`);
  if (ways.length < MIN_WAYS) {
    throw new Error(`Only ${ways.length} ways returned (expected ≥ ${MIN_WAYS}); not updating.`);
  }

  const raw = ways.map(toLine);
  const lines = cleanLines(mergeLines(raw)).sort((a, b) => b[0][0] - a[0][0] || a[0][1] - b[0][1]);
  const lengthKm = totalKm(lines);
  const points = lines.reduce((n, l) => n + l.length, 0);
  console.log(`Merged into ${lines.length} lines, ${points} points, ${lengthKm} km of alignments.`);

  // Compare against the unsimplified ways so "same road" is judged on real geometry.
  const extras = await fetchExtras(ways, raw);
  const extraKm = totalKm(extras.map((f) => f.coordinates));
  console.log(`${extras.length} extra stretches, ${extraKm} km.`);

  // Check both before writing either, so a bad answer changes nothing.
  checkDrop(OUTPUT, lengthKm, (fc) => fc.features[0].properties.length_km);
  checkDrop(ALIGNMENTS, extraKm, (fc) => fc.length_km);

  writeFileSync(
    OUTPUT,
    serializeMain({
      osm_base: timestamp,
      features: [
        {
          properties: { name: "Historic U.S. Route 66", relation: 93155, length_km: lengthKm },
          geometry: { coordinates: lines },
        },
      ],
    })
  );
  console.log(`Wrote ${OUTPUT}`);
  writeFileSync(ALIGNMENTS, serializeAlignments(timestamp, extraKm, extras));
  console.log(`Wrote ${ALIGNMENTS}`);
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
