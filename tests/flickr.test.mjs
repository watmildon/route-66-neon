import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { classifyImageValue, flickrPhotoId, flickrShortUrl, hasPhoto, imageSources } from "../js/images.js";
import { fetchFlickrPhoto, isStale, refreshFlickr, toEntry } from "../scripts/lib/flickr.mjs";

// The answer Flickr's oEmbed gave for the Blue Swallow photo (trimmed).
const OEMBED = {
  type: "photo",
  title: "The Blue Swallow Motel",
  author_name: "Jim_Nix",
  author_url: "https://www.flickr.com/photos/jimnix/",
  url: "https://live.staticflickr.com/4596/38510585425_ee0a908e8d_b.jpg",
  thumbnail_url: "https://live.staticflickr.com/4596/38510585425_ee0a908e8d_q.jpg",
  web_page: "https://www.flickr.com/photos/jimnix/38510585425/",
  license: "CC BY-NC-SA 2.0",
  license_id: "1",
  license_url: "https://creativecommons.org/licenses/by-nc-sa/2.0/",
};
const INFO = toEntry(OEMBED, "2026-11-17");

test("Flickr photo ids come from page URLs, flic.kr links and bare ids", () => {
  assert.equal(flickrPhotoId("https://www.flickr.com/photos/jimnix/38510585425"), "38510585425");
  assert.equal(flickrPhotoId("https://www.flickr.com/photos/146832554@N06/50154038121/in/dateposted-public/"), "50154038121");
  assert.equal(flickrPhotoId("http://m.flickr.com/photos/jimnix/38510585425"), "38510585425");
  assert.equal(flickrPhotoId("https://flic.kr/p/2jpWycc"), "50154038121");
  assert.equal(flickrPhotoId("38510585425", { bare: true }), "38510585425");
  assert.equal(flickrPhotoId("38510585425"), null, "bare ids only where asked for");
  // No single photo: albums, users, groups, look-alike hosts.
  for (const v of [
    "https://www.flickr.com/photos/jimnix/albums/72157626507954985",
    "https://www.flickr.com/photos/192048756",
    "https://flic.kr/s/aHBqjBBsaQ",
    "https://notflickr.com/photos/x/38510585425",
    "javascript:alert(1)",
  ]) {
    assert.equal(flickrPhotoId(v), null, v);
  }
});

test("flickrShortUrl round-trips with flic.kr decoding", () => {
  assert.equal(flickrShortUrl("50154038121"), "https://flic.kr/p/2jpWycc");
  for (const id of ["38510585425", "12345", "53929714514"]) assert.equal(flickrPhotoId(flickrShortUrl(id)), id);
});

test("flickr=* and Flickr links in image=* become one Flickr source", () => {
  const tags = {
    flickr: "https://www.flickr.com/photos/jimnix/38510585425",
    image: "https://flic.kr/p/" + flickrShortUrl("38510585425").split("/p/")[1],
    mapillary: "3464630433697572",
    wikimedia_commons: "File:Blue_Swallow_Motel_(15686053688).png",
  };
  const kinds = imageSources(tags).map((s) => `${s.kind}:${s.id}`);
  assert.deepEqual(kinds, ["commons:Blue Swallow Motel (15686053688).png", "flickr:38510585425", "mapillary:3464630433697572"]);
  // An album link isn't one photo: it stays a plain link.
  assert.equal(classifyImageValue("https://www.flickr.com/photos/jimnix/albums/1", "image").kind, "link");
  assert.equal(imageSources({ flickr: "https://www.flickr.com/photos/jimnix/albums/1" })[0].kind, "link");
});

test("a looked-up Flickr photo shows inline; All Rights Reserved or unknown ones are links", () => {
  const tags = { flickr: "https://www.flickr.com/photos/jimnix/38510585425" };
  const [shown] = imageSources(tags, { flickr: { 38510585425: INFO } });
  assert.equal(shown.src, OEMBED.url);
  assert.equal(shown.href, OEMBED.web_page);
  assert.ok(hasPhoto([shown]));

  const [reserved] = imageSources(tags, { flickr: { 38510585425: { ...INFO, license: "All Rights Reserved", license_id: 0 } } });
  assert.equal(reserved.src, null);
  assert.ok(!hasPhoto([reserved]));

  const [unknown] = imageSources(tags);
  assert.equal(unknown.src, null);
  assert.equal(unknown.href, "https://flic.kr/p/" + flickrShortUrl("38510585425").split("/p/")[1]);
});

