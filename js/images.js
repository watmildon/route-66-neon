// Turn a sign's tags into an ordered list of photos the detail panel can show.
// Pure functions (no DOM, no network) so they run under `node --test` too.
//
// Recognised tags:
//   wikimedia_commons=*, …:*=*          "File:…" names, and "Category:…" names,
//                                       which become a thumbnail gallery
//   mapillary=*, mapillary:*=*          Mapillary image IDs (the project's required tag)
//   flickr=*, flickr:*=*                Flickr photo URLs (flickr.com/photos/…/<id>
//                                       or flic.kr/p/…), or bare photo ids
//   panoramax=*, panoramax:*=*          Panoramax picture UUIDs
//   image=*, image:*=*                  URLs: Commons/Flickr/Mapillary/Panoramax links are
//                                       recognised, direct image files are shown,
//                                       anything else becomes a plain link.
//
// Display order puts Commons first: those photos are usually chosen shots,
// often at night with the neon lit, where street-level imagery is daytime.

import { splitValues } from "./signs.js";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DIRECT_IMAGE = /\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i;

const KIND_ORDER = { commons: 0, gallery: 1, flickr: 2, mapillary: 3, panoramax: 4, yesterdays: 5, url: 6, link: 7 };

/**
 * Historical photos matched on yesterdays.today by the data pipeline
 * (properties.yesterdays), shown as one gallery tab.
 */
