// Point a Mapillary 360° viewer at a sign. Pure functions; tested under node.
//
// Mapillary's viewer takes the view centre as "basic" image coordinates:
// x, y ∈ [0, 1], origin top-left. In an equirectangular panorama x sweeps the
// full 360° clockwise from the heading of the image centre, so
//   x = 0.5 + (bearing to sign − centre heading) / 360   (wrapped into [0, 1))
// and y = 0.5 is the horizon, with 180° of pitch across the height:
//   y = 0.5 − pitch / 180.
//
// The catch is the centre heading. Mapillary's coverage tiles carry the
// uploader's compass_angle, which for 360° imagery is usually the GPS
// direction of travel — but 360° cameras are normally mounted with their
// lenses facing the sides of the car (it keeps the stitch seams off the road
// ahead and behind, and the camera out of the wind), so the image centre
// points sideways, not forward. Mapillary's own alignment (Graph API
// computed_compass_angle) accounts for that, but needs a full client token,
// so for tile data we assume the common left-facing mount and keep a table of
// uploaders known to differ.

/**
 * Degrees from a panorama's compass_angle to its image centre when nothing
 * more specific is known: lens facing 90° left of travel.
 */
export const DEFAULT_LENS_OFFSET = -90;

/**
 * Uploaders whose offset is verified or differs from the default (0° for a
 * forward-facing lens, +90° for right-facing). Calibrate one by opening a
 * panorama in Mapillary's embed with x=0.5 and noting which way it faces
 * relative to the car's travel.
 *
 * A value is either one offset, or a list of { before?, offset } for an
 * uploader whose rig changed between drives: the first entry whose `before`
 * (an ISO date) is later than the photo's capture date wins, and the last
 * entry (no `before`) covers newer photos and photos with no date.
 */
export const LENS_OFFSET_BY_CREATOR = {
  // nthp_gis: the National Trust for Historic Preservation's Route 66 drives,
  // the imagery this mapping project uses. Pinned so a change to the default
  // can't break the project's own photos.
  //  - April 2025 drive: lens faced right of travel. Verified on the
  //    Turquoise Tepee and Rod's Steak House signs in Williams AZ.
  //  - June 2026 drive: lens faces left. Verified against the Meadow Gold
  //    signs in Tulsa and three signs in Albuquerque.
  // The cut-off only needs to fall between the two drives.
  "681336961438940": [{ before: "2026-01-01", offset: 90 }, { offset: -90 }],
};

/** Degrees from compass_angle to the image centre for this photo's uploader and date. */
export function lensOffset(view) {
  const entry = LENS_OFFSET_BY_CREATOR[String(view?.creator)];
  if (typeof entry === "number") return entry;
  if (!Array.isArray(entry)) return DEFAULT_LENS_OFFSET;
  const when = typeof view?.captured === "string" ? view.captured : null;
  const hit = entry.find((e) => e.before && when && when < e.before) || entry.find((e) => !e.before);
  return typeof hit?.offset === "number" ? hit.offset : DEFAULT_LENS_OFFSET;
}

/** Heading of a panorama's image centre, or null if unknown. */
export function centreHeading(view) {
  if (typeof view?.computedCompass === "number") return view.computedCompass;
  if (typeof view?.compass !== "number") return null;
  return view.compass + lensOffset(view);
}

const R = 6_371_008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Initial great-circle bearing from a to b, degrees clockwise from north. */
export function bearingDeg([lon1, lat1], [lon2, lat2]) {
  const dLon = rad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Haversine distance in metres. */
export function distanceM([lon1, lat1], [lon2, lat2]) {
  const h =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const CAMERA_HEIGHT_M = 2.5; // roof-mounted 360 camera

/**
 * Rough height of the middle of the sign. OSM rarely says, so guess from
 * location=* / support=*; an explicit height=* (top of the sign) wins.
 */
export function signHeightM(tags = {}) {
  const h = parseFloat(String(tags.height ?? "").replace(",", "."));
  if (Number.isFinite(h) && h > 0 && h < 60) return h * 0.8;
  const location = String(tags.location ?? "");
  const support = String(tags.support ?? "");
  if (/roof/.test(location) || /roof/.test(support)) return 9;
  if (/^(pole|poles|pylon|ground|column)$/.test(support)) return 6;
  if (/overhead/.test(location)) return 5;
  if (/wall/.test(support)) return 4;
  return 4.5;
}

/**
 * Where to centre a panorama so it faces the sign.
 * `view` = { lon, lat, compass, creator, pano } from data/signs.geojson, or
 * { lon, lat, computedCompass, pano } from the Graph API.
 * Returns { x, y, bearing, distance } or null when the photo isn't a pano or
 * lacks the data to aim.
 */
export function aimPano(view, signCoord, tags) {
  const centre = centreHeading(view);
  if (!view?.pano || centre === null || view.lon == null) return null;
  const from = [view.lon, view.lat];
  const bearing = bearingDeg(from, signCoord);
  const distance = distanceM(from, signCoord);
  let x = 0.5 + (bearing - centre) / 360;
  x = ((x % 1) + 1) % 1;
  // Look up at the sign, but never so steeply that the street vanishes.
  const pitch = Math.max(-5, Math.min(30, deg(Math.atan2(signHeightM(tags) - CAMERA_HEIGHT_M, Math.max(distance, 1)))));
  const y = 0.5 - pitch / 180;
  return { x: +x.toFixed(4), y: +y.toFixed(4), bearing, distance };
}

/** Append x/y to a Mapillary embed or app URL. */
export function withCenter(url, aim) {
  if (!aim) return url;
  return `${url}&x=${aim.x}&y=${aim.y}`;
}
