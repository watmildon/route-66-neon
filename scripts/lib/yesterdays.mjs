// Link signs to historical photos and postcards on Yesterdays
// (https://yesterdays.today), a crowd-georeferenced archive of old images.
//
// Two automatic matches, both at build time so visitors never call the API:
//   1. Subject: images whose Wikidata subjects include an item the sign links
//      to (wikidata=*, subject:wikidata=*, or the wiki-linked place next to it).
//   2. Georeference: images georeferenced within MATCH_RADIUS_M of the sign
//      whose title names it ("Roy's Motel sign" for a sign reading "Roy's").
//      Position alone isn't enough: a block of old motels has many photos.
//
// Requests are spaced about a second apart; a full run is a few dozen.

import { distanceM } from "../../js/aim.js";
import { userAgent } from "./sources.mjs";

export const API = "https://yesterdays.today/api/v2";
export const SITE = "https://yesterdays.today";
export const MATCH_RADIUS_M = 150;
const SPACING_MS = 1000;

// Words too common in sign text and photo titles to identify a place.
const STOP = new Set(
  (
    "the and of on in at for a an to by with " +
    "motel motels hotel hotels motor court courts cottages cabins lodge inn tourist cafe restaurant diner " +
    "dining room cocktail lounge coffee shop shops bar grill food steak house " +
    "sign signs neon route highway hwy us 66 street avenue ave blvd " +
    "vacancy no air conditioned refrigerated tv television phones telephones best view " +
    "photo photograph postcard owners owner prop mr mrs and company co new old"
  ).split(" ")
);

const fold = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]s\b/g, "");

