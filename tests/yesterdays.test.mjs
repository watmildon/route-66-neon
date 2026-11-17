import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatEdtf,
  matchAimedNeon,
  matchGeoreferences,
  matchSubjects,
  nameTokens,
  signNames,
  signQids,
  subjectsNamingSigns,
  titleMatches,
  toEntry,
} from "../scripts/lib/yesterdays.mjs";

test("nameTokens keeps distinctive words only", () => {
  assert.deepEqual([...nameTokens("Roy's Vacancy Motel Cafe")], ["roy"]);
  assert.deepEqual([...nameTokens("Hill Top Motel Best View in Kingman")], ["hill", "top", "kingman"]);
  assert.deepEqual([...nameTokens("Piñon Motel")], ["pinon"]);
  assert.equal(nameTokens(undefined).size, 0);
});

test("titleMatches accepts the sign's own photos and rejects its neighbours", () => {
  // Real cases from the Route 66 survey: right sign, and other businesses on the same block.
  assert.ok(titleMatches(["Roy's Vacancy Motel Cafe"], "Roy's Motel sign, Route 66, Amboy, California"));
  assert.ok(titleMatches(["Hill Top Motel Best View in Kingman"], "Hill Top Motel, Louise and Chas. Picard owners, Douglas Smith photo"));
  assert.ok(titleMatches(["The Tropics Coffee Shop Dining Room Cocktail Lounge"], "The Tropics"));
  assert.ok(!titleMatches(["Turquoise Tepee"], "Hull's Motel, Tom Reed Photo"));
  assert.ok(!titleMatches(["El Rancho Motel Vacancy"], "Thunderbird Inn"));
  assert.ok(!titleMatches(["Rod's Steak House"], "El Coronado Motel"));
  // Words run together still name the sign (Yesterdays image 65949).
  assert.ok(titleMatches(["Blue Swallow Motel 100% Refrigerated Air"], "Blueswallow Motel sign, Tucumcari, New Mexico"));
  assert.ok(!titleMatches(["Blue Swallow Motel"], "Bluebird Motel, Swallowtail Road"));
  // A generic word alone is not a match.
  assert.ok(!titleMatches(["Motel"], "Hull's Motel"));
  assert.ok(!titleMatches([], "Anything"));
});

test("signNames and signQids read tags and wiki links", () => {
  const props = {
    tags: { inscription: "Blue Swallow Motel", wikidata: "Q1", "subject:wikidata": "Q2;Q3" },
    wiki: [{ qid: "Q4", label: "Blue Swallow Motel", source_name: "Blue Swallow" }, { qid: "Q1" }],
  };
  assert.deepEqual(signNames(props), ["Blue Swallow Motel", "Blue Swallow"]);
  assert.deepEqual(signQids(props), ["Q1", "Q2", "Q3", "Q4"]);
  assert.deepEqual(signQids({ tags: { wikidata: "not-a-qid" } }), []);
});

test("matchGeoreferences needs both nearness and a matching title", () => {
  const sign = [-115.7434, 34.5586];
  const g = (id, title, lon, lat) => ({ geometry: { coordinates: [lon, lat] }, properties: { image_id: id, image_title: title } });
  const georefs = [
    g(1, "Roy's Motel sign", -115.7435, 34.5587), // ~15 m, named
    g(2, "Roy's Cafe", -115.76, 34.5586), // ~1.5 km away
    g(3, "Amboy Crater", -115.7434, 34.5587), // near, not named
  ];
  assert.deepEqual(matchGeoreferences(sign, ["Roy's Vacancy Motel Cafe"], georefs), [1]);
});

test("matchAimedNeon takes neon sign photos taken close by and pointed at the sign", () => {
  const g = (id, lon, lat, direction) => ({ geometry: { coordinates: [lon, lat] }, properties: { image_id: id, image_title: "Untitled", direction } });
  // Yesterdays image 69041: untitled, subject "neon sign", 25 m from the
  // Santa Rosa sign reading only "Restaurant", 16° off the view direction.
  const restaurant = [-104.667625, 34.9452723];
  const georefs = [
    g(69041, -104.667455, 34.945097, 338),
    g(2, -104.667455, 34.945097, 158), // same spot, facing away
    g(3, -104.667455, 34.945097, undefined), // no direction
    g(4, -104.6685, 34.9452723, 90), // pointed at it, but ~95 m away
    g(5, -104.667455, 34.945097, 338), // aimed right, but not a neon sign photo
  ];
  assert.deepEqual(matchAimedNeon(restaurant, new Set([69041, 2, 3, 4]), georefs), [69041]);
  // Yesterdays image 55507 (Thunderbird Inn, Williams): the El Rancho sign is
  // 15 m from the camera but 59° off to the side.
  const elRancho = [-112.1813009, 35.252954];
  assert.deepEqual(matchAimedNeon(elRancho, new Set([55507]), [g(55507, -112.181151, 35.253006, 188)]), []);
  // A photo aimed at a cluster of signs goes to each of them.
  const cam = [-104.0, 35.0];
  const cluster = [g(7, ...cam, 0)];
  assert.deepEqual(matchAimedNeon([-104.0, 35.0003], new Set([7]), cluster), [7]); // ~33 m, dead ahead
  assert.deepEqual(matchAimedNeon([-103.99985, 35.0003], new Set([7]), cluster), [7]); // ~35 m, ~22° right
  // Bearing wraps through north.
  assert.deepEqual(matchAimedNeon([-104.0001, 35.0003], new Set([8]), [g(8, ...cam, 350)]), [8]);
});

