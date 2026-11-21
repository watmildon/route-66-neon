// Look up Flickr photos tagged on signs (flickr=*, or Flickr links in image=*)
// through Flickr's oEmbed endpoint. No API key needed, and it returns
// everything the viewer shows: image URL, title, author and licence. It sends
// no CORS header, so this runs at build time and visitors never call it.
//
// Owners can change a photo's licence or delete it, so entries are rechecked
// after RECHECK_DAYS. A photo that's gone (404) is dropped; on any other
// failure the previous entry is kept.

import { flickrShortUrl } from "../../js/images.js";
import { userAgent } from "./sources.mjs";

const OEMBED = "https://www.flickr.com/services/oembed/";
export const RECHECK_DAYS = 30;
const SPACING_MS = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpsOn = (u, hostRe) => {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && hostRe.test(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
};

/**
 * The fields the viewer needs from an oEmbed answer, or null if it isn't a
 * usable photo. Image URLs must be on Flickr's CDN and pages on flickr.com.
 */
export function toEntry(o, checked) {
  if (o?.type !== "photo") return null;
  const src = httpsOn(o.url, /^live\.staticflickr\.com$/);
  const page = httpsOn(o.web_page, /^www\.flickr\.com$/);
  const licenseId = Number.parseInt(o.license_id, 10);
  if (!src || !page || !Number.isInteger(licenseId)) return null;
  const entry = {
    page,
    src,
    thumb: httpsOn(o.thumbnail_url, /^live\.staticflickr\.com$/) || src,
    title: typeof o.title === "string" ? o.title.trim().slice(0, 200) : "",
    author: typeof o.author_name === "string" ? o.author_name.trim().slice(0, 120) : "",
    author_url: httpsOn(o.author_url, /^www\.flickr\.com$/),
    license: typeof o.license === "string" ? o.license.trim() : "",
    license_id: licenseId,
    license_url: httpsOn(o.license_url, /^(creativecommons\.org|www\.flickr\.com|flickr\.com)$/),
    checked,
  };
  return Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== null));
}

/**
 * One photo: { status: "ok", entry } | { status: "gone" } (404) |
 * { status: "error", detail }.
 */
export async function fetchFlickrPhoto(id, checked) {
  const q = new URLSearchParams({ url: flickrShortUrl(id), format: "json", maxwidth: "1024" });
  let res;
  try {
    res = await fetch(`${OEMBED}?${q}`, { headers: { "User-Agent": userAgent() } });
  } catch (e) {
    return { status: "error", detail: `network error (${e.cause?.code || e.name})` };
  }
  if (res.status === 404) return { status: "gone" };
  if (!res.ok) return { status: "error", detail: `HTTP ${res.status}` };
  let body;
  try {
    body = await res.json();
  } catch {
    return { status: "error", detail: "not JSON" };
  }
  const entry = toEntry(body, checked);
  return entry ? { status: "ok", entry } : { status: "error", detail: "not a usable photo" };
}

/** True when an entry is older than RECHECK_DAYS (or has no date). */
export function isStale(entry, today) {
  const t = Date.parse(entry?.checked);
  return !Number.isFinite(t) || (Date.parse(today) - t) / 86_400_000 >= RECHECK_DAYS;
}

/**
 * Bring a map of id → entry up to date for `ids`: look up new and stale ones.
 * Returns the new map, counts for logging, and the ids of photos that are gone.
 */
export async function refreshFlickr(ids, known, today) {
  const out = new Map();
  const counts = { looked: 0, gone: 0, failed: 0 };
  const goneIds = [];
  for (const id of ids) {
    const prev = known.get(id);
    if (prev && !isStale(prev, today)) {
      out.set(id, prev);
      continue;
    }
    if (counts.looked) await sleep(SPACING_MS);
    counts.looked++;
    const r = await fetchFlickrPhoto(id, today);
    if (r.status === "ok") out.set(id, r.entry);
    else if (r.status === "gone") {
      counts.gone++;
      goneIds.push(id);
      console.warn(`Flickr photo ${id} is gone (404); dropping it.`);
    } else {
      counts.failed++;
      console.warn(`Flickr photo ${id}: ${r.detail}${prev ? "; keeping what we had" : ""}.`);
      if (prev) out.set(id, prev);
    }
  }
  return { entries: out, ...counts, goneIds };
}
