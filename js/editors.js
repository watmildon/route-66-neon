// Links that open the current map view (not a particular sign) elsewhere.
// Pure functions; tested under node.
//
// MapLibre tiles are 512 px, while openstreetmap.org, iD and Rapid count zoom
// on 256 px tiles, so the same view is one zoom level higher there.
// Yesterdays is a MapLibre map, so it takes MapLibre's zoom as-is.

import { yesterdaysMapUrl } from "./images.js";

/** Below this MapLibre zoom the view is too big to hand to JOSM (the OSM API caps downloads). */
export const JOSM_MIN_ZOOM = 13;

const osmZoom = (zoom) => Math.min(Math.round(zoom + 1), 22);
const hash = (zoom, lat, lon) => `map=${osmZoom(zoom)}/${lat.toFixed(5)}/${lon.toFixed(5)}`;

/**
 * URLs for a view centred on `lat`/`lon` at MapLibre zoom `zoom`.
 * @returns {{ osm: string, id: string, rapid: string, yesterdays: string }}
 */
export function viewUrls({ lat, lon, zoom }) {
  return {
    osm: `https://www.openstreetmap.org/#${hash(zoom, lat, lon)}`,
    id: `https://www.openstreetmap.org/edit?editor=id#${hash(zoom, lat, lon)}`,
    rapid: `https://rapideditor.org/edit#${hash(zoom, lat, lon)}`,
    yesterdays: yesterdaysMapUrl([lon, lat], Math.round(zoom)),
  };
}

/** "lat, lon" to 5 decimals (about 1 m), the order most tools accept when pasted. */
export function latLonText({ lat, lon }) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * Query string for JOSM Remote Control's /load_and_zoom over a bounding box,
 * optionally selecting objects (e.g. "n123,w456").
 */
export function josmLoadParams({ west, south, east, north }, select) {
  const p = new URLSearchParams({
    left: west.toFixed(6),
    right: east.toFixed(6),
    bottom: south.toFixed(6),
    top: north.toFixed(6),
  });
  if (select) p.set("select", select);
  return p.toString();
}
