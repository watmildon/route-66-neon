// Fetch every neon sign near Historic Route 66 and write data/signs.geojson.
//
//   node scripts/fetch-signs.mjs
//
// 1. Ask Postpass for lit signs and billboards inside the route's bounding box
//    (falls back to Overpass if Postpass is down or stale).
// 2. Keep advertising=sign or billboard + luminous=yes/neon or
//    light:method=neon (see isNeonSign in js/signs.js).
// 3. Keep only signs within NEON_BUFFER_M metres of the route lines in
//    data/route66.geojson and data/alignments.geojson — plenty of luminous=yes signs elsewhere are plain
//    backlit boxes, not part of this project.
// 4. Add what the viewer shows alongside each sign: Mapillary photo positions,
//    Wikipedia/Wikidata links, and historical photos matched on Yesterdays.
//
// Safety rails (same pattern as MascotMap / lighthousemap):
//   * refuses data older than NEON_MAX_DATA_LAG_HOURS (default 48)
//   * refuses to overwrite if the sign count drops more than
//     NEON_DROP_THRESHOLD percent (default 50) — partial responses happen
//   * one feature per line, sorted by OSM id, tags sorted — readable diffs
//   * leaves the file untouched when nothing changed, so no empty commits

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { imageSources } from "../js/images.js";
import { isNeonSign, SIGN_TYPES } from "../js/signs.js";
import { linesBounds, M_PER_DEG, round, SegmentIndex } from "./lib/geo.mjs";
import { refreshFlickr } from "./lib/flickr.mjs";
import { lookupComputedCompass, lookupMapillaryViews, mapillaryToken } from "./lib/mapillary.mjs";
import { overpassQuery, overpassToElements, postpassQuery } from "./lib/sources.mjs";
import { enrichWikiLinks, fetchCoordinates, fetchWikiPlaces, pickWikiLinks, toEntry } from "./lib/wiki.mjs";
import * as yesterdays from "./lib/yesterdays.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE = join(ROOT, "data", "route66.geojson");
const ALIGNMENTS = join(ROOT, "data", "alignments.geojson");
const OUTPUT = join(ROOT, "data", "signs.geojson");

const BUFFER_M = Number(process.env.NEON_BUFFER_M || 400);
const DROP_THRESHOLD = Number(process.env.NEON_DROP_THRESHOLD || 50);

function loadRoute() {
  if (!existsSync(ROUTE)) throw new Error("data/route66.geojson is missing — run scripts/fetch-route.mjs first.");
  const fc = JSON.parse(readFileSync(ROUTE, "utf8"));
  const lines = fc.features.flatMap((f) => f.geometry.coordinates);
  // Other former US 66 alignments (OK 66, MO 366, old_ref=US 66 …) count too.
  if (existsSync(ALIGNMENTS)) {
    for (const f of JSON.parse(readFileSync(ALIGNMENTS, "utf8")).features) lines.push(f.geometry.coordinates);
  } else {
    console.warn("WARNING: data/alignments.geojson is missing; using the Historic Route 66 relations only.");
  }
  return lines;
}

function paddedBbox(lines) {
  const [w, s, e, n] = linesBounds(lines);
  const pad = (BUFFER_M * 2) / M_PER_DEG; // generous; the exact test is the buffer below
  return [w - pad * 1.4, s - pad, e + pad * 1.4, n + pad].map((v) => round(v, 4));
}

async function fromPostpass([w, s, e, n]) {
  // Broad on purpose (any sign or billboard with luminous or light:method);
  // the exact tag test happens in isNeonSign so Postpass and Overpass agree.
  const sql = `
SELECT osm_type, osm_id, tags, ST_PointOnSurface(geom) AS geom
FROM postpass_pointlinepolygon
WHERE geom && ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)
  AND (tags ? 'luminous' OR tags ? 'light:method')
  AND (tags->>'advertising' ILIKE '%sign%' OR tags->>'advertising' ILIKE '%billboard%')`;
  return postpassQuery(sql);
}

async function fromOverpass([w, s, e, n]) {
  const adv = `["advertising"~"(^|;) *(${SIGN_TYPES.join("|")}) *(;|$)",i]`;
  const ql = `[out:json][timeout:180];
(
  nwr${adv}["luminous"](${s},${w},${n},${e});
  nwr${adv}["light:method"](${s},${w},${n},${e});
);
out center tags qt;`;
  const { json, timestamp } = await overpassQuery(ql, { repoRoot: ROOT });
  return { timestamp, elements: overpassToElements(json) };
}

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const TYPE_RANK = { node: 0, way: 1, relation: 2 };

function toFeature(el) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [round(el.lon, 7), round(el.lat, 7)] },
    properties: { osm_type: el.type, osm_id: el.id, tags: sortKeys(el.tags) },
  };
}

