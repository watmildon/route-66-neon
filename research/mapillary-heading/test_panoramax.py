"""Try flow.py on public Panoramax 360° sequences (no token needed).

    python -I test_panoramax.py <bbox w,s,e,n> <download dir> [max sequences] [pairs per sequence]

For each 360° sequence in the box, takes consecutive photo pairs, measures the
forward column, and prints it next to Panoramax's own view:azimuth relative to
the GPS direction of travel. A fixed camera should give the same answer for
every pair in a sequence.
"""

import json
import math
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flow import forward_direction, passes, vote  # noqa: E402

API = "https://api.panoramax.xyz/api"
UA = {"User-Agent": "route-66-neon research (heading check)"}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def fetch(url, dest: Path):
    if not dest.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
            dest.write_bytes(r.read())
    return dest


def bearing(a, b):
    (lon1, lat1), (lon2, lat2) = a, b
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return math.degrees(math.atan2(y, x)) % 360


def dist(a, b):
    (lon1, lat1), (lon2, lat2) = a, b
    k = math.cos(math.radians((lat1 + lat2) / 2))
    return 111_320 * math.hypot((lon2 - lon1) * k, lat2 - lat1)


def wrap(d):
    return (d + 180) % 360 - 180


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    bbox, out = sys.argv[1], Path(sys.argv[2])
    max_seq = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    per_seq = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    out.mkdir(parents=True, exist_ok=True)
    found = get_json(f"{API}/search?bbox={bbox}&limit=500")["features"]
    seqs = defaultdict(int)
    for f in found:
        if f["properties"].get("pers:interior_orientation", {}).get("field_of_view") == 360:
            seqs[f["collection"]] += 1
    seen, tally = set(), defaultdict(int)
    for seq, _ in sorted(seqs.items(), key=lambda kv: -kv[1])[:max_seq]:
        items = get_json(f"{API}/collections/{seq}/items?limit=400")["features"]
        items.sort(key=lambda f: f["properties"]["datetime"])
        sig = (items[0]["properties"]["datetime"], tuple(items[0]["geometry"]["coordinates"]))
        if sig in seen:  # the same drive uploaded twice
            continue
        seen.add(sig)
        cam = items[0]["properties"].get("pers:interior_orientation", {}).get("camera_model")
        print(f"\nsequence {seq[:8]} ({len(items)} photos, camera {cam})")
        for i in range(3, len(items) - 3, max(1, (len(items) - 6) // per_seq)):
            pairs = []
            for a in range(i - 2, i + 3):
                fa, fb = items[a], items[a + 1]
                pa, pb = fa["geometry"]["coordinates"], fb["geometry"]["coordinates"]
                if not 1.5 <= dist(pa, pb) <= 25:
                    pairs.append(None)
                    continue
                ia = fetch(fa["assets"]["sd"]["href"], out / f"{fa['id']}.jpg")
                ib = fetch(fb["assets"]["sd"]["href"], out / f"{fb['id']}.jpg")
                r = forward_direction(ia, ib)
                # Express each pair's answer relative to *its own* travel bearing,
                # as "where the centre faces relative to travel".
                travel = bearing(pa, pb)
                az = fa["properties"].get("view:azimuth")
                pairs.append((r, travel, az))
            singles = [p for p in pairs if p]
            v = vote([p[0] for p in singles])
            truth = [wrap(az - t) for _, t, az in singles if az is not None]
            truth = sorted(truth)[len(truth) // 2] if truth else None
            if v["forward_deg"] is None:
                verdict = "abstain"
                got = None
            else:
                got = wrap(-v["forward_deg"])
                verdict = "ok" if truth is not None and abs(wrap(got - truth)) <= 45 else "WRONG"
            tally[verdict] += 1
            per = " ".join("—" if not p else (f"{wrap(-p[0].forward_deg):+.0f}" + ("" if passes(p[0]) else "x")) for p in pairs)
            print(f"  @{i:3d} truth {truth if truth is None else f'{truth:+.0f}°'}  vote {got if got is None else f'{got:+.0f}°'} "
                  f"({v['used']}/{v['of']}, consistency {v['consistency']})  {verdict:7s} pairs: {per}")
    print("\nTOTAL", dict(tally))


if __name__ == "__main__":
    main()