test("All Rights Reserved Flickr photos sort after the sources that show a picture", () => {
  const tags = {
    flickr: "https://www.flickr.com/photos/jimnix/38510585425",
    "flickr:1": "https://www.flickr.com/photos/jimnix/38510585426",
    mapillary: "999",
    "image:2": "https://example.com/page.html",
  };
  const reserved = { ...INFO, license: "All Rights Reserved", license_id: 0 };
  const order = (info) => imageSources(tags, { flickr: info }).map((s) => `${s.kind}:${s.id}`);
  // The viewable Flickr photo stays ahead of Mapillary; the reserved one drops
  // behind it, still ahead of plain links.
  assert.deepEqual(order({ 38510585425: reserved, 38510585426: INFO }), [
    "flickr:38510585426",
    "mapillary:999",
    "flickr:38510585425",
    "link:https://example.com/page.html",
  ]);
  // Not looked up yet (a new tag before the next data run): keeps its place.
  assert.deepEqual(order({}), ["flickr:38510585425", "flickr:38510585426", "mapillary:999", "link:https://example.com/page.html"]);
});

test("toEntry keeps what the viewer needs and rejects off-site URLs", () => {
  assert.deepEqual(INFO, {
    page: OEMBED.web_page,
    src: OEMBED.url,
    thumb: OEMBED.thumbnail_url,
    title: "The Blue Swallow Motel",
    author: "Jim_Nix",
    author_url: OEMBED.author_url,
    license: "CC BY-NC-SA 2.0",
    license_id: 1,
    license_url: OEMBED.license_url,
    checked: "2026-11-17",
  });
  assert.equal(toEntry({ ...OEMBED, url: "https://evil.example/x.jpg" }, "d"), null);
  assert.equal(toEntry({ ...OEMBED, type: "video" }, "d"), null);
  assert.equal(toEntry({ ...OEMBED, license_url: "javascript:x" }, "d").license_url, undefined);
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const reply = (body, status = 200) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

test("fetchFlickrPhoto asks oEmbed by short link and reads the answer", async () => {
  let asked;
  globalThis.fetch = async (url) => {
    asked = new URL(url);
    return reply(OEMBED)();
  };
  const r = await fetchFlickrPhoto("38510585425", "2026-11-17");
  assert.equal(asked.origin + asked.pathname, "https://www.flickr.com/services/oembed/");
  assert.equal(asked.searchParams.get("url"), flickrShortUrl("38510585425"));
  assert.equal(r.status, "ok");
  assert.deepEqual(r.entry, INFO);
  globalThis.fetch = reply("<html>not found</html>", 404);
  assert.deepEqual(await fetchFlickrPhoto("1", "d"), { status: "gone" });
  globalThis.fetch = reply("oops", 500);
  assert.equal((await fetchFlickrPhoto("1", "d")).status, "error");
});

test("refreshFlickr reuses fresh entries, rechecks stale ones, drops gone ones and keeps old ones on errors", async () => {
  assert.ok(!isStale({ checked: "2026-11-01" }, "2026-11-17"));
  assert.ok(isStale({ checked: "2026-10-01" }, "2026-11-17"));
  assert.ok(isStale({}, "2026-11-17"));

  const fresh = { ...INFO, checked: "2026-11-10" };
  const stale = { ...INFO, checked: "2026-01-01", title: "old" };
  const known = new Map([["1", fresh], ["2", stale], ["3", stale], ["4", stale]]);
  const asked = [];
  globalThis.fetch = async (url) => {
    const id = flickrPhotoId(new URL(url).searchParams.get("url"));
    asked.push(id);
    if (id === "2") return reply(OEMBED)();
    if (id === "3") return reply("gone", 404)();
    return reply("busy", 503)();
  };
  const r = await refreshFlickr(["1", "2", "3", "4"], known, "2026-11-17");
  assert.deepEqual(asked, ["2", "3", "4"]);
  assert.equal(r.entries.get("1"), fresh);
  assert.equal(r.entries.get("2").checked, "2026-11-17");
  assert.ok(!r.entries.has("3"));
  assert.equal(r.entries.get("4"), stale);
  assert.deepEqual([r.looked, r.gone, r.failed], [3, 1, 1]);
});