/**
 * Attach properties.mapillary = { "<image id>": { lon, lat, compass, computedCompass, pano, captured, creator } }
 * so the viewer can turn 360° photos toward the sign. A photo never moves, so
 * views already in the committed file are reused and only new ids are looked
 * up (which needs a Mapillary token; without one, new photos just aren't aimed).
 * Panoramas without computedCompass (new, or not yet aligned by Mapillary) are
 * looked up in the Graph API on every run until they have one.
 */
async function attachMapillaryViews(features, existing) {
  const known = new Map();
  for (const f of existing?.features || []) {
    for (const [id, view] of Object.entries(f.properties.mapillary || {})) {
      // Views written before `creator` was recorded can't be aimed reliably; re-fetch them.
      if (view.creator) known.set(id, view);
    }
  }

  const idsFor = (f) =>
    imageSources(f.properties.tags)
      .filter((s) => s.kind === "mapillary")
      .map((s) => s.id);

  const wanted = [];
  for (const f of features) {
    for (const id of idsFor(f)) {
      if (!known.has(id)) wanted.push({ id, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
    }
  }

  const token = mapillaryToken(ROOT);
  if (wanted.length) {
    if (!token) {
      console.warn(`${wanted.length} new Mapillary photo(s) can't be aimed: no MAPILLARY_TOKEN set.`);
    } else {
      console.log(`Looking up ${wanted.length} new Mapillary photo(s)…`);
      const found = await lookupMapillaryViews(wanted, token);
      for (const [id, view] of found) known.set(id, view);
      const missing = wanted.filter((w) => !found.has(w.id)).map((w) => w.id);
      if (missing.length) console.warn(`Not found in Mapillary coverage near the sign: ${missing.join(", ")}`);
    }
  }

  // Which way each panorama's image centre faces (left or right of travel
  // varies by sequence, even within one drive).
  const inUse = new Set(features.flatMap(idsFor));
  const unaligned = [...inUse].filter((id) => known.get(id)?.pano && typeof known.get(id).computedCompass !== "number");
  if (unaligned.length && token) {
    const computed = await lookupComputedCompass(unaligned, token);
    if (computed === null) {
      console.warn(`${unaligned.length} panorama(s) aimed by compass_angle only: the Mapillary token can't read the Graph API.`);
    } else {
      for (const [id, deg] of computed) known.set(id, { ...known.get(id), computedCompass: deg });
      const left = unaligned.length - computed.size;
      console.log(`Mapillary alignment for ${computed.size} panorama(s)${left ? `; ${left} not aligned yet` : ""}.`);
    }
  }

  for (const f of features) {
    const views = {};
    for (const id of idsFor(f)) if (known.has(id)) views[id] = sortKeys(known.get(id));
    if (Object.keys(views).length) f.properties.mapillary = views;
  }
}

/**
 * Attach properties.flickr = { "<photo id>": { page, src, thumb, title, author,
 * author_url, license, license_id, license_url, checked } } for Flickr photos
 * tagged on signs (flickr=*, or Flickr links in image=*). Entries in the
 * committed file are reused until they're RECHECK_DAYS old (see lib/flickr.mjs).
 */
async function attachFlickr(features, existing) {
  const known = new Map();
  for (const f of existing?.features || []) {
    for (const [id, e] of Object.entries(f.properties.flickr || {})) known.set(id, e);
  }
  const idsFor = (f) =>
    imageSources(f.properties.tags)
      .filter((s) => s.kind === "flickr")
      .map((s) => s.id);
  const ids = [...new Set(features.flatMap(idsFor))];
  if (!ids.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const { entries, looked, gone, failed } = await refreshFlickr(ids, known, today);
  console.log(`Flickr: ${ids.length} photo(s) tagged; looked up ${looked}${gone ? `, ${gone} gone` : ""}${failed ? `, ${failed} failed` : ""}.`);
  for (const f of features) {
    const photos = {};
    for (const id of idsFor(f)) if (entries.has(id)) photos[id] = sortKeys(entries.get(id));
    if (Object.keys(photos).length) f.properties.flickr = photos;
  }
}

/**
 * Attach properties.wiki = [{ qid, label, description, wikipedia, image,
 * source, source_name }] — the sign's own Wikipedia/Wikidata link and/or the
 * matching wiki-linked place next to it (see scripts/lib/wiki.mjs). If a
 * service is down, the previous run's entries are carried forward.
 */
async function attachWiki(features, existing) {
  const key = (p) => `${p.osm_type}/${p.osm_id}`;
  const previous = new Map((existing?.features || []).map((f) => [key(f.properties), f.properties.wiki || []]));
  const prevDetails = new Map();
  for (const entries of previous.values()) for (const e of entries) if (e.qid) prevDetails.set(e.qid, e);

  const signs = features.map((f) => ({
    type: f.properties.osm_type,
    id: f.properties.osm_id,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    tags: f.properties.tags,
  }));

  let places = null;
  try {
    places = await fetchWikiPlaces(signs, ROOT);
    console.log(`${places.length} wiki-linked OSM places near the signs.`);
  } catch (e) {
    console.warn(`Couldn't fetch wiki-linked places (${e.message.split("\n")[0]}); keeping previous links.`);
  }

  const links = signs.map((s, i) => {
    if (places) return pickWikiLinks(s, places);
    const prev = previous.get(key(features[i].properties));
    if (prev?.length) {
      return prev.map((e) => ({ qid: e.qid || null, wikipedia: e.wikipedia || null, source: e.source, sourceName: e.source_name || null }));
    }
    return pickWikiLinks(s, []); // the sign's own tags still count
  });

  const flat = links.flat();
  let entries;
  try {
    entries = flat.length ? await enrichWikiLinks(flat) : [];
  } catch (e) {
    console.warn(`Wikidata lookup failed (${e.message}); reusing previous labels.`);
    entries = flat.map((l) => toEntry(l, prevDetails.get(l.qid) || {}));
  }

  let n = 0;
  features.forEach((f, i) => {
    const mine = entries.slice(n, n + links[i].length);
    n += links[i].length;
    if (mine.length) f.properties.wiki = mine;
  });
  console.log(`${features.filter((f) => f.properties.wiki).length} signs have Wikipedia/Wikidata links.`);
}

/**
 * Attach properties.yesterdays = [{ id, title, thumb, page, date, creator,
 * source, collection, license, license_url, original, camera }]: historical
 * photos and postcards on yesterdays.today matched by Wikidata subject (the
 * sign's own items, or a subject located at the sign that names it), by a
 * nearby georeference whose title names the sign, or by a "neon sign" photo
 * taken close by and pointed at it (see scripts/lib/yesterdays.mjs).
 * When a lookup fails, the sign keeps the previous run's photos.
 */
async function attachYesterdays(features, existing, bbox) {
  const key = (p) => `${p.osm_type}/${p.osm_id}`;
  const previous = new Map((existing?.features || []).map((f) => [key(f.properties), f.properties.yesterdays || []]));
  const prevById = new Map([...previous.values()].flat().map((e) => [e.id, e]));

  let georefs = null;
  try {
    georefs = await yesterdays.fetchGeoreferences(bbox);
    console.log(`Yesterdays: ${georefs.length} georeferenced images along the route.`);
  } catch (e) {
    console.warn(`Yesterdays georeferences unavailable (${e.message}); keeping previous matches.`);
  }

  // Images with the generic "neon sign" subject, matched by where they point.
  let neonIds = null;
  if (georefs) {
    try {
      neonIds = new Set(await yesterdays.fetchSubjectImageIds(yesterdays.NEON_SIGN_QID));
      console.log(`Yesterdays: ${neonIds.size} images with the neon sign subject.`);
    } catch (e) {
      console.warn(`Yesterdays neon sign subject unavailable (${e.message}); keeping previous matches.`);
    }
  }

  // Subjects located at a sign: only those whose name names some sign are
  // worth a Wikidata coordinate lookup.
  let subjects = [], subjectCoords = new Map(), subjectsOk = true;
  try {
    const all = await yesterdays.fetchSubjects();
    subjects = yesterdays.subjectsNamingSigns(all, features.map((f) => yesterdays.signNames(f.properties)));
    subjectCoords = await fetchCoordinates(subjects.map((s) => s.qid));
    console.log(`Yesterdays: ${all.length} subjects; ${subjects.length} name a sign, ${subjectCoords.size} of those have coordinates.`);
  } catch (e) {
    subjectsOk = false;
    console.warn(`Yesterdays subjects unavailable (${e.message}); keeping previous matches.`);
  }

  const bySubject = new Map(); // qid → ids, or null when the lookup failed
  const wanted = new Map(); // sign key → { ids, incomplete }
  for (const f of features) {
    const ids = new Set();
    let incomplete = !georefs || !neonIds || !subjectsOk;
    const names = yesterdays.signNames(f.properties);
    const located = yesterdays.matchSubjects(f.geometry.coordinates, names, subjects, subjectCoords);
    for (const q of new Set([...yesterdays.signQids(f.properties), ...located])) {
      if (!bySubject.has(q)) {
        try {
          bySubject.set(q, await yesterdays.fetchSubjectImageIds(q));
        } catch (e) {
          console.warn(`Yesterdays subject ${q} lookup failed (${e.message}).`);
          bySubject.set(q, null);
        }
      }
      if (bySubject.get(q) === null) incomplete = true;
      for (const id of bySubject.get(q) || []) ids.add(id);
    }
    if (georefs) {
      for (const id of yesterdays.matchGeoreferences(f.geometry.coordinates, names, georefs)) ids.add(id);
    }
    if (georefs && neonIds) {
      for (const id of yesterdays.matchAimedNeon(f.geometry.coordinates, neonIds, georefs)) ids.add(id);
    }
    wanted.set(key(f.properties), { ids, incomplete });
  }

  const entries = new Map();
  for (const id of new Set([...wanted.values()].flatMap((w) => [...w.ids]))) {
    try {
      entries.set(id, yesterdays.toEntry(await yesterdays.fetchImageDetail(id)));
    } catch (e) {
      console.warn(`Yesterdays image ${id} lookup failed (${e.message}); reusing what we had.`);
      entries.set(id, prevById.get(id) || null);
    }
  }

  for (const f of features) {
    const { ids, incomplete } = wanted.get(key(f.properties));
    const list = new Map([...ids].map((id) => [id, entries.get(id)]).filter(([, e]) => e));
    if (incomplete) for (const e of previous.get(key(f.properties)) || []) if (!list.has(e.id)) list.set(e.id, e);
    if (list.size) f.properties.yesterdays = [...list.values()].sort((a, b) => a.id - b.id).map(sortKeys);
  }
  const n = features.filter((f) => f.properties.yesterdays).length;
  console.log(`Yesterdays: ${entries.size} images matched to ${n} signs.`);
}

function serialize(header, features) {
  const head = JSON.stringify({ type: "FeatureCollection", ...header }).slice(0, -1);
  return `${head},"features":[\n${features.map((f) => JSON.stringify(f)).join(",\n")}\n]}\n`;
}

function readExisting() {
  if (!existsSync(OUTPUT)) return null;
  try {
    return JSON.parse(readFileSync(OUTPUT, "utf8"));
  } catch {
    console.warn("WARNING: existing data/signs.geojson is unreadable; it will be replaced.");
    return null;
  }
}

async function main() {
  const lines = loadRoute();
  const index = new SegmentIndex(lines);
  const bbox = paddedBbox(lines);

  // NEON_SOURCE=overpass skips Postpass (for testing, or when it's down).
  let result, source;
  try {
    if (process.env.NEON_SOURCE === "overpass") throw new Error("skipped via NEON_SOURCE=overpass");
    console.log("Querying Postpass…");
    result = await fromPostpass(bbox);
    source = "postpass";
  } catch (e) {
    console.warn(`Postpass not used (${e.message.split("\n")[0]}); querying Overpass.`);
    result = await fromOverpass(bbox);
    source = "overpass";
  }
  console.log(`${source}: ${result.elements.length} candidate lit signs in the bounding box.`);

  const byKey = new Map();
  let offRoute = 0;
  for (const el of result.elements) {
    if (!isNeonSign(el.tags)) continue;
    if (index.nearestM([el.lon, el.lat], BUFFER_M) === Infinity) {
      offRoute++;
      continue;
    }
    byKey.set(`${el.type}/${el.id}`, el);
  }
  const features = [...byKey.values()]
    .sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.id - b.id)
    .map(toFeature);
  console.log(`${features.length} neon signs within ${BUFFER_M} m of Route 66 (${offRoute} elsewhere skipped).`);

  if (!features.length) throw new Error("No neon signs found; refusing to write an empty map.");

  const existing = readExisting();
  await attachMapillaryViews(features, existing);
  await attachFlickr(features, existing);
  await attachWiki(features, existing);
  await attachYesterdays(features, existing, bbox);
  const oldFeatures = existing?.features || [];
  if (oldFeatures.length) {
    const drop = ((oldFeatures.length - features.length) / oldFeatures.length) * 100;
    if (drop > DROP_THRESHOLD) {
      throw new Error(
        `SAFETY CHECK FAILED: signs dropped ${oldFeatures.length} → ${features.length} ` +
          `(${drop.toFixed(0)}%, threshold ${DROP_THRESHOLD}%). Not updating.`
      );
    }
  }

  const same =
    oldFeatures.length === features.length &&
    oldFeatures.every((f, i) => JSON.stringify(f) === JSON.stringify(features[i])) &&
    existing?.buffer_m === BUFFER_M;
  if (same) {
    console.log("No changes to the signs; leaving data/signs.geojson untouched.");
    return;
  }

  writeFileSync(
    OUTPUT,
    serialize({ osm_base: result.timestamp, source, buffer_m: BUFFER_M }, features)
  );
  console.log(`Wrote ${features.length} signs to ${OUTPUT} (${oldFeatures.length} before).`);
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
