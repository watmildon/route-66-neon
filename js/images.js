// Turn a sign's tags into an ordered list of photos the detail panel can show.
// Pure functions (no DOM, no network) so they run under `node --test` too.
//
// Recognised tags, in display order:
//   mapillary=*, mapillary:*=*          Mapillary image IDs (the project's required tag)
//   panoramax=*, panoramax:*=*          Panoramax picture UUIDs
//   wikimedia_commons=*, …:*=*          "File:…" names (Category: values are skipped)
//   image=*, image:*=*                  URLs: Commons/Mapillary/Panoramax links are
//                                       recognised, direct image files are shown,
//                                       anything else becomes a plain link.

import { splitValues } from "./signs.js";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DIRECT_IMAGE = /\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i;

const KIND_ORDER = { mapillary: 0, panoramax: 1, commons: 2, url: 3, link: 4 };

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

/** Classify a single image=* value. Returns a source object or null. */
export function classifyImageValue(value, key) {
  const v = String(value ?? "").trim();
  if (!v) return null;

  // Bare "File:Foo.jpg" occasionally lands in image=*.
  if (/^(File|Image):/i.test(v)) return commons(v, key);

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

/** All photos for a sign, ordered Mapillary → Panoramax → Commons → URLs → links. */
export function imageSources(tags = {}) {
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
    } else if (/^panoramax(:\d+)?$/.test(key)) {
      for (const v of values) {
        const m = UUID.exec(v);
        if (m) add(panoramax(m[0], key));
      }
    } else if (/^wikimedia_commons(:\d+)?$/.test(key)) {
      for (const v of values) if (/^(File|Image):/i.test(v)) add(commons(v, key));
    } else if (/^image(:\d+)?$/.test(key)) {
      for (const v of values) add(classifyImageValue(v, key));
    }
  }

  // Stable sort: by kind, keeping tag-key order within a kind.
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => KIND_ORDER[a.s.kind] - KIND_ORDER[b.s.kind] || a.i - b.i)
    .map(({ s }) => s);
}

/** True when at least one source can actually render a picture (not just a link). */
export function hasPhoto(sources) {
  return sources.some((s) => s.kind !== "link");
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
