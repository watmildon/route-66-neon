import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROUTE_STATES, routeState } from "../js/states.js";

test("routeState places towns on each side of every state line", () => {
  const cases = [
    ["Illinois", [-87.642, 41.8779]], // Lou Mitchell's, Chicago
    ["Illinois", [-90.0888, 38.7619]], // Luna Cafe, Mitchell
    ["Missouri", [-90.308, 38.5894]], // Ted Drewes, St. Louis
    ["Missouri", [-94.5138, 37.0778]], // Joplin
    ["Kansas", [-94.6395, 37.0757]], // Galena
    ["Kansas", [-94.7352, 37.0248]], // Baxter Springs
    ["Oklahoma", [-94.8778, 36.8861]], // Miami
    ["Oklahoma", [-99.8737, 35.215]], // Erick
    ["Texas", [-100.2488, 35.2267]], // Shamrock
    ["Texas", [-103.0405, 35.18]], // Glenrio, Texas side
    ["New Mexico", [-103.7177, 35.1714]], // Tucumcari
    ["New Mexico", [-108.7286, 35.5301]], // Gallup
    ["Arizona", [-110.1688, 34.9026]], // Holbrook
    ["Arizona", [-114.49, 34.72]], // Topock
    ["California", [-114.6003, 34.8335]], // Needles
    ["California", [-118.4965, 34.0094]], // Santa Monica
  ];
  for (const [want, coord] of cases) assert.equal(routeState(coord), want, `${coord}`);
});

test("addr:state overrides the position when it names a Route 66 state", () => {
  assert.equal(routeState([-103.0405, 35.18], { "addr:state": "NM" }), "New Mexico");
  assert.equal(routeState([-103.0405, 35.18], { "addr:state": "new mexico" }), "New Mexico");
  assert.equal(routeState([-103.0405, 35.18], { "addr:state": "Nowhere" }), "Texas");
});

test("every sign in the data lands in a Route 66 state", () => {
  const fc = JSON.parse(readFileSync(new URL("../data/signs.geojson", import.meta.url), "utf8"));
  for (const f of fc.features) {
    assert.ok(ROUTE_STATES.includes(routeState(f.geometry.coordinates, f.properties.tags)));
  }
});
