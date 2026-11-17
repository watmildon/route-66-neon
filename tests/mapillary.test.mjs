import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { lookupComputedCompass } from "../scripts/lib/mapillary.mjs";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const reply = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });

test("lookupComputedCompass returns aligned headings, normalised to [0, 360)", async () => {
  let auth;
  globalThis.fetch = async (url, opts) => {
    auth = opts.headers.Authorization;
    assert.ok(!String(url).includes("secret"), "token stays out of the URL");
    return reply({ data: [{ id: "1", computed_compass_angle: 5.06 }, { id: "2", computed_compass_angle: -10 }, { id: "3" }] })();
  };
  const got = await lookupComputedCompass(["1", "2", "3"], "secret");
  assert.equal(auth, "OAuth secret");
  assert.deepEqual([...got], [["1", 5.1], ["2", 350]]);
});

test("lookupComputedCompass returns null when the token can't read the Graph API", async () => {
  // A tiles-only token gets 200 with an empty list for public photos.
  globalThis.fetch = reply({ data: [] });
  assert.equal(await lookupComputedCompass(["1"], "t"), null);
  globalThis.fetch = reply({ error: {} }, 403);
  assert.equal(await lookupComputedCompass(["1"], "t"), null);
});
