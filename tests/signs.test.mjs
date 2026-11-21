import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NEON, isNeonSign, neonColour, signLifecycle, signTitle, splitValues } from "../js/signs.js";

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

test("isNeonSign accepts billboards and light:method=neon", () => {
  assert.equal(isNeonSign({ advertising: "billboard", luminous: "yes" }), true);
  assert.equal(isNeonSign({ advertising: "billboard", luminous: "yes", "light:method": "neon" }), true);
  assert.equal(isNeonSign({ advertising: "sign", "light:method": "neon" }), true);
  assert.equal(isNeonSign({ advertising: "billboard", "light:method": "Neon" }), true);
  assert.equal(isNeonSign({ advertising: "sign", luminous: "yes", "light:method": "neon;LED" }), true);
});

test("isNeonSign leaves out signs whose light:method isn't neon", () => {
  assert.equal(isNeonSign({ advertising: "sign", luminous: "yes", "light:method": "led" }), false);
  assert.equal(isNeonSign({ advertising: "sign", luminous: "yes", "light:method": "electric" }), false);
  assert.equal(isNeonSign({ advertising: "sign", luminous: "neon", "light:method": "fluorescent" }), false);
  assert.equal(isNeonSign({ advertising: "sign", luminous: "yes", "disused:light:method": "LED" }), false);
  // The neon is still there (if broken) next to the new lighting.
  assert.equal(signLifecycle({ advertising: "sign", "light:method": "LED", "abandoned:light:method": "neon" }), "abandoned");
});

test("isNeonSign leaves out animated displays unless tagged neon", () => {
  assert.equal(isNeonSign({ advertising: "billboard", luminous: "yes", animated: "screen" }), false);
  assert.equal(isNeonSign({ advertising: "billboard", luminous: "yes", animated: "digital_display" }), false);
  assert.equal(isNeonSign({ advertising: "sign", luminous: "yes", animated: "yes" }), false);
  assert.equal(isNeonSign({ advertising: "sign", luminous: "yes", animated: "no" }), true);
  assert.equal(isNeonSign({ advertising: "sign", luminous: "yes", animated: "yes", "light:method": "neon" }), true);
});

test("isNeonSign rejects other signage", () => {
  assert.equal(isNeonSign({ advertising: "sign", luminous: "no" }), false);
  assert.equal(isNeonSign({ advertising: "sign" }), false);
  assert.equal(isNeonSign({ advertising: "billboard", luminous: "no" }), false);
  assert.equal(isNeonSign({ advertising: "sign", "light:method": "led" }), false);
  assert.equal(isNeonSign({ advertising: "sign", illuminated: "yes" }), false);
  assert.equal(isNeonSign({ advertising: "totem", luminous: "yes" }), false);
  assert.equal(isNeonSign({ advertising: "signpost", luminous: "yes" }), false);
  assert.equal(isNeonSign({}), false);
});

test("signLifecycle reads disused: and abandoned: prefixes, worst one wins", () => {
  assert.equal(signLifecycle({ advertising: "sign", "light:method": "neon" }), "active");
  assert.equal(signLifecycle({ "disused:advertising": "sign", "light:method": "neon" }), "disused");
  assert.equal(signLifecycle({ "disused:advertising": "sign", "disused:luminous": "yes" }), "disused");
  // The sign is fine but its neon is wrecked (node/14398830501, Budville).
  const budville = { advertising: "sign", "abandoned:light:method": "neon", "abandoned:luminous": "neon" };
  assert.equal(signLifecycle(budville), "abandoned");
  assert.ok(isNeonSign(budville));
  // Mixed stages: the worst one wins.
  assert.equal(signLifecycle({ advertising: "sign", luminous: "yes", "disused:light:method": "neon" }), "disused");
  assert.equal(signLifecycle({ "disused:advertising": "sign", "abandoned:light:method": "Neon" }), "abandoned");
  // The older bare forms.
  assert.equal(signLifecycle({ advertising: "sign", luminous: "yes", disused: "yes" }), "disused");
  assert.equal(signLifecycle({ advertising: "sign", luminous: "yes", abandoned: "yes" }), "abandoned");
  assert.equal(signLifecycle({ advertising: "sign", luminous: "yes", disused: "no" }), "active");
});

test("signLifecycle leaves out gone signs and other stages' non-neon tagging", () => {
  assert.equal(signLifecycle({ "demolished:advertising": "sign", "light:method": "neon" }), null);
  assert.equal(signLifecycle({ "was:advertising": "sign", "was:light:method": "neon" }), null);
  assert.equal(signLifecycle({ advertising: "sign", "removed:light:method": "neon" }), null);
  assert.equal(signLifecycle({ advertising: "sign", "disused:light:method": "led" }), null);
  assert.equal(signLifecycle({ "disused:advertising": "totem", "disused:luminous": "yes" }), null);
  assert.equal(signLifecycle({ advertising: "sign", "disused:luminous": "yes", animated: "screen" }), null);
  assert.equal(signLifecycle({ advertising: "sign", "abandoned:light:method": "neon", animated: "yes" }), "abandoned");
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
