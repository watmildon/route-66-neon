// Wikipedia / Wikidata links for signs.
//
// Famous signs are usually linked through the place they belong to (the motel,
// diner or theatre), not the sign node itself. So for each sign we take:
//   1. wikidata=* / wikipedia=* on the sign, and
//   2. the closest wiki-linked OSM place within PLACE_RADIUS_M whose name
//      matches the sign's text — distance alone is not enough: "Motel Hiway
//      House" sits 34 m from an unrelated building with a Wikidata link.
// Then Wikidata fills in a label, short description, Wikipedia article and
// a Commons image.

import { round } from "./geo.mjs";
import { distanceM } from "../../js/aim.js";
import { overpassQuery, overpassToElements, postpassQuery, userAgent } from "./sources.mjs";

export const PLACE_RADIUS_M = 150;
const BOX_DEG = 0.002; // query box half-width; ≥ PLACE_RADIUS_M at Route 66 latitudes

// Words that say what kind of place something is, not which one.
const GENERIC = new Set(
  ("the and of a an on at in by for our is route us hwy highway " +
    "motel motels motor inn lodge court courts hotel cafe diner restaurant grill bar tavern " +
    "theater theatre cinema shop shops store co company neon sign no vacancy open " +
    "air conditioned refrigerated tv phones").split(" ")
);

export function nameTokens(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 2 && !GENERIC.has(t) && !/^\d+$/.test(t));
}

/**
 * True when every distinctive word of the shorter name appears in the longer
 * one: "HILAND" ~ "Hiland Theater", "Blue Swallow Motel 100% Refrigerated Air"
 * ~ "Blue Swallow Motel", but "Motel" matches nothing.
 */
export function namesMatch(a, b) {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  return [...small].every((t) => big.has(t));
}

const QID = /^Q\d+$/;
const WIKIPEDIA = /^([a-z][a-z-]{1,15}):(.+)$/;

/** Parse "en:Title" → { lang, title } or null. */
export function parseWikipedia(value) {
  const m = WIKIPEDIA.exec(String(value ?? "").trim());
  return m ? { lang: m[1], title: m[2].trim() } : null;
}

/** First valid Q-id in a (possibly multi-valued) wikidata=* value. */
const firstQid = (v) => String(v ?? "").split(";").map((s) => s.trim()).find((s) => QID.test(s)) || null;

/**
 * Pick the wiki-linked elements for one sign (pure; no network).
 * `places` are elements { type, id, lon, lat, tags } that carry wiki tags.
 * Returns [{ qid, wikipedia, source, sourceName }] — the sign's own link first.
 */
export function pickWikiLinks(sign, places) {
  const out = [];
  const t = sign.tags;
  const own = { qid: firstQid(t.wikidata), wikipedia: parseWikipedia(t.wikipedia) ? t.wikipedia.trim() : null };
  if (own.qid || own.wikipedia) out.push({ ...own, source: "self", sourceName: null });

  const signTexts = [t.inscription, t.name].filter(Boolean);
  let best = null;
  for (const p of places) {
    if (p.type === sign.type && p.id === sign.id) continue;
    const name = p.tags.name;
    if (!name || !signTexts.some((s) => namesMatch(s, name))) continue;
    const qid = firstQid(p.tags.wikidata);
    const wikipedia = parseWikipedia(p.tags.wikipedia) ? p.tags.wikipedia.trim() : null;
    if (!qid && !wikipedia) continue;
    const d = distanceM([sign.lon, sign.lat], [p.lon, p.lat]);
    if (d > PLACE_RADIUS_M) continue;
    if (!best || d < best.d) best = { d, qid, wikipedia, source: `${p.type}/${p.id}`, sourceName: name };
  }
  if (best) {
    const dup = out.some((o) => (o.qid && o.qid === best.qid) || (o.wikipedia && o.wikipedia === best.wikipedia));
    if (!dup) out.push({ qid: best.qid, wikipedia: best.wikipedia, source: best.source, sourceName: best.sourceName });
  }
  return out;
}

// ------------------------------------------------------------- fetching --

/** Wiki-tagged OSM places near any of the signs. Postpass, Overpass fallback. */
export async function fetchWikiPlaces(signs, repoRoot) {
  if (!signs.length) return [];
  try {
    if (process.env.NEON_SOURCE === "overpass") throw new Error("skipped via NEON_SOURCE=overpass");
    const values = signs.map((s) => `(${round(s.lon, 6)}, ${round(s.lat, 6)})`).join(", ");
    const sql = `
SELECT DISTINCT ON (p.osm_type, p.osm_id) p.osm_type, p.osm_id, p.tags, ST_PointOnSurface(p.geom) AS geom
FROM postpass_pointpolygon p
JOIN (VALUES ${values}) AS s(lon, lat)
  ON p.geom && ST_Expand(ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326), ${BOX_DEG})
WHERE p.tags ? 'wikidata' OR p.tags ? 'wikipedia'`;
    return (await postpassQuery(sql)).elements;
  } catch (e) {
    console.warn(`Postpass not used for wiki places (${e.message.split("\n")[0]}); querying Overpass.`);
    const around = signs
      .map((s) => `nwr(around:${PLACE_RADIUS_M},${s.lat},${s.lon})[~"^(wikidata|wikipedia)$"~"."];`)
      .join("\n  ");
    const { json } = await overpassQuery(`[out:json][timeout:120];\n(\n  ${around}\n);\nout center tags qt;`, { repoRoot });
    return overpassToElements(json);
  }
}

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

