// OSM data clients: Postpass (primary, for signs) and Overpass (route line, and
// fallback for signs). Both return a normalised list of elements:
//   { type: "node"|"way"|"relation", id, lon, lat, tags }
//
// Overpass endpoints, tried in this order until one answers:
//   1. the private instance, first hit wins: OVERPASS_URL, else
//      OVERPASS_PRIMARY_URL (CI repository secret), else .overpass-url in the
//      repo root (gitignored), else ~/.claude/.overpass-url
//   2. a secondary private instance, as a backup: OVERPASS_SECONDARY_URL (CI
//      repository secret), else .overpass-secondary-url in the repo root
//      (gitignored), else ~/.claude/.overpass-secondary-url
//   3. public mirrors
// Private URLs are secrets: they are never logged — errors report only a
// label and an HTTP status code.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const POSTPASS_URL = "https://postpass.geofabrik.de/api/interpreter";

const PUBLIC_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const OSM_TYPE = { N: "node", W: "way", R: "relation" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function userAgent() {
  return (
    process.env.NEON_USER_AGENT ||
    "route-66-neon/1.0 (+https://github.com/watmildon/route-66-neon)"
  );
}

export function maxLagHours() {
  return Number(process.env.NEON_MAX_DATA_LAG_HOURS || 48);
}

/** Throw if an OSM data timestamp is older than the freshness policy. */
export function checkFreshness(stamp, label) {
  if (!stamp) {
    console.warn(`WARNING: ${label} returned no data timestamp; skipping freshness check.`);
    return;
  }
  const lag = (Date.now() - new Date(stamp).getTime()) / 3_600_000;
  if (!Number.isFinite(lag)) {
    console.warn(`WARNING: ${label} returned an unparseable timestamp; skipping freshness check.`);
    return;
  }
  if (lag > maxLagHours()) {
    throw new Error(`${label} data is ${lag.toFixed(1)}h old (limit ${maxLagHours()}h).`);
  }
  console.log(`${label} data timestamp ${stamp} (${lag.toFixed(1)}h old).`);
}

async function post(url, data, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": userAgent(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ data }),
      signal: controller.signal,
    });
    return { status: res.status, ok: res.ok, text: await res.text() };
  } catch (e) {
    // Never surface e.message: undici errors can embed the hostname.
    const why = e.name === "AbortError" ? `timed out after ${timeoutMs / 1000}s` : `network error (${e.cause?.code || e.name})`;
    return { status: 0, ok: false, text: "", why };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- Postpass --

/** Run a Postpass SQL query (no trailing semicolon). One retry on transient failure. */
export async function postpassQuery(sql, { timeoutMs = 300_000 } = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await post(POSTPASS_URL, sql, timeoutMs);
    if (r.ok) {
      let json;
      try {
        json = JSON.parse(r.text);
      } catch {
        // SQL errors come back as plain text with a 200.
        throw new Error(`Postpass returned non-JSON (likely a query error): ${r.text.slice(0, 300)}`);
      }
      if (!Array.isArray(json.features)) throw new Error("Postpass response has no features array.");
      checkFreshness(json.postpass_properties?.timestamp, "Postpass");
      return {
        timestamp: json.postpass_properties?.timestamp || null,
        elements: json.features.map(postpassToElement).filter(Boolean),
      };
    }
    const transient = r.status === 0 || r.status === 429 || r.status >= 500;
    const msg = r.why || `HTTP ${r.status}`;
    if (!transient || attempt === 2) throw new Error(`Postpass ${msg}: ${r.text.slice(0, 300)}`);
    console.warn(`Postpass ${msg}; retrying once in 15s…`);
    await sleep(15_000);
  }
}

function postpassToElement(f) {
  const c = f?.geometry?.coordinates;
  const p = f?.properties || {};
  if (!Array.isArray(c) || c.length < 2) return null;
  let tags = p.tags || {};
  if (typeof tags === "string") tags = JSON.parse(tags);
  const type = OSM_TYPE[p.osm_type];
  if (!type || p.osm_id == null) return null;
  return { type, id: Number(p.osm_id), lon: c[0], lat: c[1], tags };
}

// ---------------------------------------------------------------- Overpass --

function readUrlFile(path) {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function overpassEndpoints(repoRoot) {
  const eps = [];
  const addPrivate = (url, label) => {
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) console.warn(`WARNING: ${label} URL is malformed; skipping it.`);
    else if (!eps.some((e) => e.url === url)) eps.push({ url, label, isPublic: false });
  };
  addPrivate(
    process.env.OVERPASS_URL?.trim() ||
      process.env.OVERPASS_PRIMARY_URL?.trim() ||
      readUrlFile(join(repoRoot, ".overpass-url")) ||
      readUrlFile(join(homedir(), ".claude", ".overpass-url")),
    "private Overpass"
  );
  addPrivate(
    process.env.OVERPASS_SECONDARY_URL?.trim() ||
      readUrlFile(join(repoRoot, ".overpass-secondary-url")) ||
      readUrlFile(join(homedir(), ".claude", ".overpass-secondary-url")),
    "secondary private Overpass"
  );
  PUBLIC_MIRRORS.forEach((url, i) => eps.push({ url, label: `public Overpass mirror ${i + 1}`, isPublic: true }));
  return eps;
}

let lastPublicRequest = 0;

/**
 * Run an Overpass QL query against each endpoint in turn until one returns a
 * usable, fresh answer. Returns { timestamp, json, label }.
 */
export async function overpassQuery(ql, { repoRoot, timeoutMs = 330_000 } = {}) {
  const failures = [];
  for (const ep of overpassEndpoints(repoRoot)) {
    if (ep.isPublic) {
      // Courtesy floor for shared mirrors only; the private instance is unthrottled.
      const wait = lastPublicRequest + 1000 - Date.now();
      if (wait > 0) await sleep(wait);
      lastPublicRequest = Date.now();
    }
    const r = await post(ep.url, ql, timeoutMs);
    const fail = (why) => {
      console.warn(`${ep.label}: ${why}`);
      failures.push(`${ep.label}: ${why}`);
    };
    if (r.status === 429) {
      fail("HTTP 429");
      if (ep.isPublic) await sleep(8_000);
      continue;
    }
    if (!r.ok) {
      fail(r.why || `HTTP ${r.status}`);
      continue;
    }
    let json;
    try {
      json = JSON.parse(r.text);
    } catch {
      fail("non-JSON response");
      continue;
    }
    if (!Array.isArray(json.elements)) {
      fail("response has no elements array");
      continue;
    }
    if (json.remark && json.elements.length === 0) {
      fail(`remark with no elements: ${String(json.remark).slice(0, 200)}`);
      continue;
    }
    const stamp = json.osm3s?.timestamp_osm_base;
    try {
      checkFreshness(stamp, ep.label);
    } catch (e) {
      fail(e.message);
      continue;
    }
    return { timestamp: stamp || null, json, label: ep.label };
  }
  throw new Error(`All Overpass endpoints failed:\n  ${failures.join("\n  ")}`);
}

/** Normalise `out center tags` / `out body` elements. */
export function overpassToElements(json) {
  const out = [];
  for (const e of json.elements) {
    const lon = e.lon ?? e.center?.lon;
    const lat = e.lat ?? e.center?.lat;
    if (lon == null || lat == null) continue;
    out.push({ type: e.type, id: e.id, lon, lat, tags: e.tags || {} });
  }
  return out;
}
