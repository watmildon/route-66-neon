import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyImageValue, hasPhoto, imageSources } from "../js/images.js";

const kinds = (tags) => imageSources(tags).map((s) => `${s.kind}:${s.id}`);

test("mapillary=* IDs become Mapillary sources", () => {
  const [s] = imageSources({ mapillary: "1379075506891035" });
  assert.equal(s.kind, "mapillary");
  assert.equal(s.id, "1379075506891035");
  assert.match(s.embed, /image_key=1379075506891035/);
  assert.match(s.href, /pKey=1379075506891035/);
});

test("multi-valued and numbered keys are all picked up, in order", () => {
  assert.deepEqual(kinds({ mapillary: "111;222", "mapillary:1": "333" }), [
    "mapillary:111",
    "mapillary:222",
    "mapillary:333",
  ]);
});

test("non-numeric legacy Mapillary keys are ignored", () => {
  assert.deepEqual(kinds({ mapillary: "aBcD1234efGH5678ijKL90" }), []);
});

test("panoramax=* UUIDs resolve through the meta-catalogue", () => {
  const [s] = imageSources({ panoramax: "6DAC9D0D-654D-478D-A4CB-F30152720B29" });
  assert.equal(s.kind, "panoramax");
  assert.equal(s.src, "https://api.panoramax.xyz/api/pictures/6dac9d0d-654d-478d-a4cb-f30152720b29/sd.jpg");
});

test("wikimedia_commons File: values become Commons sources; categories are skipped", () => {
  const [s] = imageSources({ wikimedia_commons: "File:Blue Swallow Motel.jpg" });
  assert.equal(s.kind, "commons");
  assert.equal(s.src, "https://commons.wikimedia.org/wiki/Special:FilePath/Blue_Swallow_Motel.jpg?width=1024");
  assert.deepEqual(kinds({ wikimedia_commons: "Category:Neon signs" }), []);
});

test("image=* URLs are classified by host", () => {
  assert.equal(classifyImageValue("https://commons.wikimedia.org/wiki/File:Foo_bar.jpg").kind, "commons");
  assert.equal(classifyImageValue("https://commons.wikimedia.org/wiki/File:Foo_bar.jpg").id, "Foo bar.jpg");
  assert.equal(classifyImageValue("https://www.mapillary.com/app/?pKey=123&focus=photo").id, "123");
  assert.equal(classifyImageValue("https://www.mapillary.com/map/im/456").id, "456");
  assert.equal(
    classifyImageValue("https://panoramax.openstreetmap.fr/#focus=pic&pic=6dac9d0d-654d-478d-a4cb-f30152720b29").kind,
    "panoramax"
  );
  assert.equal(classifyImageValue("https://example.com/neon.JPG").kind, "url");
  assert.equal(classifyImageValue("https://www.flickr.com/gp/190390436@N05/2QX7ZF").kind, "link");
  assert.equal(classifyImageValue("File:Route 66 sign.png").kind, "commons");
});

test("unsafe or junk image values are dropped", () => {
  assert.equal(classifyImageValue("javascript:alert(1)"), null);
  assert.equal(classifyImageValue("data:image/png;base64,AAAA"), null);
  assert.equal(classifyImageValue("not a url"), null);
  assert.equal(classifyImageValue(""), null);
});

test("sources are ordered Mapillary, Panoramax, Commons, URL, link and de-duplicated", () => {
  const tags = {
    image: "https://example.com/a.jpg",
    "image:1": "https://www.mapillary.com/app/?pKey=999",
    mapillary: "999",
    wikimedia_commons: "File:X.jpg",
    panoramax: "6dac9d0d-654d-478d-a4cb-f30152720b29",
    "image:2": "https://example.com/page.html",
  };
  assert.deepEqual(
    imageSources(tags).map((s) => s.kind),
    ["mapillary", "panoramax", "commons", "url", "link"]
  );
});

test("unrelated keys that merely start with image/mapillary are not read", () => {
  assert.deepEqual(kinds({ "mapillary:highway": "123", "image:caption": "https://example.com/a.jpg" }), []);
});

test("hasPhoto is false when only links exist", () => {
  assert.equal(hasPhoto(imageSources({ image: "https://example.com/page" })), false);
  assert.equal(hasPhoto(imageSources({ mapillary: "1" })), true);
  assert.equal(hasPhoto([]), false);
});
