import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { overpassEndpoints } from "../scripts/lib/sources.mjs";

const KEYS = ["OVERPASS_URL", "OVERPASS_PRIMARY_URL", "OVERPASS_SECONDARY_URL"];

function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// An empty repo root, so no .overpass-url files are picked up from the real repo.
const root = mkdtempSync(join(tmpdir(), "neon-sources-"));

test("overpassEndpoints tries the primary, then the secondary, then public mirrors", () => {
  const eps = withEnv(
    { OVERPASS_PRIMARY_URL: "https://primary.example/api/interpreter", OVERPASS_SECONDARY_URL: "https://secondary.example/api/interpreter" },
    () => overpassEndpoints(root)
  );
  assert.deepEqual(
    eps.slice(0, 2).map((e) => [e.url, e.label, e.isPublic]),
    [
      ["https://primary.example/api/interpreter", "private Overpass", false],
      ["https://secondary.example/api/interpreter", "secondary private Overpass", false],
    ]
  );
  assert.ok(eps.slice(2).length > 0 && eps.slice(2).every((e) => e.isPublic));
});

test("overpassEndpoints works with only a secondary, and skips duplicates and malformed URLs", () => {
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  try {
    // A primary may also come from ~/.claude/.overpass-url, so only look at the secondary.
    const only = withEnv({ OVERPASS_SECONDARY_URL: "https://secondary.example/x" }, () => overpassEndpoints(root));
    assert.ok(only.some((e) => e.label === "secondary private Overpass" && !e.isPublic));

    const same = withEnv(
      { OVERPASS_PRIMARY_URL: "https://same.example/x", OVERPASS_SECONDARY_URL: "https://same.example/x" },
      () => overpassEndpoints(root)
    );
    assert.equal(same.filter((e) => e.url === "https://same.example/x").length, 1);

    const bad = withEnv({ OVERPASS_PRIMARY_URL: "https://p.example/x", OVERPASS_SECONDARY_URL: "not a url" }, () => overpassEndpoints(root));
    assert.ok(!bad.some((e) => e.label === "secondary private Overpass"));
    assert.ok(warnings.some((w) => /secondary private Overpass URL is malformed/.test(w)));
    assert.ok(!warnings.some((w) => w.includes("not a url")), "the URL itself is never logged");
  } finally {
    console.warn = warn;
  }
});