/** Distinctive lower-case words of a name or title, in order (accents and possessive 's dropped). */
function wordList(s) {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Distinctive lower-case words of a name or title (accents and possessive 's dropped). */
export function nameTokens(s) {
  return new Set(wordList(s));
}

/**
 * True when the title names one of the sign's names: they share at least two
 * distinctive words, or every distinctive word when either side has only one.
 * Two or more of the name's words run together also count ("Blueswallow
 * Motel sign" names "Blue Swallow").
 */
export function titleMatches(names, title) {
  const t = nameTokens(title);
  if (!t.size) return false;
  const joined = fold(title).replace(/[^a-z0-9]/g, "");
  for (const name of names) {
    const words = wordList(name);
    const a = new Set(words);
    if (!a.size) continue;
    let shared = 0;
    for (const w of a) if (t.has(w)) shared++;
    if (shared >= Math.min(2, a.size, t.size)) return true;
    for (let i = 0; i + 1 < words.length; i++) {
      if (joined.includes(words[i] + words[i + 1])) return true;
    }
  }
  return false;
}

/** Names a sign goes by: its own text and name, and the wiki-linked place's. */
export function signNames(props) {
  const t = props.tags || {};
  const names = [t.name, t.inscription, t.old_name, t.alt_name];
  for (const w of props.wiki || []) names.push(w.label, w.source_name);
  return [...new Set(names.filter(Boolean))];
}

/** Wikidata items a sign links to, directly or through the place next to it. */
export function signQids(props) {
  const t = props.tags || {};
  const q = [t.wikidata, t["subject:wikidata"], ...(props.wiki || []).map((w) => w.qid)];
  return [...new Set(q.flatMap((v) => String(v ?? "").split(";")).map((v) => v.trim()).filter((v) => /^Q\d+$/.test(v)))];
}

/** Ids of georeferenced images within the radius whose title names the sign. */
export function matchGeoreferences(coord, names, georefs, radiusM = MATCH_RADIUS_M) {
  const ids = new Set();
  for (const g of georefs) {
    const c = g.geometry?.coordinates;
    if (!c || distanceM(coord, c) > radiusM) continue;
    if (titleMatches(names, g.properties?.image_title)) ids.add(g.properties.image_id);
  }
  return [...ids];
}

/** A readable date from an EDTF value: "[1926..1969]" → "1926–1969", "195X" → "1950s". */
export function formatEdtf(edtf) {
  const v = String(edtf ?? "").trim();
  if (!v) return null;
  let m;
  if ((m = /^\[(\d{4})?\.\.(\d{4})?\]$/.exec(v))) {
    if (m[1] && m[2]) return m[1] === m[2] ? m[1] : `${m[1]}–${m[2]}`;
    if (m[2]) return `before ${m[2]}`;
    if (m[1]) return `after ${m[1]}`;
    return null;
  }
  if ((m = /^(\d{3})X$/i.exec(v))) return `${m[1]}0s`;
  if ((m = /^(\d{2})XX$/i.exec(v))) return `${Number(m[1]) + 1}th century`;
  if ((m = /^(\d{4})(-\d{2})?(-\d{2})?([?~%])?$/.exec(v))) return `${m[4] ? "c. " : ""}${m[1]}${m[2] || ""}${m[3] || ""}`;
  return v;
}

const httpsUrl = (u) => (/^https:\/\/[^\s"<>]+$/.test(String(u ?? "")) ? String(u) : null);

/**
 * What the viewer needs from an image detail record, or null if the image
 * can't be shown (a duplicate, or no thumbnail).
 */
export function toEntry(d) {
  if (!d || !Number.isInteger(d.id) || d.duplicate_of) return null;
  const thumb = httpsUrl(d.thumbnail);
  if (!thumb) return null;
  const display = d.date_display && d.date_display !== "undated" ? String(d.date_display).replace(/\.$/, "").trim() : null;
  const g = (d.georeferences || [])[0];
  const e = {
    id: d.id,
    title: String(d.title || "Untitled").trim(),
    thumb,
    page: `${SITE}/${d.id}/`,
    date: display || formatEdtf(d.edtf_date),
    creator: d.creator ? String(d.creator).trim() : null,
    source: d.collection?.source_name || null,
    collection: d.collection?.name || null,
    license: d.license?.display_name || d.license?.name || null,
    license_url: httpsUrl(d.license?.permalink),
    // The holding institution's page: where the rights statement lives when
    // Yesterdays has no licence for the image.
    original: httpsUrl(d.original_url),
  };
  if (g && Number.isFinite(g.longitude) && Number.isFinite(g.latitude)) {
    e.camera = { lon: +g.longitude.toFixed(6), lat: +g.latitude.toFixed(6) };
    if (Number.isFinite(g.direction)) e.camera.direction = g.direction;
  }
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v !== null));
}

// ------------------------------------------------------------------- API --

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = last + SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" } });
    } catch (e) {
      if (attempt === 2) throw new Error(`network error (${e.cause?.code || e.name})`);
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (attempt === 2 || (res.status < 500 && res.status !== 429)) throw new Error(`HTTP ${res.status}`);
    await sleep(3000 * (attempt + 1));
  }
  return null;
}

async function getAll(url) {
  const out = [];
  for (let next = url, pages = 0; next && pages < 100; pages++) {
    const j = await getJson(next);
    if (!j) break;
    out.push(...(j.results || j.features || []));
    next = j.next && j.next.startsWith(`${API}/`) ? j.next : null;
  }
  return out;
}

/** Georeferenced images in a [w, s, e, n] box. */
export function fetchGeoreferences([w, s, e, n]) {
  return getAll(`${API}/georeferences/?in_bbox=${[w, s, e, n].map((v) => v.toFixed(3)).join(",")}&page_size=100`);
}

/** Image ids whose subjects include this Wikidata item. */
export async function fetchSubjectImageIds(qid) {
  const results = await getAll(`${API}/images/?subject=${encodeURIComponent(qid)}&page_size=100`);
  return results.filter((r) => Number.isInteger(r.id) && !r.duplicate_of).map((r) => r.id);
}

/** One image's full record (licence, dates, georeferences). */
export function fetchImageDetail(id) {
  return getJson(`${API}/images/${id}/`);
}
