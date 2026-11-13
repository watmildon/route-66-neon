// Sanity checks on the committed data files. CI runs these after refreshing the
// data and before committing, so a malformed file never reaches the live map.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isNeonSign } from "../js/signs.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));

// Chicago to Santa Monica, with room to spare.
const inCorridorBox = ([lon, lat]) => lon > -119.5 && lon < -86.5 && lat > 33 && lat < 43;

test("route66.geojson is a non-trivial MultiLineString", () => {
  const fc = load("route66.geojson");
  assert.equal(fc.type, "FeatureCollection");
  assert.equal(fc.features.length, 1);
  const g = fc.features[0].geometry;
  assert.equal(g.type, "MultiLineString");
  assert.ok(g.coordinates.length > 100, "suspiciously few route lines");
  for (const line of g.coordinates) {
    assert.ok(line.length >= 2);
    for (const p of line) assert.ok(inCorridorBox(p), `route point out of range: ${p}`);
  }
});

test("signs.geojson holds unique, sorted neon-sign points along the route", () => {
  const fc = load("signs.geojson");
  assert.equal(fc.type, "FeatureCollection");
  assert.ok(fc.features.length > 0, "no signs");
  assert.ok(fc.osm_base, "missing osm_base timestamp");

  const keys = new Set();
  let prev = null;
  for (const f of fc.features) {
    assert.equal(f.geometry.type, "Point");
    assert.ok(inCorridorBox(f.geometry.coordinates), `sign out of range: ${f.geometry.coordinates}`);
    const { osm_type, osm_id, tags } = f.properties;
    assert.ok(["node", "way", "relation"].includes(osm_type));
    assert.ok(Number.isInteger(osm_id) && osm_id > 0);
    assert.ok(isNeonSign(tags), `${osm_type}/${osm_id} is not tagged as a neon sign`);
    const key = `${osm_type}/${osm_id}`;
    assert.ok(!keys.has(key), `duplicate ${key}`);
    keys.add(key);
    if (prev && prev.osm_type === osm_type) assert.ok(prev.osm_id < osm_id, "features not sorted by id");
    prev = f.properties;
  }
});

test("wiki entries are well-formed", () => {
  const fc = load("signs.geojson");
  for (const f of fc.features) {
    for (const e of f.properties.wiki || []) {
      const where = `${f.properties.osm_type}/${f.properties.osm_id}`;
      assert.ok(e.qid || e.wikipedia, `${where}: wiki entry with neither qid nor wikipedia`);
      if (e.qid) assert.match(e.qid, /^Q\d+$/, where);
      if (e.wikipedia) assert.match(e.wikipedia, /^[a-z][a-z-]{1,15}:.+$/, where);
      assert.ok(e.source === "self" || /^(node|way|relation)\/\d+$/.test(e.source), `${where}: bad source ${e.source}`);
    }
  }
});

test("Mapillary views are well-formed and close to their sign", () => {
  const fc = load("signs.geojson");
  for (const f of fc.features) {
    for (const [id, v] of Object.entries(f.properties.mapillary || {})) {
      const where = `${f.properties.osm_type}/${f.properties.osm_id} photo ${id}`;
      assert.match(id, /^\d+$/, where);
      assert.equal(typeof v.pano, "boolean", where);
      assert.ok(v.compass === undefined || (v.compass >= 0 && v.compass <= 360), where);
      assert.ok(v.captured === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v.captured), where);
      // Photos come from tiles around the sign, so anything far away is a decoding bug.
      const [lon, lat] = f.geometry.coordinates;
      const dKm = Math.hypot((v.lon - lon) * 111 * Math.cos((lat * Math.PI) / 180), (v.lat - lat) * 111);
      assert.ok(dKm < 10, `${where} is ${dKm.toFixed(1)} km from the sign`);
    }
  }
});

test("alignments.geojson holds labelled LineStrings along the route", () => {
  const fc = load("alignments.geojson");
  assert.equal(fc.type, "FeatureCollection");
  assert.ok(fc.features.length > 50, "suspiciously few extra alignments");
  for (const f of fc.features) {
    assert.equal(f.geometry.type, "LineString");
    assert.ok(f.geometry.coordinates.length >= 2);
    for (const p of f.geometry.coordinates) assert.ok(inCorridorBox(p), `alignment point out of range: ${p}`);
    const { source, label, note } = f.properties;
    assert.ok(["relation", "old_ref"].includes(source), `bad source ${source}`);
    assert.ok(label && note, "alignment without hover text");
  }
});
