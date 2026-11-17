// Probe every 360° Mapillary photo the site uses: which way was the car really
// going, does compass_angle agree, and what does Mapillary's own alignment say?
//
//   node research/mapillary-heading/probe.mjs <out.json>
//
// Token: MAPILLARY_TOKEN env, .mapillary-token in the repo root, then
// ~/.claude/.mapillary-token. Never logged; errors are reported by status code only.
//
// 1. Coverage tiles (any token): every photo in the same sequence near the
//    target, ordered by captured_at → travel bearing from the photos before
//    and after → compass_angle minus travel.
// 2. Graph API (needs a token the Graph API accepts): computed_compass_angle,
//    camera make/model, and thumbnail URLs for the target and its neighbours,
//    so flow.py can find the forward direction in the pixels.
//
// Writes <out.json>: one record per photo. Thumbnail URLs are signed CDN links
// (no token in them) and expire, so the file is for a run of flow_mapillary.py
// soon after, not for keeping.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bearingDeg, centreHeading, distanceM } from "../../js/aim.js";
import { mapillaryToken } from "../../scripts/lib/mapillary.mjs";
import { decodeTile, lonLatToTile, tilePixelToLonLat } from "../../scripts/lib/mvt.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const TILE_URL = "https://tiles.mapillary.com/maps/vtp/mly1_public/2";
const GRAPH = "https://graph.mapillary.com";
const Z = 14;
const NEIGHBOURS = 3; // photos either side of the target

const out = process.argv[2];
if (!out) throw new Error("usage: probe.mjs <out.json>");
// The pipeline's chain (env, then repo file), then the global default.
const globalFile = join(homedir(), ".claude", ".mapillary-token");
const token = mapillaryToken(ROOT) || (existsSync(globalFile) ? readFileSync(globalFile, "utf8").trim() || null : null);
if (!token) throw new Error("No Mapillary token: set MAPILLARY_TOKEN or write .mapillary-token in the repo root.");

