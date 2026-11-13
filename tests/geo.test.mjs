import { test } from "node:test";
import assert from "node:assert/strict";
import { lineLengthM, mergeLines, pointSegmentDistanceM, SegmentIndex, simplify } from "../scripts/lib/geo.mjs";

const near = (actual, expected, tol) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} not within ${tol} of ${expected}`);

test("pointSegmentDistanceM measures perpendicular and endpoint distances", () => {
  // 0.001° of latitude ≈ 111 m
  near(pointSegmentDistanceM([0, 0.001], [-1, 0], [1, 0]), 111.2, 0.5);
  // Beyond the segment end: distance to the endpoint
  near(pointSegmentDistanceM([2, 0], [-1, 0], [1, 0]), 111_195, 1);
  // Longitude shrinks with latitude: 0.001° lon at 60°N ≈ 55.6 m
  near(pointSegmentDistanceM([0.001, 60], [0, 59], [0, 61]), 55.6, 0.5);
});

test("lineLengthM sums segment lengths", () => {
  near(lineLengthM([[0, 0], [0, 1], [0, 2]]), 2 * 111_195, 1);
});

test("mergeLines joins ways end-to-end, flipping reversed ones", () => {
  const merged = mergeLines([
    [[0, 0], [1, 0]],
    [[2, 0], [1, 0]], // reversed relative to the first
    [[2, 0], [3, 0]],
  ]);
  assert.equal(merged.length, 1);
  const xs = merged[0].map((p) => p[0]);
  assert.ok(
    JSON.stringify(xs) === "[0,1,2,3]" || JSON.stringify(xs) === "[3,2,1,0]",
    `unexpected order ${xs}`
  );
});

test("mergeLines does not join through a three-way junction", () => {
  const merged = mergeLines([
    [[0, 0], [1, 0]],
    [[1, 0], [2, 0]],
    [[1, 0], [1, 1]],
  ]);
  assert.equal(merged.length, 3);
});

test("mergeLines drops degenerate single-point lines", () => {
  assert.equal(mergeLines([[[0, 0]], [[0, 0], [1, 1]]]).length, 1);
});

test("simplify removes near-collinear points and keeps endpoints", () => {
  const line = [[0, 0], [0.5, 0.00001], [1, 0]]; // middle point is ~1 m off
  assert.deepEqual(simplify(line, 5), [[0, 0], [1, 0]]);
  const bent = [[0, 0], [0.5, 0.01], [1, 0]]; // ~1.1 km off
  assert.equal(simplify(bent, 5).length, 3);
});

test("SegmentIndex.nearestM matches a brute-force search", () => {
  const lines = [
    [[-100, 35], [-99.9, 35.05], [-99.8, 35]],
    [[-99.5, 35.2], [-99.4, 35.2]],
  ];
  const index = new SegmentIndex(lines);
  const brute = (p) => {
    let best = Infinity;
    for (const l of lines) for (let i = 1; i < l.length; i++) best = Math.min(best, pointSegmentDistanceM(p, l[i - 1], l[i]));
    return best;
  };
  for (const p of [[-99.95, 35.02], [-99.45, 35.201], [-99.8, 35.001]]) {
    near(index.nearestM(p, 5000), brute(p), 1e-6);
  }
  assert.equal(index.nearestM([-90, 40], 400), Infinity);
});