test("subjects match a sign when they name it and Wikidata puts them at it", () => {
  const sign = [-103.71641, 35.17191]; // Blue Swallow sign, Tucumcari
  const names = ["Blue Swallow Motel 100% Refrigerated Air"];
  const subjects = [
    { qid: "Q4929937", title: "Blue Swallow Motel", wikidataTitle: "Blue Swallow Motel" },
    { qid: "Q1", title: "Tucumcari", wikidataTitle: "Tucumcari" }, // the town: near, but doesn't name the sign
    { qid: "Q2", title: "Blue Swallow Motel", wikidataTitle: "Blue Swallow Motel" }, // namesake far away
    { qid: "Q3", title: "Blue Swallow Diner", wikidataTitle: "" }, // no coordinates
  ];
  const coords = new Map([
    ["Q4929937", [-103.7163, 35.1722]], // ~40 m
    ["Q1", [-103.7166, 35.1719]],
    ["Q2", [-90.0, 38.0]],
  ]);
  assert.deepEqual(matchSubjects(sign, names, subjects, coords), ["Q4929937"]);
  assert.deepEqual(subjectsNamingSigns(subjects, [names, ["Kimo"]]).map((s) => s.qid), ["Q4929937", "Q2", "Q3"]);
});

test("formatEdtf turns EDTF into readable dates", () => {
  assert.equal(formatEdtf("[1926..1969]"), "1926–1969");
  assert.equal(formatEdtf("[..1960]"), "before 1960");
  assert.equal(formatEdtf("[1950..]"), "after 1950");
  assert.equal(formatEdtf("195X"), "1950s");
  assert.equal(formatEdtf("19XX"), "20th century");
  assert.equal(formatEdtf("1988"), "1988");
  assert.equal(formatEdtf("1938-05~"), "c. 1938-05");
  assert.equal(formatEdtf(""), null);
});

test("toEntry keeps what the viewer needs and drops unusable images", () => {
  const detail = {
    id: 53524,
    title: "Munger Moss Motel",
    thumbnail: "https://cdn.yesterdays.maprva.org/images/53524/1/thumbnail.webp",
    creator: null,
    license: { name: "No known copyright restrictions", display_name: "No known copyright restrictions", permalink: null },
    original_date: "undated",
    edtf_date: "[1926..1969]",
    date_display: "undated",
    collection: { name: "James R. Powell Route 66 Postcard Collection", source_name: "The Newberry Library" },
    original_url: "https://collections.newberry.org/asset-management/2KXJ8Z40CI9E",
    duplicate_of: null,
    georeferences: [{ latitude: 37.686, longitude: -92.6402, direction: 200 }],
  };
  assert.deepEqual(toEntry(detail), {
    id: 53524,
    title: "Munger Moss Motel",
    thumb: "https://cdn.yesterdays.maprva.org/images/53524/1/thumbnail.webp",
    page: "https://yesterdays.today/53524/",
    date: "1926–1969",
    source: "The Newberry Library",
    collection: "James R. Powell Route 66 Postcard Collection",
    license: "No known copyright restrictions",
    original: "https://collections.newberry.org/asset-management/2KXJ8Z40CI9E",
    camera: { lon: -92.6402, lat: 37.686, direction: 200 },
  });
  // Library of Congress records: no licence, no creator, a trailing period on the date.
  const loc = toEntry({ ...detail, license: null, creator: "", date_display: "1991.", original_url: "https://www.loc.gov/pictures/item/2017703549/" });
  assert.equal(loc.license, undefined);
  assert.equal(loc.creator, undefined);
  assert.equal(loc.date, "1991");
  assert.equal(loc.original, "https://www.loc.gov/pictures/item/2017703549/");
  assert.equal(toEntry({ ...detail, duplicate_of: 1 }), null);
  assert.equal(toEntry({ ...detail, thumbnail: "javascript:alert(1)" }), null);
  assert.equal(toEntry(null), null);
  assert.equal(toEntry({ ...detail, date_display: "1955" }).date, "1955");
});
