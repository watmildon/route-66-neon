import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeTile, lonLatToTile, tilePixelToLonLat } from "../scripts/lib/mvt.mjs";

// --- a tiny protobuf encoder, just enough to build a test tile ---------------
const varint = (n) => {
  const out = [];
  while (n >= 128) {
    out.push((n % 128) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const zz = (n) => (n >= 0 ? n * 2 : -n * 2 - 1);
const key = (field, wire) => varint(field * 8 + wire);
const bytesField = (field, bytes) => [...key(field, 2), ...varint(bytes.length), ...bytes];
const str = (field, s) => bytesField(field, [...new TextEncoder().encode(s)]);
const uintField = (field, n) => [...key(field, 0), ...varint(n)];
const doubleField = (field, d) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, d, true);
  return [...key(field, 1), ...b];
};
const boolField = (field, v) => [...key(field, 0), v ? 1 : 0];

function buildTile() {
  const keys = ["id", "compass_angle", "is_pano", "captured_at"];
  const values = [
    uintField(5, 1379075506891035), // uint id > 2^32
    doubleField(3, 90.6),
    boolField(7, true),
    uintField(5, 1781827200000),
  ];
  const tags = [0, 0, 1, 1, 2, 2, 3, 3];
  const geometry = [(1 & 7) | (1 << 3), zz(1024), zz(3072)]; // MoveTo(1) at (1024, 3072)
  const feature = [
    ...uintField(1, 7),
    ...bytesField(2, tags.flatMap(varint)),
    ...uintField(3, 1), // POINT
    ...bytesField(4, geometry.flatMap(varint)),
  ];
  const layer = [
    ...uintField(15, 2),
    ...str(1, "image"),
    ...bytesField(2, feature),
    ...keys.flatMap((k) => str(3, k)),
    ...values.flatMap((v) => bytesField(4, v)),
    ...uintField(5, 4096),
  ];
  return new Uint8Array(bytesField(3, layer));
}

test("decodeTile reads point features and typed properties", () => {
  const { image } = decodeTile(buildTile());
  assert.equal(image.extent, 4096);
  assert.equal(image.features.length, 1);
  const f = image.features[0];
  assert.equal(f.id, 7);
  assert.equal(f.type, 1);
  assert.deepEqual(f.point, [1024, 3072]);
  assert.equal(f.properties.id, 1379075506891035);
  assert.equal(f.properties.compass_angle, 90.6);
  assert.equal(f.properties.is_pano, true);
  assert.equal(f.properties.captured_at, 1781827200000);
});

test("tile maths round-trips a coordinate", () => {
  const lon = -95.9751866, lat = 36.1476554;
  const t = lonLatToTile(lon, lat, 14);
  assert.deepEqual([t.x, t.y], [3824, 6425]); // same tile mercantile gives
  const [tlLon, tlLat] = tilePixelToLonLat(t, 0, 0, 4096);
  const [brLon, brLat] = tilePixelToLonLat(t, 4096, 4096, 4096);
  assert.ok(tlLon <= lon && lon < brLon, "lon inside tile");
  assert.ok(brLat < lat && lat <= tlLat, "lat inside tile (y grows southward)");
});
