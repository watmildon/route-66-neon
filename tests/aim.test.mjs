import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aimPano,
  bearingDeg,
  centreHeading,
  DEFAULT_LENS_OFFSET,
  distanceM,
  LENS_OFFSET_BY_CREATOR,
  signHeightM,
  withCenter,
} from "../js/aim.js";

const near = (actual, expected, tol) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} not within ${tol} of ${expected}`);

test("bearingDeg gives compass bearings", () => {
  near(bearingDeg([0, 0], [0, 1]), 0, 1e-9);
  near(bearingDeg([0, 0], [1, 0]), 90, 1e-9);
  near(bearingDeg([0, 0], [0, -1]), 180, 1e-9);
  near(bearingDeg([0, 0], [-1, 0]), 270, 1e-9);
});

test("distanceM matches a known short distance", () => {
  near(distanceM([0, 0], [0, 0.001]), 111.19, 0.05);
});

test("aimPano centres x on the bearing relative to the image-centre heading", () => {
  // computedCompass is the image centre's heading directly (no lens offset),
  // so this checks the geometry alone.
  const sign = [0, 0.0002]; // ~22 m due north of the camera
  // Centre facing north: the sign is straight ahead.
  near(aimPano({ lon: 0, lat: 0, computedCompass: 0, pano: true }, sign, {}).x, 0.5, 1e-4);
  // Centre facing east: the sign is 90° to the left → a quarter-turn left of centre.
  near(aimPano({ lon: 0, lat: 0, computedCompass: 90, pano: true }, sign, {}).x, 0.25, 1e-4);
  // Centre facing west: 90° to the right.
  near(aimPano({ lon: 0, lat: 0, computedCompass: 270, pano: true }, sign, {}).x, 0.75, 1e-4);
  // Centre facing south: directly behind wraps to the seam.
  const behind = aimPano({ lon: 0, lat: 0, computedCompass: 180, pano: true }, sign, {}).x;
  assert.ok(behind < 1e-4 || behind > 1 - 1e-4, `expected seam, got ${behind}`);
});

const NTHP = "681336961438940";

test("NTHP panoramas centre 90° left of their compass_angle", () => {
  // Verified in Mapillary's embed: photo 1379075506891035 (compass 90.6°,
  // eastbound on 11th St, Tulsa) shows the car's hood dead ahead at x = 0.75.
  near(centreHeading({ compass: 90.6, creator: NTHP }), 0.6, 1e-9);
  assert.equal(centreHeading({ compass: 90.6, computedCompass: 12, creator: NTHP }), 12);
  assert.equal(centreHeading({}), null);
});

test("NTHP's April 2025 drive centres 90° right of compass_angle; the 2026 drive 90° left", () => {
  // Verified in Mapillary's embed: photo 1735457703759519 (compass 70.5°,
  // Williams AZ, 2025-04-17) only shows the Turquoise Tepee sign with the
  // right-facing offset; the left-facing one showed the motel across the street.
  near(centreHeading({ compass: 70.5, creator: NTHP, captured: "2025-04-17" }), 160.5, 1e-9);
  near(centreHeading({ compass: 90.6, creator: NTHP, captured: "2026-06-19" }), 0.6, 1e-9);
  const tepee = aimPano(
    { lon: -112.1876031, lat: 35.2507535, compass: 70.5, creator: NTHP, captured: "2025-04-17", pano: true },
    [-112.1877084, 35.25079],
    { advertising: "sign" }
  );
  near(tepee.x, 0.868, 0.002);
});

test("a dated table entry accepts plain numbers and falls back to the undated entry", () => {
  LENS_OFFSET_BY_CREATOR["changed-rig"] = [{ before: "2024-01-01", offset: 0 }, { offset: 90 }];
  try {
    assert.equal(centreHeading({ compass: 10, creator: "changed-rig", captured: "2023-05-01" }), 10);
    assert.equal(centreHeading({ compass: 10, creator: "changed-rig", captured: "2024-05-01" }), 100);
    assert.equal(centreHeading({ compass: 10, creator: "changed-rig" }), 100);
  } finally {
    delete LENS_OFFSET_BY_CREATOR["changed-rig"];
  }
});

test("other uploaders get the side-mounted default unless the table says otherwise", () => {
  near(centreHeading({ compass: 90.6, creator: "someone-else" }), 90.6 + DEFAULT_LENS_OFFSET, 1e-9);
  near(centreHeading({ compass: 90.6 }), 90.6 + DEFAULT_LENS_OFFSET, 1e-9);
  assert.equal(DEFAULT_LENS_OFFSET, -90);
  LENS_OFFSET_BY_CREATOR["forward-mount"] = 0;
  try {
    assert.equal(centreHeading({ compass: 90.6, creator: "forward-mount" }), 90.6);
  } finally {
    delete LENS_OFFSET_BY_CREATOR["forward-mount"];
  }
});

test("aimPano points the NTHP Tulsa photo at the Meadow Gold Mack sign", () => {
  // Sign node 8813401256, bearing ~199° from the camera → x ≈ 0.05, which was
  // confirmed visually to show the Meadow Gold Mack's Outpost building.
  const aim = aimPano(
    { lon: -95.9750926, lat: 36.147873, compass: 90.6, creator: NTHP, pano: true },
    [-95.9751866, 36.1476554],
    { support: "wall_mounted" }
  );
  near(aim.x, 0.052, 0.01);
});

test("aimPano looks up more for close, tall signs and never past 30°", () => {
  const view = { lon: 0, lat: 0, compass: 0, pano: true };
  const far = aimPano(view, [0, 0.0005], { support: "pole" }); // ~56 m
  const close = aimPano(view, [0, 0.00005], { support: "pole" }); // ~5.6 m
  assert.ok(close.y < far.y, "closer sign should need a higher view");
  assert.ok(far.y < 0.5, "a sign above the camera is above the horizon");
  assert.ok(close.y >= 0.5 - 30 / 180 - 1e-4, "pitch is capped at 30°"); // y is rounded to 4 dp
});

test("aimPano refuses flat photos and incomplete data", () => {
  assert.equal(aimPano({ lon: 0, lat: 0, compass: 0, pano: false }, [0, 1], {}), null);
  assert.equal(aimPano({ lon: 0, lat: 0, pano: true }, [0, 1], {}), null);
  assert.equal(aimPano(null, [0, 1], {}), null);
});

test("signHeightM prefers height=*, then location/support guesses", () => {
  near(signHeightM({ height: "10" }), 8, 1e-9);
  assert.equal(signHeightM({ location: "roof" }), 9);
  assert.equal(signHeightM({ support: "pole" }), 6);
  assert.equal(signHeightM({ support: "wall_mounted" }), 4);
  assert.equal(signHeightM({ height: "tall" }), 4.5);
});

test("withCenter appends x/y only when aimed", () => {
  assert.equal(withCenter("https://x/embed?image_key=1", null), "https://x/embed?image_key=1");
  assert.equal(withCenter("https://x/embed?image_key=1", { x: 0.8, y: 0.45 }), "https://x/embed?image_key=1&x=0.8&y=0.45");
});
