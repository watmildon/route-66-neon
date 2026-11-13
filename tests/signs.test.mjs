import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NEON, isNeonSign, neonColour, signTitle, splitValues } from "../js/signs.js";

test("splitValues trims and drops empties", () => {
  assert.deepEqual(splitValues(" a; b ;;c "), ["a", "b", "c"]);
  assert.deepEqual(splitValues(undefined), []);
});

test("isNeonSign follows the project tagging", () => {
  assert.equal(isNeonSign({ advertising: "sign", luminous: "yes" }), true);
  assert.equal(isNeonSign({ advertising: "sign;letter_board", luminous: "yes" }), true);
  assert.equal(isNeonSign({ advertising: "sign", luminous: "neon" }), true);
  assert.equal(isNeonSign({ advertising: "Sign", luminous: "Yes" }), true);
});

test("isNeonSign rejects other signage", () => {
  assert.equal(isNeonSign({ advertising: "sign", luminous: "no" }), false);
  assert.equal(isNeonSign({ advertising: "sign" }), false);
  assert.equal(isNeonSign({ advertising: "billboard", luminous: "yes" }), false);
  assert.equal(isNeonSign({ advertising: "totem", luminous: "yes" }), false);
  assert.equal(isNeonSign({ advertising: "signpost", luminous: "yes" }), false);
  assert.equal(isNeonSign({}), false);
});

test("neonColour uses colour=* names and hex, else the default", () => {
  assert.equal(neonColour({ colour: "red" }), "#ff3b4e");
  assert.equal(neonColour({ colour: "Blue;red" }), "#3fa9ff");
  assert.equal(neonColour({ colour: "#00FF00" }), "#00ff00");
  assert.equal(neonColour({ colour: "mauve;green" }), "#3dff7a");
  assert.equal(neonColour({ colour: "javascript:alert(1)" }), DEFAULT_NEON);
  assert.equal(neonColour({}), DEFAULT_NEON);
});

test("signTitle prefers inscription, then name, then brand", () => {
  assert.equal(signTitle({ inscription: "MOTEL", name: "Blue Swallow" }), "MOTEL");
  assert.equal(signTitle({ name: "Blue Swallow" }), "Blue Swallow");
  assert.equal(signTitle({ brand: "Texaco" }), "Texaco");
  assert.equal(signTitle({}), "Neon sign");
});
