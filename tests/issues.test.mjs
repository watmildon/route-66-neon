import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceKm, IssueLog, issuesMarkdown } from "../scripts/lib/issues.mjs";

const sign = (osm_type, osm_id, tags) => ({ properties: { osm_type, osm_id, tags } });

test("distanceKm is close enough for sanity checks", () => {
  // Desert Hills Motel, Tulsa → Tower Theater, Oklahoma City: about 160 km.
  const d = distanceKm([-97.52, 35.4934], [-95.9181, 36.1478]);
  assert.ok(d > 155 && d < 170, `got ${d}`);
  assert.equal(distanceKm([-100, 35], [-100, 35]), 0);
});

test("issuesMarkdown lists issues sorted by sign, with OSM links", () => {
  const log = new IssueLog();
  const warn = console.warn;
  console.warn = () => {};
  try {
    log.add(sign("way", 5, { name: "Motel" }), "Flickr photo gone", "Flickr photo 1 is gone.");
    log.add(sign("node", 100, { inscription: "Desert | Hills" }), "Mapillary photo far away", "Taken 162 km away.");
    log.add(sign("node", 20, {}), "Mapillary photo far away", "Taken 12 km away.");
  } finally {
    console.warn = warn;
  }
  const md = issuesMarkdown(log.list);
  const rows = md.split("\n").filter((l) => l.startsWith("| ["));
  assert.deepEqual(
    rows.map((r) => r.match(/`([^`]+)`/)[1]),
    ["node/20", "node/100", "way/5"]
  );
  assert.match(rows[0], /^\| \[Neon sign\]\(https:\/\/www\.openstreetmap\.org\/node\/20\)/);
  assert.match(rows[1], /Desert \\\| Hills/, "pipes in titles are escaped");
  assert.match(md, /^3 issues:$/m);
});

test("issuesMarkdown says so when there's nothing to fix", () => {
  const md = issuesMarkdown([]);
  assert.match(md, /^# Data issues$/m);
  assert.match(md, /^No issues found\.$/m);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(md), "no dates, so an unchanged list doesn't make a commit");
});