async function wikidataApi(params) {
  const url = `${WIKIDATA_API}?${new URLSearchParams({ format: "json", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": userAgent() } });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Wikidata error: ${json.error.code}`);
  return json.entities || {};
}

/** Map of QID → [lon, lat] from each item's coordinate location (P625). Items without one are left out. */
export async function fetchCoordinates(qids) {
  const out = new Map();
  const list = [...new Set(qids)].filter((q) => /^Q\d+$/.test(q));
  for (let i = 0; i < list.length; i += 50) {
    const entities = await wikidataApi({ action: "wbgetentities", ids: list.slice(i, i + 50).join("|"), props: "claims" });
    for (const [qid, e] of Object.entries(entities)) {
      const v = e.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
      if (Number.isFinite(v?.longitude) && Number.isFinite(v?.latitude)) out.set(qid, [v.longitude, v.latitude]);
    }
  }
  return out;
}

function summarise(entity) {
  const p18 = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  const enwiki = entity.sitelinks?.enwiki?.title;
  return {
    label: entity.labels?.en?.value || null,
    description: entity.descriptions?.en?.value || null,
    wikipedia: enwiki ? `en:${enwiki}` : null,
    image: typeof p18 === "string" ? p18 : null,
  };
}

/**
 * Fill in Wikidata details for links: { qid, wikipedia } → full entries.
 * Links with only wikipedia=* are resolved to a Q-id through their sitelink.
 * Throws on network/API failure so the caller can carry old data forward.
 */
export async function enrichWikiLinks(links) {
  // Wikipedia-only links → Q-ids, grouped by language wiki.
  const byWiki = new Map();
  for (const l of links) {
    if (l.qid || !l.wikipedia) continue;
    const { lang, title } = parseWikipedia(l.wikipedia);
    const site = `${lang}wiki`;
    if (!byWiki.has(site)) byWiki.set(site, new Set());
    byWiki.get(site).add(title);
  }
  const qidByTitle = new Map();
  for (const [site, titles] of byWiki) {
    const list = [...titles];
    for (let i = 0; i < list.length; i += 50) {
      const entities = await wikidataApi({
        action: "wbgetentities", sites: site, titles: list.slice(i, i + 50).join("|"), props: "sitelinks", sitefilter: site,
      });
      for (const [qid, e] of Object.entries(entities)) {
        const title = e.sitelinks?.[site]?.title;
        if (QID.test(qid) && title) qidByTitle.set(`${site.slice(0, -4)}:${title}`, qid);
      }
    }
  }
  for (const l of links) if (!l.qid && l.wikipedia) l.qid = qidByTitle.get(normaliseTitle(l.wikipedia)) || null;

  const qids = [...new Set(links.map((l) => l.qid).filter(Boolean))];
  const details = new Map();
  for (let i = 0; i < qids.length; i += 50) {
    const entities = await wikidataApi({
      action: "wbgetentities", ids: qids.slice(i, i + 50).join("|"),
      props: "labels|descriptions|sitelinks|claims", languages: "en", sitefilter: "enwiki",
    });
    for (const [qid, e] of Object.entries(entities)) if (!e.missing) details.set(qid, summarise(e));
  }

  return links.map((l) => {
    const d = (l.qid && details.get(l.qid)) || {};
    return toEntry(l, d);
  });
}

function normaliseTitle(wikipedia) {
  const { lang, title } = parseWikipedia(wikipedia);
  return `${lang}:${title.replace(/_/g, " ")}`;
}

/** Final stored shape; key order fixed for stable diffs. */
export function toEntry(link, details = {}) {
  const e = {};
  if (link.qid) e.qid = link.qid;
  const label = details.label || (link.wikipedia && parseWikipedia(link.wikipedia).title) || link.sourceName;
  if (label) e.label = label;
  if (details.description) e.description = details.description;
  // The mapper's wikipedia=* choice (maybe another language) beats Wikidata's enwiki.
  const wikipedia = link.wikipedia || details.wikipedia;
  if (wikipedia) e.wikipedia = wikipedia;
  if (details.image) e.image = details.image;
  e.source = link.source;
  if (link.sourceName) e.source_name = link.sourceName;
  return e;
}
