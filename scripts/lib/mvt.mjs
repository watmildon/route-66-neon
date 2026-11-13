// Minimal Mapbox Vector Tile decoder — just enough to read point features and
// their properties (what Mapillary's coverage `image` layer contains), so the
// pipeline needs no npm dependencies. Spec: github.com/mapbox/vector-tile-spec

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  get done() {
    return this.pos >= this.buf.length;
  }
  // Varints here stay below 2^53 (feature ids, lengths), so plain Number
  // arithmetic is exact; bit shifts would truncate to 32 bits.
  varint() {
    let result = 0, mul = 1, b;
    do {
      b = this.buf[this.pos++];
      result += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return result;
  }
  zigzag() {
    const n = this.varint();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }
  bytes() {
    const len = this.varint();
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  skip(wireType) {
    if (wireType === 0) this.varint();
    else if (wireType === 1) this.pos += 8;
    else if (wireType === 2) this.pos += this.varint();
    else if (wireType === 5) this.pos += 4;
    else throw new Error(`Unsupported protobuf wire type ${wireType}`);
  }
  *fields() {
    while (!this.done) {
      const tag = this.varint();
      yield [tag >> 3, tag & 7];
    }
  }
}

const utf8 = new TextDecoder();

function packed(bytes) {
  const r = new Reader(bytes);
  const out = [];
  while (!r.done) out.push(r.varint());
  return out;
}

function decodeValue(bytes) {
  const r = new Reader(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let value = null;
  for (const [field, wire] of r.fields()) {
    if (field === 1) value = utf8.decode(r.bytes());
    else if (field === 2) { value = view.getFloat32(r.pos, true); r.pos += 4; }
    else if (field === 3) { value = view.getFloat64(r.pos, true); r.pos += 8; }
    else if (field === 4 || field === 5) value = r.varint();
    else if (field === 6) value = r.zigzag();
    else if (field === 7) value = r.varint() === 1;
    else r.skip(wire);
  }
  return value;
}

/** First point of a feature's geometry, in tile pixel coordinates. */
function firstPoint(commands) {
  if (commands.length < 3) return null;
  const cmd = commands[0] & 7;
  if (cmd !== 1) return null; // MoveTo
  const z = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);
  return [z(commands[1]), z(commands[2])];
}

function decodeLayer(bytes) {
  const r = new Reader(bytes);
  const layer = { name: "", extent: 4096, keys: [], values: [], raw: [] };
  for (const [field, wire] of r.fields()) {
    if (field === 1) layer.name = utf8.decode(r.bytes());
    else if (field === 2) layer.raw.push(r.bytes());
    else if (field === 3) layer.keys.push(utf8.decode(r.bytes()));
    else if (field === 4) layer.values.push(decodeValue(r.bytes()));
    else if (field === 5) layer.extent = r.varint();
    else r.skip(wire);
  }
  layer.features = layer.raw.map((fb) => {
    const fr = new Reader(fb);
    const f = { id: null, type: 0, properties: {}, point: null };
    let tags = [], geom = [];
    for (const [field, wire] of fr.fields()) {
      if (field === 1) f.id = fr.varint();
      else if (field === 2) tags = packed(fr.bytes());
      else if (field === 3) f.type = fr.varint();
      else if (field === 4) geom = packed(fr.bytes());
      else fr.skip(wire);
    }
    for (let i = 0; i + 1 < tags.length; i += 2) f.properties[layer.keys[tags[i]]] = layer.values[tags[i + 1]];
    if (f.type === 1) f.point = firstPoint(geom);
    return f;
  });
  delete layer.raw;
  return layer;
}

/** Decode a tile buffer into { layerName: { extent, features: [{id, type, properties, point}] } }. */
export function decodeTile(buf) {
  const r = new Reader(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  const layers = {};
  for (const [field, wire] of r.fields()) {
    if (field === 3) {
      const layer = decodeLayer(r.bytes());
      layers[layer.name] = layer;
    } else r.skip(wire);
  }
  return layers;
}

// ------------------------------------------------------------- tile maths --

export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y, z };
}

/** Tile pixel (origin top-left, y down) → [lon, lat]. */
export function tilePixelToLonLat(tile, px, py, extent) {
  const n = 2 ** tile.z;
  const tx = tile.x + px / extent;
  const ty = tile.y + py / extent;
  const lon = (tx / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return [lon, lat];
}
