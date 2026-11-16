import { test } from "node:test";
import assert from "node:assert/strict";
import { josmLoadParams, latLonText, viewUrls } from "../js/editors.js";

const view = { lat: 35.1983, lon: -111.6513, zoom: 16.4 };

test("OSM, iD and Rapid get the view one zoom level up (256 px tiles)", () => {
  const u = viewUrls(view);
  assert.equal(u.osm, "https://www.openstreetmap.org/#map=17/35.19830/-111.65130");
  assert.equal(u.id, "https://www.openstreetmap.org/edit?editor=id#map=17/35.19830/-111.65130");
  assert.equal(u.rapid, "https://rapideditor.org/edit#map=17/35.19830/-111.65130");
});

test("Yesterdays keeps MapLibre's zoom", () => {
  assert.equal(viewUrls(view).yesterdays, "https://yesterdays.today/map/#16/35.19830/-111.65130");
});

test("zoom is capped for the 256 px editors", () => {
  assert.match(viewUrls({ ...view, zoom: 23 }).id, /#map=22\//);
});

test("lat/lon text is latitude first, 5 decimals", () => {
  assert.equal(latLonText({ lat: 35.198304, lon: -111.651296 }), "35.19830, -111.65130");
});

test("JOSM bounding box maps edges to left/right/bottom/top", () => {
  const q = new URLSearchParams(josmLoadParams({ west: -111.66, south: 35.19, east: -111.64, north: 35.2 }));
  assert.deepEqual(Object.fromEntries(q), {
    left: "-111.660000",
    right: "-111.640000",
    bottom: "35.190000",
    top: "35.200000",
  });
});

test("JOSM selection is added only when given", () => {
  const box = { west: 0, south: 0, east: 1, north: 1 };
  assert.equal(new URLSearchParams(josmLoadParams(box)).has("select"), false);
  assert.equal(new URLSearchParams(josmLoadParams(box, "n42")).get("select"), "n42");
});
