// Small planar-geometry helpers for lon/lat data at city-to-continent scale.
// Distances use a local equirectangular projection around the query point,
// which is accurate to well under 1% at the few-hundred-metre range we care
// about — plenty for "is this sign on Route 66?".

export const M_PER_DEG = 111_195; // mean Earth radius × π/180

/** Distance in metres from point p to segment a–b. Points are [lon, lat]. */
export function pointSegmentDistanceM(p, a, b) {
  const k = Math.cos((p[1] * Math.PI) / 180);
  const x1 = (a[0] - p[0]) * k, y1 = a[1] - p[1];
  const x2 = (b[0] - p[0]) * k, y2 = b[1] - p[1];
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? -(x1 * dx + y1 * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x1 + t * dx, y1 + t * dy) * M_PER_DEG;
}

/**
 * Join ways that meet end-to-end into longer lines. Only joins at points where
 * exactly two lines end, so junctions and forks stay as separate lines.
 */
export function mergeLines(lines) {
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const usable = lines.filter((l) => l.length >= 2);
  const ends = new Map();
  usable.forEach((l, i) => {
    for (const p of [l[0], l[l.length - 1]]) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });

  const used = new Uint8Array(usable.length);
  const extendTail = (chain) => {
    for (;;) {
      const k = key(chain[chain.length - 1]);
      const candidates = ends.get(k);
      if (!candidates || candidates.length !== 2) return;
      const next = candidates.find((i) => !used[i]);
      if (next === undefined) return;
      used[next] = 1;
      let l = usable[next];
      if (key(l[0]) !== k) l = [...l].reverse();
      for (let j = 1; j < l.length; j++) chain.push(l[j]);
    }
  };

  const out = [];
  for (let i = 0; i < usable.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const chain = [...usable[i]];
    extendTail(chain);
    chain.reverse();
    extendTail(chain);
    out.push(chain);
  }
  return out;
}

/** Douglas–Peucker. `tolM` is the max deviation in metres. Keeps endpoints. */
export function simplify(points, tolM) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegmentDistanceM(points[i], points[s], points[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Length of a line in metres. */
export function lineLengthM(line) {
  let m = 0;
  // A zero-length segment b–b makes this a plain point-to-point distance.
  for (let i = 1; i < line.length; i++) m += pointSegmentDistanceM(line[i - 1], line[i], line[i]);
  return m;
}

/** [west, south, east, north] of a set of lines. */
export function linesBounds(lines) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const line of lines) {
    for (const [x, y] of line) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

/** Grid-bucketed segments for fast "distance to the nearest route segment". */
export class SegmentIndex {
  constructor(lines, cellDeg = 0.05) {
    this.cell = cellDeg;
    this.grid = new Map();
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        const [cx0, cy0] = this.#cellOf(Math.min(a[0], b[0]), Math.min(a[1], b[1]));
        const [cx1, cy1] = this.#cellOf(Math.max(a[0], b[0]), Math.max(a[1], b[1]));
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cy = cy0; cy <= cy1; cy++) {
            const k = `${cx},${cy}`;
            if (!this.grid.has(k)) this.grid.set(k, []);
            this.grid.get(k).push([a, b]);
          }
        }
      }
    }
  }

  #cellOf(x, y) {
    return [Math.floor(x / this.cell), Math.floor(y / this.cell)];
  }

  /** Metres to the nearest segment, or Infinity if none is within maxM. */
  nearestM(p, maxM) {
    const dLat = maxM / M_PER_DEG;
    const dLon = maxM / (M_PER_DEG * Math.max(0.01, Math.cos((p[1] * Math.PI) / 180)));
    const [cx0, cy0] = this.#cellOf(p[0] - dLon, p[1] - dLat);
    const [cx1, cy1] = this.#cellOf(p[0] + dLon, p[1] + dLat);
    let best = Infinity;
    const seen = new Set();
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (const seg of this.grid.get(`${cx},${cy}`) || []) {
          if (seen.has(seg)) continue;
          seen.add(seg);
          const d = pointSegmentDistanceM(p, seg[0], seg[1]);
          if (d < best) best = d;
        }
      }
    }
    return best <= maxM ? best : Infinity;
  }
}

export const round = (n, dp) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