const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- tiles
const tiles = new Map();
async function tile(x, y) {
  const k = `${x}/${y}`;
  if (!tiles.has(k)) {
    tiles.set(
      k,
      (async () => {
        await sleep(100);
        const res = await fetch(`${TILE_URL}/${Z}/${x}/${y}?access_token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          console.warn(`tile ${Z}/${x}/${y}: HTTP ${res.status}`);
          return [];
        }
        const layer = decodeTile(new Uint8Array(await res.arrayBuffer())).image;
        return (layer?.features || [])
          .filter((f) => f.point)
          .map((f) => {
            const [lon, lat] = tilePixelToLonLat({ x, y, z: Z }, f.point[0], f.point[1], layer.extent);
            const p = f.properties;
            return { id: String(p.id), seq: String(p.sequence_id), t: p.captured_at, compass: p.compass_angle, pano: p.is_pano, lon, lat };
          });
      })(),
    );
  }
  return tiles.get(k);
}

/** The target and the photos around it in its sequence, in capture order. */
async function sequenceAround(id, lon, lat) {
  const t0 = lonLatToTile(lon, lat, Z);
  const all = [];
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const f of await tile(t0.x + dx, t0.y + dy)) all.push(f);
  const me = all.find((f) => f.id === id);
  if (!me) return null;
  const seq = [...new Map(all.filter((f) => f.seq === me.seq).map((f) => [f.id, f])).values()].sort((a, b) => a.t - b.t);
  const i = seq.findIndex((f) => f.id === id);
  return { me, seq: seq.slice(Math.max(0, i - NEIGHBOURS), i + NEIGHBOURS + 1), at: Math.min(i, NEIGHBOURS) };
}

/** Travel bearing at the target: from the nearest photo before to the nearest after that moved ≥ 3 m. */
function travelAt(seq, at) {
  const me = seq[at];
  const pt = (f) => [f.lon, f.lat];
  const before = seq.slice(0, at).reverse().find((f) => distanceM(pt(f), pt(me)) >= 3);
  const after = seq.slice(at + 1).find((f) => distanceM(pt(f), pt(me)) >= 3);
  if (!before && !after) return null;
  const a = before || me;
  const b = after || me;
  return { bearing: bearingDeg(pt(a), pt(b)), metres: distanceM(pt(a), pt(b)), seconds: (b.t - a.t) / 1000 };
}

// ---------------------------------------------------------------- graph
let graphOk = true;
async function graph(ids) {
  if (!graphOk || !ids.length) return {};
  const fields = "id,compass_angle,computed_compass_angle,camera_type,make,model,captured_at,sequence,thumb_2048_url";
  const res = await fetch(`${GRAPH}/images?image_ids=${ids.join(",")}&fields=${fields}`, {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!res.ok) {
    console.warn(`Graph API: HTTP ${res.status} — continuing with tiles only.`);
    graphOk = false;
    return {};
  }
  const body = await res.json();
  return Object.fromEntries((body.data || []).map((d) => [String(d.id), d]));
}

// ---------------------------------------------------------------- main
const signs = JSON.parse(readFileSync(join(ROOT, "data/signs.geojson"), "utf8"));
const targets = new Map();
for (const f of signs.features) {
  for (const [id, v] of Object.entries(f.properties.mapillary || {})) {
    if (!v.pano) continue;
    if (!targets.has(id)) targets.set(id, { id, view: v, signs: [] });
    const c = f.geometry.type === "Point" ? f.geometry.coordinates : null;
    targets.get(id).signs.push({ osm: `${f.properties.osm_type}/${f.properties.osm_id}`, coord: c, name: f.properties.tags.name || f.properties.tags.inscription || null });
  }
}
console.log(`${targets.size} panoramas`);

const records = [];
for (const { id, view, signs: on } of targets.values()) {
  const around = await sequenceAround(id, view.lon, view.lat);
  const rec = { id, captured: view.captured, creator: view.creator, compass: view.compass, signs: on };
  rec.site_centre = centreHeading(view); // what js/aim.js uses today
  if (!around) {
    rec.error = "not in tiles";
    records.push(rec);
    continue;
  }
  rec.sequence = around.me.seq;
  rec.neighbours = around.seq.map((f) => ({ id: f.id, t: f.t, lon: f.lon, lat: f.lat, compass: f.compass }));
  rec.at = around.at;
  const tr = travelAt(around.seq, around.at);
  if (tr) {
    rec.travel = +tr.bearing.toFixed(1);
    rec.travel_m = +tr.metres.toFixed(1);
    rec.travel_s = tr.seconds;
    rec.compass_minus_travel = +wrap(view.compass - tr.bearing).toFixed(1);
  }
  const g = await graph(around.seq.map((f) => f.id));
  if (g[id]) {
    rec.camera = [g[id].make, g[id].model].filter(Boolean).join(" ") || null;
    rec.camera_type = g[id].camera_type ?? null;
    rec.computed_compass = g[id].computed_compass_angle ?? null;
    if (rec.travel != null && rec.computed_compass != null) rec.computed_minus_travel = +wrap(rec.computed_compass - rec.travel).toFixed(1);
  }
  for (const n of rec.neighbours) n.thumb = g[n.id]?.thumb_2048_url ?? null;
  records.push(rec);
  process.stdout.write(".");
}
console.log();
writeFileSync(out, JSON.stringify({ graph: graphOk, records }, null, 1));

// Summary: is compass_angle the direction of travel?
const rel = records.filter((r) => r.compass_minus_travel != null);
const bucket = (d) => (Math.abs(d) <= 30 ? "≈ travel" : Math.abs(d) >= 150 ? "≈ reversed" : "other");
const by = {};
for (const r of rel) {
  const k = `${r.captured?.slice(0, 7)} ${bucket(r.compass_minus_travel)}`;
  by[k] = (by[k] || 0) + 1;
}
console.log("compass_angle vs GPS travel, by month:", by);
if (graphOk) {
  const c = records.filter((r) => r.computed_minus_travel != null);
  const cb = {};
  for (const r of c) {
    const d = r.computed_minus_travel;
    const k = `${r.captured?.slice(0, 7)} ${Math.abs(d) <= 45 ? "forward" : Math.abs(d) >= 135 ? "back" : d > 0 ? "right" : "left"}`;
    cb[k] = (cb[k] || 0) + 1;
  }
  console.log("computed_compass_angle vs travel (where the image centre faces):", cb);
}
console.log(`wrote ${out}`);
