"""Run the flow check on the photos probe.mjs found.

    python -E -P flow_mapillary.py <probe.json> <download dir> [out.json]

For each panorama: consecutive neighbour pairs → forward column per pair →
vote → where the image centre faces relative to travel. Compared with what the
site assumes today (js/aim.js) and with Mapillary's computed_compass_angle.
"""

import json
import math
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flow import forward_direction, passes, vote  # noqa: E402


def wrap(d):
    return (d + 180) % 360 - 180


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


def side(rel):
    return None if rel is None else ["forward", "right", "back", "left"][int(((rel + 45) % 360) // 90)]


def fetch(url, dest: Path):
    if not dest.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "route-66-neon research"})
        with urllib.request.urlopen(req, timeout=120) as r:
            dest.write_bytes(r.read())
    return dest


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    probe = json.load(open(sys.argv[1], encoding="utf8"))
    cache = Path(sys.argv[2])
    cache.mkdir(parents=True, exist_ok=True)
    out_path = sys.argv[3] if len(sys.argv) > 3 else None
    rows = []
    for rec in probe["records"]:
        nb = rec.get("neighbours") or []
        if rec.get("travel") is None or len(nb) < 2:
            continue
        results = []
        for a, b in zip(nb, nb[1:]):
            pa, pb = (a["lon"], a["lat"]), (b["lon"], b["lat"])
            if not (a.get("thumb") and b.get("thumb")) or not 1.5 <= dist(pa, pb) <= 30:
                continue
            try:
                ia = fetch(a["thumb"], cache / f"{a['id']}.jpg")
                ib = fetch(b["thumb"], cache / f"{b['id']}.jpg")
            except Exception as e:  # noqa: BLE001 — report and move on
                print(f"  {rec['id']}: download failed ({getattr(e, 'code', type(e).__name__)})")
                continue
            r = forward_direction(ia, ib)
            # Re-express against the target's travel bearing so pairs on a bend still vote together.
            r.forward_deg = wrap(r.forward_deg + (rec["travel"] - bearing(pa, pb)))
            results.append(r)
        v = vote(results)
        flow_rel = None
        if v["forward_deg"] is not None and v["used"] >= 2 and v["consistency"] >= 0.75:
            flow_rel = round(wrap(-v["forward_deg"]), 1)
        site_rel = None if rec.get("site_centre") is None else round(wrap(rec["site_centre"] - rec["travel"]), 1)
        row = {
            "id": rec["id"],
            "captured": rec.get("captured"),
            "sequence": rec.get("sequence"),
            "signs": [s.get("name") or s["osm"] for s in rec["signs"]],
            "travel": rec["travel"],
            "compass_minus_travel": rec.get("compass_minus_travel"),
            "site": side(site_rel),
            "site_rel": site_rel,
            "flow": side(flow_rel),
            "flow_rel": flow_rel,
            "flow_vote": v,
            "computed": side(rec.get("computed_minus_travel")),
            "computed_rel": rec.get("computed_minus_travel"),
        }
        row["site_wrong"] = None if flow_rel is None or site_rel is None else abs(wrap(site_rel - flow_rel)) > 90
        rows.append(row)
        print(
            f"{rec['id']:>17} {rec.get('captured')}  compass−travel {rec.get('compass_minus_travel'):+7.1f}  "
            f"site {row['site'] or '?':7s} flow {row['flow'] or '?':7s} ({v['used']}/{v['of']})  computed {row['computed'] or '?':7s}"
            f"{'  ← SITE WRONG' if row['site_wrong'] else ''}  {', '.join(map(str, row['signs']))[:40]}"
        )
    if out_path:
        json.dump(rows, open(out_path, "w", encoding="utf8"), indent=1)
    judged = [r for r in rows if r["site_wrong"] is not None]
    print(f"\n{len(rows)} photos, flow judged {len(judged)}: site wrong on {sum(r['site_wrong'] for r in judged)}")
    agree = [r for r in rows if r["flow"] and r["computed"]]
    if agree:
        print(f"flow vs computed_compass_angle: same quarter on {sum(r['flow'] == r['computed'] for r in agree)}/{len(agree)}")


if __name__ == "__main__":
    main()
