// Look up where a Mapillary photo was taken, which way it faces, and whether
// it's a 360° panorama — so the map can turn the viewer toward the sign.
//
// Position, compass_angle, is_pano and captured_at come from Mapillary's
// public coverage vector tiles (layer `image` at z14), which any token can
// read. Which way a panorama's image centre faces comes from the Graph API's
// computed_compass_angle, which needs a token from an app with Read access;
// with a tiles-only token that step is skipped and js/aim.js falls back to
// compass_angle plus a per-uploader lens offset.
//
// Token resolution, first hit wins: MAPILLARY_TOKEN env (CI secret), then
// `.mapillary-token` in the repo root (gitignored). The token travels in the
// tile URL, so URLs are never logged.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { round } from "./geo.mjs";
import { decodeTile, lonLatToTile, tilePixelToLonLat } from "./mvt.mjs";
import { userAgent } from "./sources.mjs";

const TILE_URL = "https://tiles.mapillary.com/maps/vtp/mly1_public/2";
const Z = 14; // the zoom where the `image` layer has every individual photo

export function mapillaryToken(repoRoot) {
  const env = process.env.MAPILLARY_TOKEN?.trim();
  if (env) return env;
  const file = join(repoRoot, ".mapillary-token");
  if (existsSync(file)) return readFileSync(file, "utf8").trim() || null;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve image ids to views. `wanted` is [{ id, lon, lat }] where lon/lat is
 * roughly where the photo should be (the sign). Returns Map id → view.
 * Looks in the sign's tile first, then its 8 neighbours. Tiles that couldn't
 * be fetched are counted in `stats.failedTiles`, so a caller can tell "not
 * near the sign" from "couldn't look".
 */
export async function lookupMapillaryViews(wanted, token, stats = {}) {
  stats.failedTiles = 0;
  const tiles = new Map(); // "x/y" → Promise<Map id → view>
  const getTile = (t) => {
    const k = `${t.x}/${t.y}`;
    if (!tiles.has(k)) {
      const views = fetchTile(t, token).then((v) => {
        if (v) return v;
        stats.failedTiles++;
        return new Map();
      });
      tiles.set(k, views);
    }
    return tiles.get(k);
  };

  const found = new Map();
  for (const { id, lon, lat } of wanted) {
    if (found.has(id)) continue;
    const t0 = lonLatToTile(lon, lat, Z);
    const order = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dy] of order) {
      const views = await getTile({ x: t0.x + dx, y: t0.y + dy, z: Z });
      if (views.has(id)) {
        found.set(id, views.get(id));
        break;
      }
    }
  }
  return found;
}

async function fetchTile(tile, token) {
  await sleep(150); // gentle on a shared CDN
  const url = `${TILE_URL}/${tile.z}/${tile.x}/${tile.y}?access_token=${encodeURIComponent(token)}`;
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": userAgent() } });
  } catch (e) {
    console.warn(`Mapillary tile ${tile.z}/${tile.x}/${tile.y}: network error (${e.cause?.code || e.name})`);
    return null;
  }
  if (!res.ok) {
    console.warn(`Mapillary tile ${tile.z}/${tile.x}/${tile.y}: HTTP ${res.status}`);
    return null;
  }
  const layer = decodeTile(new Uint8Array(await res.arrayBuffer())).image;
  const views = new Map();
  for (const f of layer?.features || []) {
    const p = f.properties;
    if (!f.point || p.id == null) continue;
    const [lon, lat] = tilePixelToLonLat(tile, f.point[0], f.point[1], layer.extent);
    views.set(String(p.id), toView(lon, lat, p));
  }
  return views;
}

const GRAPH_URL = "https://graph.mapillary.com/images";
const GRAPH_BATCH = 50;

/**
 * Mapillary's computed_compass_angle for each image id: the heading of the
 * image centre after Mapillary aligned the photo with its neighbours. For 360°
 * photos it's what says whether the lens faced left or right of travel, which
 * compass_angle (usually the direction of travel) can't.
 * Returns Map id → degrees. Ids Mapillary hasn't aligned yet are left out.
 * Returns null when the token can't read the Graph API at all.
 */
export async function lookupComputedCompass(ids, token) {
  const found = new Map();
  let readable = false;
  for (let i = 0; i < ids.length; i += GRAPH_BATCH) {
    const batch = ids.slice(i, i + GRAPH_BATCH);
    const url = `${GRAPH_URL}?image_ids=${batch.join(",")}&fields=id,computed_compass_angle`;
    let res;
    try {
      // Header, not query string: keeps the token out of the URL.
      res = await fetch(url, { headers: { Authorization: `OAuth ${token}`, "User-Agent": userAgent() } });
    } catch (e) {
      console.warn(`Mapillary Graph API: network error (${e.cause?.code || e.name})`);
      return readable ? found : null;
    }
    if (!res.ok) {
      console.warn(`Mapillary Graph API: HTTP ${res.status}`);
      return readable ? found : null;
    }
    const data = (await res.json())?.data || [];
    // A token without Read access gets 200 with an empty list for public photos.
    if (data.length) readable = true;
    for (const d of data) {
      if (typeof d.computed_compass_angle === "number") found.set(String(d.id), round(((d.computed_compass_angle % 360) + 360) % 360, 1));
    }
    await sleep(150);
  }
  return readable ? found : null;
}

function toView(lon, lat, p) {
  const view = { lon: round(lon, 7), lat: round(lat, 7), pano: p.is_pano === true };
  if (typeof p.compass_angle === "number") view.compass = round(p.compass_angle, 1);
  // Who uploaded it decides how compass_angle relates to the image centre (js/aim.js).
  if (p.creator_id != null) view.creator = String(p.creator_id);
  if (typeof p.captured_at === "number") view.captured = new Date(p.captured_at).toISOString().slice(0, 10);
  return view;
}