export function yesterdaysGallery(entries) {
  const items = (entries || []).filter((e) => Number.isInteger(e?.id) && /^https:\/\//.test(e.thumb || "") && /^https:\/\//.test(e.page || ""));
  if (!items.length) return null;
  return { kind: "yesterdays", id: "yesterdays", key: "yesterdays", label: "Yesterdays", items, credit: "Yesterdays" };
}

/** Yesterdays' map, centred on a spot (MapLibre's #zoom/lat/lon hash). */
export function yesterdaysMapUrl([lon, lat], zoom = 17) {
  return `https://yesterdays.today/map/#${zoom}/${Number(lat).toFixed(5)}/${Number(lon).toFixed(5)}`;
}

export function mapillary(id, key) {
  return {
    kind: "mapillary",
    id,
    key,
    label: "Mapillary",
    href: `https://www.mapillary.com/app/?pKey=${id}&focus=photo`,
    embed: `https://www.mapillary.com/embed?image_key=${id}&style=photo`,
    credit: "Mapillary (CC BY-SA 4.0)",
  };
}

// ---------------------------------------------------------------- Flickr --

// flic.kr short links are the photo id in Flickr's base58 alphabet.
const FLICKR_B58 = "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const FLICKR_HOST = /^(www\.|m\.|secure\.)?flickr\.com$/;

/** "https://flic.kr/p/2jpWycc" ← "50154038121": the form Flickr's oEmbed accepts for any photo id. */
export function flickrShortUrl(id) {
  let n = BigInt(id);
  let out = "";
  while (n > 0n) {
    out = FLICKR_B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return `https://flic.kr/p/${out || "1"}`;
}

/**
 * The photo id in a Flickr photo page URL or flic.kr short link, or a bare
 * id when `bare` is true (flickr=* sometimes holds just the id). Album, user
 * and group URLs have no single photo, so they give null.
 */
export function flickrPhotoId(value, { bare = false } = {}) {
  const v = String(value ?? "").trim();
  if (bare && /^\d{5,13}$/.test(v)) return v;
  let url;
  try {
    url = new URL(v.startsWith("//") ? `https:${v}` : v);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (FLICKR_HOST.test(host)) {
    const m = /^\/photos\/[^/]+\/(\d{5,13})(\/|$)/.exec(url.pathname);
    return m ? m[1] : null;
  }
  if (host === "flic.kr") {
    const m = /^\/p\/([1-9a-km-zA-HJ-NP-Z]{1,12})\/?$/.exec(url.pathname);
    if (!m) return null;
    let n = 0n;
    for (const c of m[1]) n = n * 58n + BigInt(FLICKR_B58.indexOf(c));
    return n > 0n ? n.toString() : null;
  }
  return null;
}

/** Flickr's licence id for All Rights Reserved: shown as a link, never inline. */
export const FLICKR_ALL_RIGHTS_RESERVED = 0;

/**
 * A Flickr photo. `info` is what the data pipeline looked up through Flickr's
 * oEmbed (properties.flickr[id]): { page, src, thumb, title, author,
 * author_url, license, license_id, license_url }. Without it, or for an
 * All Rights Reserved photo, there's no src and the photo is just a link.
 */
export function flickr(id, key, info = null) {
  const show = Boolean(info?.src) && info.license_id !== FLICKR_ALL_RIGHTS_RESERVED;
  return {
    kind: "flickr",
    id,
    key,
    label: "Flickr",
    href: info?.page || flickrShortUrl(id),
    src: show ? info.src : null,
    info,
    credit: "Flickr",
  };
}

export function panoramax(id, key) {
  const pic = id.toLowerCase();
  return {
    kind: "panoramax",
    id: pic,
    key,
    label: "Panoramax",
    // The federated meta-catalogue resolves pictures hosted on any instance.
    src: `https://api.panoramax.xyz/api/pictures/${pic}/sd.jpg`,
    href: `https://api.panoramax.xyz/#focus=pic&pic=${pic}`,
    credit: "Panoramax",
  };
}

export function commons(fileName, key, width = 1024) {
  const name = fileName.replace(/^(File|Image):/i, "").replace(/_/g, " ").trim();
  const enc = encodeURIComponent(name.replace(/ /g, "_"));
  return {
    kind: "commons",
    id: name,
    key,
    label: "Commons",
    src: `https://commons.wikimedia.org/wiki/Special:FilePath/${enc}?width=${width}`,
    href: `https://commons.wikimedia.org/wiki/File:${enc}`,
    credit: "Wikimedia Commons",
  };
}

/** A Commons category, shown as a gallery of its files. */
export function commonsGallery(categoryName, key) {
  const name = categoryName.replace(/^Category:/i, "").replace(/_/g, " ").trim();
  const enc = encodeURIComponent(name.replace(/ /g, "_"));
  return {
    kind: "gallery",
    id: name,
    key,
    label: "Gallery",
    href: `https://commons.wikimedia.org/wiki/Category:${enc}`,
    credit: "Wikimedia Commons",
  };
}

// ---------------------------------------------------------- Commons API --

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const CREDIT_FIELDS = "Artist|LicenseShortName|LicenseUrl|AttributionRequired";
export const GALLERY_LIMIT = 50;

function apiUrl(params) {
  // origin=* makes the API answer anonymous cross-origin requests.
  const q = new URLSearchParams({ action: "query", format: "json", formatversion: "2", origin: "*", ...params });
  return `${COMMONS_API}?${q}`;
}

/** API URL for one file's author and licence. */
export function commonsInfoUrl(fileName) {
  const name = fileName.replace(/^(File|Image):/i, "").trim();
  return apiUrl({ titles: `File:${name}`, prop: "imageinfo", iiprop: "extmetadata", iiextmetadatafilter: CREDIT_FIELDS });
}

/** API URL for a category's files, with thumbnails and credits. */
export function commonsCategoryUrl(categoryName, limit = GALLERY_LIMIT) {
  const name = categoryName.replace(/^Category:/i, "").trim();
  return apiUrl({
    generator: "categorymembers",
    gcmtitle: `Category:${name}`,
    gcmtype: "file",
    gcmlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "320",
    iiextmetadatafilter: CREDIT_FIELDS,
  });
}

/** Plain text from the small HTML fragments Commons puts in its metadata. */
export function htmlToText(html) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== "#") return named[e.toLowerCase()] ?? m;
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Only http(s) links survive; protocol-relative ones get https. */
function safeHttpUrl(u) {
  const v = String(u ?? "").trim();
  if (!v) return null;
  try {
    const url = new URL(v.startsWith("//") ? `https:${v}` : v);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Author and licence from an imageinfo extmetadata object.
 * Returns { author, license, licenseUrl }; any of them may be null.
 */
export function commonsCredit(extmetadata = {}) {
  const val = (k) => extmetadata?.[k]?.value;
  let author = htmlToText(val("Artist")) || null;
  if (author && author.length > 120) author = `${author.slice(0, 117).trimEnd()}…`;
  return {
    author,
    license: htmlToText(val("LicenseShortName")) || null,
    licenseUrl: safeHttpUrl(val("LicenseUrl")),
  };
}

/** Credit for a single-file API answer (commonsInfoUrl). */
export function parseCommonsInfo(json) {
  const page = json?.query?.pages?.[0];
  return commonsCredit(page?.imageinfo?.[0]?.extmetadata);
}

/**
 * Files from a category API answer (commonsCategoryUrl), sorted by title.
 * Each item: { file: commons source, thumb, credit }. `more` is true when the
 * category has more files than were fetched.
 */
export function parseCategoryFiles(json) {
  const pages = json?.query?.pages || [];
  const items = pages
    .filter((p) => p.ns === 6 && p.imageinfo?.[0])
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((p) => {
      const info = p.imageinfo[0];
      const file = commons(p.title, "gallery");
      return { file, thumb: safeHttpUrl(info.thumburl) || file.src.replace(/width=\d+/, "width=320"), credit: commonsCredit(info.extmetadata) };
    });
  return { items, more: Boolean(json?.continue) };
}

/** Classify a single image=* value. Returns a source object or null. */
export function classifyImageValue(value, key) {
  const v = String(value ?? "").trim();
  if (!v) return null;

  // Bare "File:Foo.jpg" / "Category:Foo" occasionally land in image=*.
  if (/^(File|Image):/i.test(v)) return commons(v, key);
  if (/^Category:/i.test(v)) return commonsGallery(v, key);

  // Only http(s) URLs may become links or <img> sources — never javascript: etc.
  let url;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();

  if (host === "commons.wikimedia.org" || host.endsWith(".wikipedia.org")) {
    const m = /\/wiki\/(File:.+)$/i.exec(url.pathname);
    if (m) return commons(safeDecode(m[1]), key);
    const c = /\/wiki\/(Category:.+)$/i.exec(url.pathname);
    if (c) return commonsGallery(safeDecode(c[1]), key);
  }

  if (FLICKR_HOST.test(host) || host === "flic.kr") {
    const id = flickrPhotoId(url.href);
    if (id) return flickr(id, key);
  }

  if (host.endsWith("mapillary.com")) {
    const pKey = url.searchParams.get("pKey") || url.searchParams.get("image_key");
    if (pKey && /^\d+$/.test(pKey)) return mapillary(pKey, key);
    const m = /\/map\/im\/(\d+)/.exec(url.pathname);
    if (m) return mapillary(m[1], key);
  }

  if (host.includes("panoramax")) {
    const pic = url.searchParams.get("pic") || new URLSearchParams(url.hash.slice(1)).get("pic");
    const m = UUID.exec(pic || url.pathname);
    if (m) return panoramax(m[0], key);
  }

  if (DIRECT_IMAGE.test(url.pathname)) {
    return { kind: "url", id: url.href, key, label: "Photo", src: url.href, href: url.href, credit: host };
  }

  return { kind: "link", id: url.href, key, label: "Link", href: url.href, credit: host };
}

/**
 * All photos for a sign, ordered Commons → Commons gallery → Flickr →
 * Mapillary → Panoramax → Yesterdays → URLs → links, except that All Rights
 * Reserved Flickr photos (which can only be linked to) come after URLs, just
 * ahead of links. `yesterdays` and
 * `flickr` are the sign's properties.yesterdays and properties.flickr from
 * the data file.
 */
export function imageSources(tags = {}, { yesterdays = [], flickr: flickrInfo = {} } = {}) {
  const out = [];
  const seen = new Set();
  const add = (src) => {
    if (!src) return;
    const id = `${src.kind}:${src.id}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(src);
  };

  for (const key of Object.keys(tags).sort()) {
    const values = splitValues(tags[key]);
    if (/^mapillary(:\d+)?$/.test(key)) {
      for (const v of values) add(/^\d+$/.test(v) ? mapillary(v, key) : classifyImageValue(v, key));
    } else if (/^flickr(:\d+)?$/.test(key)) {
      for (const v of values) {
        const id = flickrPhotoId(v, { bare: true });
        add(id ? flickr(id, key) : classifyImageValue(v, key));
      }
    } else if (/^panoramax(:\d+)?$/.test(key)) {
      for (const v of values) {
        const m = UUID.exec(v);
        if (m) add(panoramax(m[0], key));
      }
    } else if (/^wikimedia_commons(:\d+)?$/.test(key)) {
      for (const v of values) {
        if (/^(File|Image):/i.test(v)) add(commons(v, key));
        else if (/^Category:/i.test(v)) add(commonsGallery(v, key));
      }
    } else if (/^image(:\d+)?$/.test(key)) {
      for (const v of values) add(classifyImageValue(v, key));
    }
  }

  add(yesterdaysGallery(yesterdays));

  // Stable sort by kind, keeping tag-key order within a kind. All Rights
  // Reserved Flickr photos can only ever be linked to, so they go after
  // everything that shows a picture, just ahead of plain links.
  const rank = (s) =>
    s.kind === "flickr" && s.info?.license_id === FLICKR_ALL_RIGHTS_RESERVED ? KIND_ORDER.url + 0.5 : KIND_ORDER[s.kind];
  return out
    .map((s) => (s.kind === "flickr" ? flickr(s.id, s.key, flickrInfo?.[s.id] || null) : s))
    .map((s, i) => ({ s, i, r: rank(s) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ s }) => s);
}

/** True when at least one source can actually render a picture (not just a link). */
export function hasPhoto(sources) {
  return sources.some((s) => s.kind !== "link" && !(s.kind === "flickr" && !s.src));
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
