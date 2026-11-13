import { test } from "node:test";
import assert from "node:assert/strict";
import { namesMatch, nameTokens, parseWikipedia, pickWikiLinks, toEntry } from "../scripts/lib/wiki.mjs";

test("nameTokens drops generic words, numbers and accents", () => {
  assert.deepEqual(nameTokens("Blue Swallow Motel 100% Refrigerated Air"), ["blue", "swallow"]);
  assert.deepEqual(nameTokens("Piñon Motel Vacancy"), ["pinon"]);
  assert.deepEqual(nameTokens("MOTEL"), []);
});

test("namesMatch: the sign's words and the place's name agree", () => {
  // Real pairs from Route 66 data.
  assert.ok(namesMatch("HILAND", "Hiland Theater"));
  assert.ok(namesMatch("Guild", "The Guild Cinema"));
  assert.ok(namesMatch("Blue Swallow Motel 100% Refrigerated Air", "Blue Swallow Motel"));
  assert.ok(namesMatch("De Anza Motor Lodge", "De Anza Motor Lodge"));
});

test("namesMatch: nearby but unrelated places don't match", () => {
  assert.ok(!namesMatch('Motel Hiway House "Sleep Is Our Business"', "Jones Motor Company"));
  assert.ok(!namesMatch("Clowndog Hot Dog Parlor", "Immanuel Presbyterian Church"));
  assert.ok(!namesMatch("COMICS", "Lobo Theater"));
  assert.ok(!namesMatch("Motel", "Blue Swallow Motel")); // nothing distinctive to match on
  assert.ok(!namesMatch("66", "Route 66 Diner"));
});

test("parseWikipedia splits language and title", () => {
  assert.deepEqual(parseWikipedia("en:Blue Swallow Motel"), { lang: "en", title: "Blue Swallow Motel" });
  assert.equal(parseWikipedia("Blue Swallow Motel"), null);
  assert.equal(parseWikipedia(""), null);
});

const sign = (tags, lon = -103.7244, lat = 35.1716) => ({ type: "node", id: 1, lon, lat, tags });
const place = (id, name, tags, lon = -103.7244, lat = 35.1717) => ({
  type: "way", id, lon, lat, tags: { name, ...tags },
});

test("pickWikiLinks uses the sign's own tags first", () => {
  const links = pickWikiLinks(sign({ inscription: "Munger Moss Motel", wikidata: "Q6936003", wikipedia: "en:Munger-Moss Motel" }), []);
  assert.deepEqual(links, [{ qid: "Q6936003", wikipedia: "en:Munger-Moss Motel", source: "self", sourceName: null }]);
});

test("pickWikiLinks adds the closest matching place and skips duplicates", () => {
  const s = sign({ inscription: "Blue Swallow Motel 100% Refrigerated Air" });
  const links = pickWikiLinks(s, [
    place(2, "Blue Swallow Motel", { wikidata: "Q4929937", wikipedia: "en:Blue Swallow Motel" }),
    place(3, "Blue Swallow Motel", { wikidata: "Q999" }, -103.7244, 35.1725), // farther (~100 m)
    place(4, "Tucumcari", { wikidata: "Q1" }), // close but different name
  ]);
  assert.deepEqual(links, [
    { qid: "Q4929937", wikipedia: "en:Blue Swallow Motel", source: "way/2", sourceName: "Blue Swallow Motel" },
  ]);

  const both = pickWikiLinks(sign({ inscription: "Munger Moss Motel", wikidata: "Q6936003" }), [
    place(5, "Munger Moss Motel", { wikidata: "Q6936003" }),
  ]);
  assert.equal(both.length, 1, "the place's link duplicates the sign's own");
});

test("pickWikiLinks ignores matching places beyond 150 m", () => {
  const links = pickWikiLinks(sign({ inscription: "Bobcat Bite" }), [
    place(6, "Bobcat Bite", { wikidata: "Q4935779" }, -103.7244, 35.1735), // ~210 m
  ]);
  assert.deepEqual(links, []);
});

test("toEntry prefers the mapper's wikipedia=* over Wikidata's enwiki and keeps a stable shape", () => {
  const e = toEntry(
    { qid: "Q1", wikipedia: "de:Etwas", source: "way/2", sourceName: "Place" },
    { label: "Thing", description: "a thing", wikipedia: "en:Thing", image: "Thing.jpg" }
  );
  assert.deepEqual(Object.keys(e), ["qid", "label", "description", "wikipedia", "image", "source", "source_name"]);
  assert.equal(e.wikipedia, "de:Etwas");
  // Without Wikidata details, fall back to the article title or the place name.
  assert.equal(toEntry({ qid: null, wikipedia: "en:Foo Bar", source: "self" }).label, "Foo Bar");
  assert.equal(toEntry({ qid: "Q2", wikipedia: null, source: "way/3", sourceName: "Diner" }).label, "Diner");
});
