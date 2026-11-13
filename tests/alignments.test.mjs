import { test } from "node:test";
import assert from "node:assert/strict";
import { EXTRA_RELATIONS, isFormerUS66 } from "../scripts/lib/alignments.mjs";

test("isFormerUS66 accepts the ways former US 66 is written in old_ref", () => {
  for (const v of [
    "US 66",
    "U.S. 66",
    "US-66",
    "Route 66",
    "AZ 66",
    "RT 66",
    "US 66;US 99",
    "US 50;US 66",
    "US 66 Business",
    "Loop 552 (old US 66)",
    "NM 284 (old US 66;US 85)",
    "US 66 Alternate;SR 134 (old US 66)",
  ]) {
    assert.ok(isFormerUS66(v), v);
  }
});

test("isFormerUS66 rejects other roads numbered 66", () => {
  for (const v of [undefined, "", "US 166", "US 666", "I 660", "CO 66", "SR 66", "US 666 (old US 66 (old NM 789))", "MO 266"]) {
    assert.ok(!isFormerUS66(v), String(v));
  }
});

test("every extra relation has hover text", () => {
  for (const [id, r] of Object.entries(EXTRA_RELATIONS)) {
    assert.match(id, /^\d+$/);
    assert.ok(r.label && r.note, id);
  }
});
