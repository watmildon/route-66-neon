import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyImageValue,
  commonsCategoryUrl,
  commonsCredit,
  commonsInfoUrl,
  GALLERY_LIMIT,
  hasPhoto,
  htmlToText,
  imageSources,
  parseCategoryFiles,
  parseCommonsInfo,
} from "../js/images.js";

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

test("wikimedia_commons File: values become Commons sources; categories become galleries", () => {
  const [s] = imageSources({ wikimedia_commons: "File:Blue Swallow Motel.jpg" });
  assert.equal(s.kind, "commons");
  assert.equal(s.src, "https://commons.wikimedia.org/wiki/Special:FilePath/Blue_Swallow_Motel.jpg?width=1024");
  const [g] = imageSources({ wikimedia_commons: "Category:Meadow_Gold_sign" });
  assert.equal(g.kind, "gallery");
  assert.equal(g.id, "Meadow Gold sign");
  assert.equal(g.label, "Gallery");
  assert.equal(g.href, "https://commons.wikimedia.org/wiki/Category:Meadow_Gold_sign");
});

test("Commons category links in image=* become galleries too", () => {
  assert.equal(classifyImageValue("https://commons.wikimedia.org/wiki/Category:Tewa_Lodge").kind, "gallery");
  assert.equal(classifyImageValue("Category:Tewa Lodge").id, "Tewa Lodge");
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

test("sources are ordered Commons, gallery, Mapillary, Panoramax, URL, link and de-duplicated", () => {
  const tags = {
    image: "https://example.com/a.jpg",
    "image:1": "https://www.mapillary.com/app/?pKey=999",
    mapillary: "999",
    wikimedia_commons: "File:X.jpg",
    "wikimedia_commons:1": "Category:X",
    panoramax: "6dac9d0d-654d-478d-a4cb-f30152720b29",
    "image:2": "https://example.com/page.html",
  };
  assert.deepEqual(
    imageSources(tags).map((s) => s.kind),
    ["commons", "gallery", "mapillary", "panoramax", "url", "link"]
  );
});

test("Commons API URLs ask anonymously for credits and thumbnails", () => {
  const info = new URL(commonsInfoUrl("File:Blue Swallow Motel.jpg"));
  assert.equal(info.origin + info.pathname, "https://commons.wikimedia.org/w/api.php");
  assert.equal(info.searchParams.get("origin"), "*");
  assert.equal(info.searchParams.get("titles"), "File:Blue Swallow Motel.jpg");
  assert.match(info.searchParams.get("iiextmetadatafilter"), /Artist/);
  const cat = new URL(commonsCategoryUrl("Category:Meadow Gold sign"));
  assert.equal(cat.searchParams.get("gcmtitle"), "Category:Meadow Gold sign");
  assert.equal(cat.searchParams.get("gcmtype"), "file");
  assert.equal(cat.searchParams.get("gcmlimit"), String(GALLERY_LIMIT));
});

test("htmlToText strips tags and decodes entities", () => {
  assert.equal(
    htmlToText('<a href="//commons.wikimedia.org/wiki/User:Jo" title="User:Jo">Jo&nbsp;Smith</a> &amp; <bdi>Ana</bdi>'),
    "Jo Smith & Ana"
  );
  assert.equal(htmlToText("Caf&#233; &#x2014; ok"), "Café — ok");
  assert.equal(htmlToText(undefined), "");
});

test("commonsCredit reads author and licence, keeping only http(s) licence links", () => {
  const meta = {
    Artist: { value: '<a href="https://www.flickr.com/people/x">Doug Kerr</a>' },
    LicenseShortName: { value: "CC BY-SA 2.0" },
    LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/2.0" },
  };
  assert.deepEqual(commonsCredit(meta), {
    author: "Doug Kerr",
    license: "CC BY-SA 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0",
  });
  assert.equal(commonsCredit({ LicenseUrl: { value: "//creativecommons.org/publicdomain/zero/1.0/" } }).licenseUrl,
    "https://creativecommons.org/publicdomain/zero/1.0/");
  assert.equal(commonsCredit({ LicenseUrl: { value: "javascript:alert(1)" } }).licenseUrl, null);
  assert.deepEqual(commonsCredit(undefined), { author: null, license: null, licenseUrl: null });
  assert.equal(commonsCredit({ Artist: { value: "x".repeat(300) } }).author.length, 118);
});

test("parseCommonsInfo and parseCategoryFiles read API answers", () => {
  const meta = { Artist: { value: "Ana" }, LicenseShortName: { value: "CC0" } };
  assert.equal(parseCommonsInfo({ query: { pages: [{ imageinfo: [{ extmetadata: meta }] }] } }).author, "Ana");
  assert.equal(parseCommonsInfo({}).author, null);

  const { items, more } = parseCategoryFiles({
    continue: { gcmcontinue: "x" },
    query: {
      pages: [
        { ns: 6, title: "File:B sign.jpg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/b-320.jpg", extmetadata: meta }] },
        { ns: 6, title: "File:A sign.jpg", imageinfo: [{ extmetadata: {} }] },
        { ns: 6, title: "File:No info.jpg" },
        { ns: 14, title: "Category:Sub", imageinfo: [{}] },
      ],
    },
  });
  assert.equal(more, true);
  assert.deepEqual(items.map((i) => i.file.id), ["A sign.jpg", "B sign.jpg"]);
  assert.equal(items[1].thumb, "https://upload.wikimedia.org/b-320.jpg");
  assert.equal(items[0].thumb, "https://commons.wikimedia.org/wiki/Special:FilePath/A_sign.jpg?width=320");
  assert.equal(items[1].credit.author, "Ana");
  assert.equal(parseCategoryFiles({}).items.length, 0);
});

test("unrelated keys that merely start with image/mapillary are not read", () => {
  assert.deepEqual(kinds({ "mapillary:highway": "123", "image:caption": "https://example.com/a.jpg" }), []);
});

test("hasPhoto is false when only links exist", () => {
  assert.equal(hasPhoto(imageSources({ image: "https://example.com/page" })), false);
  assert.equal(hasPhoto(imageSources({ mapillary: "1" })), true);
  assert.equal(hasPhoto([]), false);
});
