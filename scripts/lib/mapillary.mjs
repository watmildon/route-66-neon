// Look up where a Mapillary photo was taken, which way it faces, and whether
// it's a 360° panorama — so the map can turn the viewer toward the sign.
//
// Reads Mapillary's public coverage vector tiles (layer `image` at z14) rather
// than the Graph API, because a tiles-only key is enough for that and the
// tiles carry everything needed: id, position, compass_angle, is_pano,
// captured_at.
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
 * Looks in the sign's tile first, then its 8 neighbours.
 */
export async function lookupMapillaryViews(wanted, token) {
  const tiles = new Map(); // "x/y" → Promise<Map id → view>
  const getTile = (t) => {
    const k = `${t.x}/${t.y}`;
    if (!tiles.has(k)) tiles.set(k, fetchTile(t, token));
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
    return new Map();
  }
  if (!res.ok) {
    console.warn(`Mapillary tile ${tile.z}/${tile.x}/${tile.y}: HTTP ${res.status}`);
    return new Map();
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

function toView(lon, lat, p) {
  const view = { lon: round(lon, 7), lat: round(lat, 7), pano: p.is_pano === true };
  if (typeof p.compass_angle === "number") view.compass = round(p.compass_angle, 1);
  // Who uploaded it decides how compass_angle relates to the image centre (js/aim.js).
  if (p.creator_id != null) view.creator = String(p.creator_id);
  if (typeof p.captured_at === "number") view.captured = new Date(p.captured_at).toISOString().slice(0, 10);
  return view;
}
