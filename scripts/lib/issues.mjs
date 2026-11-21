// Problems in the OSM data that a data update works around instead of failing:
// a photo tagged on the wrong sign, a photo that no longer exists, and so on.
// fetch-signs.mjs collects them while it builds data/signs.geojson, leaves the
// bad bit out of the map, and writes the list to data/issues.md for mappers to
// follow up. The file holds no timestamps, so it only changes (and gets
// committed) when the issues do.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { signTitle } from "../../js/signs.js";

/**
 * How far from its sign a photo may be, in km. Anything farther is a tagging
 * mistake (wrong photo id, or a sign in the wrong place) and is left out.
 * tests/data.test.mjs checks the published file against the same limits.
 */
export const MAX_KM = {
  mapillary: 10,
  // Yesterdays subjects can be georeferenced loosely, so allow more.
  yesterdays: 50,
};

/** Rough distance in km between two [lon, lat] points; fine at this scale. */
export function distanceKm([lon1, lat1], [lon2, lat2]) {
  const kx = 111 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 111);
}

/** Collects issues as { key, title, kind, message }, one per problem. */
export class IssueLog {
  constructor() {
    this.list = [];
  }

  /** `feature` is a signs.geojson feature; `message` is Markdown. */
  add(feature, kind, message) {
    const { osm_type, osm_id, tags } = feature.properties;
    this.list.push({ key: `${osm_type}/${osm_id}`, title: signTitle(tags), kind, message });
    console.warn(`Data issue on ${osm_type}/${osm_id}: ${message.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")}`);
  }
}

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The issues as a Markdown page, sorted by sign then kind. */
export function issuesMarkdown(issues) {
  const head = [
    "# Data issues",
    "",
    "Problems in the OpenStreetMap data that the last data update worked around.",
    "Each one says what the map does about it until it's fixed in OSM. This file",
    "is rewritten by every run of `scripts/fetch-signs.mjs`, so fixed issues drop",
    "off on their own.",
    "",
  ];
  if (!issues.length) return [...head, "No issues found.", ""].join("\n");
  const sorted = [...issues].sort(
    (a, b) => a.key.localeCompare(b.key, "en", { numeric: true }) || a.kind.localeCompare(b.kind) || a.message.localeCompare(b.message)
  );
  const rows = sorted.map(
    (i) => `| [${cell(i.title)}](https://www.openstreetmap.org/${i.key}) \`${i.key}\` | ${cell(i.kind)} | ${cell(i.message)} |`
  );
  return [...head, `${issues.length} issue${issues.length === 1 ? "" : "s"}:`, "", "| Sign | Kind | Problem |", "|---|---|---|", ...rows, ""].join("\n");
}

/** Write the page if it changed. Returns true when the file was written. */
export function writeIssues(path, issues) {
  const text = issuesMarkdown(issues);
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  writeFileSync(path, text);
  return true;
}
