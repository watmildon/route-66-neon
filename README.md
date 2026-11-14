# Route 66 Neon

A [MapLibre GL](https://maplibre.org/) map of the neon signs along Historic
Route 66, built from OpenStreetMap data mapped during the OSM US
[#mapping-route-66-neon](https://tasks.openstreetmap.us/projects/1352) event.

- Every sign tagged `advertising=sign` (or `billboard`) that is lit from
  within, i.e. `luminous=yes`, `luminous=neon` or `light:method=neon`, within
  400 m of the
  Historic Route 66 alignment shows as a glowing dot, coloured by `colour=*`
  when it's set.
- The corridor also takes in former US 66 alignments that OSM's Historic
  Route 66 relations leave out (dashed on the map; hover for what each one is):
  ways tagged `old_ref=US 66`, and state routes on old 66 such as OK 66,
  MO 366 and K-66. See [`scripts/lib/alignments.mjs`](scripts/lib/alignments.mjs).
- Click a sign (or pick it from the list) to see its photo, key tags, and
  links to view or edit it in OSM.
- **◀ Toward Chicago / Toward L.A. ▶** (or the ← → keys) steps sign by sign
  along the drive.
- Each sign has a shareable URL such as `…/#node/8813401256`.

No build step: it's a static site (HTML, CSS, ES modules) plus two GeoJSON
files that a GitHub Action keeps fresh.

## Photos

The detail panel reads photos from these tags, in this order:

| Tag | Shown as |
|---|---|
| `mapillary=*`, `mapillary:N=*` | Mapillary image ID (the project's required tag). Uses the Graph API thumbnail if a client token is set in [`js/config.js`](js/config.js); otherwise falls back to Mapillary's embedded viewer. |
| `panoramax=*`, `panoramax:N=*` | Panoramax picture, via the federated `api.panoramax.xyz` catalogue |
| `wikimedia_commons=File:…` | Wikimedia Commons image (`Category:` values are skipped) |
| `image=*`, `image:N=*` | Commons/Mapillary/Panoramax URLs are recognised; direct `.jpg/.png/.webp` links are shown inline; anything else becomes an "open original" link |

Multiple values (`a;b`) and several sources per sign all appear as tabs. The
expand button (bottom-left of the photo) opens it full-screen. You can keep
stepping through signs while it's expanded; Esc shrinks it.

### Aiming 360° photos at the sign

All of the project's Mapillary imagery (the National Trust for Historic
Preservation's Route 66 drive) is 360° panoramas, and the sign is often off
to the side. So the viewer opens turned toward the sign:

1. The data pipeline looks up each tagged photo in Mapillary's coverage tiles
   and stores where it was taken, its `compass_angle`, whether it's a
   panorama, its capture date, and its uploader (`properties.mapillary` in
   `data/signs.geojson`).
2. The page computes the bearing and tilt from that spot to the sign's OSM
   position ([`js/aim.js`](js/aim.js)). It passes them to Mapillary's viewer
   as the starting view (`x`/`y`), and to the "Open original" link.

`compass_angle` in the tiles is usually the direction of travel, not where the
panorama's centre points. 360° cameras are normally mounted with their lenses
facing the sides of the car (it keeps the stitch seams off the road and the
camera out of the wind), so the centre points sideways. `js/aim.js` therefore
assumes the centre faces 90° left of travel (`DEFAULT_LENS_OFFSET = -90`).
That's verified for NTHP's imagery against signs in Tulsa and Albuquerque,
and pinned in `LENS_OFFSET_BY_CREATOR`. A rig mounted the other way (+90°) or
facing forward (0°) gets an entry in that table. To calibrate one, open a
panorama in the embed with `x=0.5` and see which way it faces relative to the
car. With a client token configured, the page instead uses Mapillary's own
`computed_compass_angle`, which needs no correction.

Tilt assumes a roof-mounted camera (2.5 m) and guesses the sign's height from
`height=*`, `location=*` and `support=*`. It's capped at 30°.

### Mapillary client token (optional)

Without a token, Mapillary photos load in Mapillary's embeddable viewer, which
works but is heavier. To show plain images instead, create an app at
<https://www.mapillary.com/dashboard/developers> and put its **client token**
(`MLY|…`) in `js/config.js`. Client tokens are designed to be public in
browser code. A tiles-only key will not work because it can't read image
metadata.

## Wikipedia and Wikidata

Famous signs get an **About** card in the infobox (and a **W** badge in the
list) with the Wikidata label and description, a Commons thumbnail, and links
to Wikipedia and Wikidata. The links come from two places:

1. `wikidata=*` / `wikipedia=*` on the sign itself.
2. The closest OSM place within 150 m that has `wikidata`/`wikipedia` **and**
   whose name matches the sign's text. Usually that's the motel, diner or
   theatre the sign belongs to, which is where these tags usually are.
   Matching compares the distinctive words, ignoring generic ones like
   "motel", "theater" or "vacancy": "HILAND" ↔ "Hiland Theater", "Blue
   Swallow Motel 100% Refrigerated Air" ↔ "Blue Swallow Motel". Distance alone
   isn't enough, because unrelated linked places are often next door. The card
   says when a link came through a place rather than the sign.

Wikidata then supplies the label, short description, English Wikipedia
article (the mapper's own `wikipedia=*` wins if present) and its P18 image.
That image goes on the card, not in the main photo pane, because it's
sometimes of the place rather than the sign (Bobcat Bite's is a burger).

If a sign is famous but has no card, the fix is in OSM: add `wikidata=*` to
the sign, or make sure the place next to it has `wikidata=*` and a matching
`name=*`.

## Data pipeline

| File | Made by | Refreshed |
|---|---|---|
| `data/route66.geojson` | `scripts/fetch-route.mjs`: the ways under superroute [93155](https://www.openstreetmap.org/relation/93155) plus any `network=US:US:Historic` + `ref=66` routes, from **Overpass**, merged and simplified to ~8 m | weekly |
| `data/alignments.geojson` | `scripts/fetch-route.mjs`: other former US 66 alignments, i.e. the relations listed in `scripts/lib/alignments.mjs` plus ways tagged `old_ref=US 66` (and variants), minus anything already in the main line; one labelled feature per stretch | weekly |
| `data/signs.geojson` | `scripts/fetch-signs.mjs`: lit signs and billboards in the route's bounding box from **Postpass** (falls back to Overpass), filtered to the tagging and to within 400 m of either route file | daily |

[`.github/workflows/update-data.yml`](.github/workflows/update-data.yml) runs
both, runs the tests, and commits only if the data changed. Safety rails:

- refuses OSM data older than 48 h
- refuses to overwrite if the sign count (or route length) drops by more than 50%
- writes one feature per line, sorted by OSM id, so diffs are readable
- leaves `signs.geojson` untouched when no sign changed, so there are no empty commits
- if the weekly route refresh fails, the committed line is kept
- Mapillary photo info is looked up once per photo and carried forward, since photos don't move
- if the place lookup or Wikidata is unavailable, the previous run's wiki links and labels are kept

The 400 m corridor matters because outside Route 66 many `luminous=yes`
signs are ordinary backlit boxes, not neon.

When tagging, prefer `light:method=neon` (with `luminous=yes`): it tells
neon apart from other signs that are lit from within. The map accepts
`luminous=yes` alone too, so older tagging still shows. Anything with
`animated=*` other than `no` (`screen`, `digital_display` …) is treated as a
digital display and left out, unless it's tagged `light:method=neon`.

### Settings

All optional. Set them as repository **variables**, or the **secret** for the
Overpass URL:

| Name | Default | Purpose |
|---|---|---|
| `OVERPASS_PRIMARY_URL` (secret) | — | Private Overpass instance tried before the public mirrors. Never logged. |
| `MAPILLARY_TOKEN` (secret) | — | Mapillary token for looking up newly tagged photos (a tiles-only key works). Photos already in the data are reused, so it's only needed for new ones. Locally: env var or a gitignored `.mapillary-token` file. |
| `BUFFER_M` | `400` | Corridor width either side of the route line |
| `DROP_THRESHOLD` | `50` | Max % drop in sign count before the update is refused |
| `MAX_DATA_LAG_HOURS` | `48` | Max OSM data age accepted |
| `USER_AGENT` | `route-66-neon/1.0 (+repo URL)` | Sent to Postpass/Overpass |

Locally, the scripts find a private Overpass endpoint from `OVERPASS_URL` /
`OVERPASS_PRIMARY_URL`, then `.overpass-url` in the repo root (gitignored),
then `~/.claude/.overpass-url`, and otherwise use the public mirrors.

## Running locally

```bash
npm run serve          # python -m http.server 8000 → http://localhost:8000/
npm test               # unit tests + data sanity checks (Node ≥ 20, no dependencies)
npm run fetch:route    # re-download the route line
npm run fetch:signs    # re-download the signs
```

The page loads its GeoJSON with `fetch()`, so open it over HTTP, not `file://`.

## Hosting

GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / root**.
`.nojekyll` is included so the files are served as-is. Each data commit from
the Action triggers a Pages rebuild.

## Open in OSM and editors

Each sign's infobox has icon buttons:
- **View on OpenStreetMap**
- **Edit in iD**
- **Edit in Rapid**, which opens with the sign selected
- **Edit in JOSM**, which sends `load_and_zoom` to JOSM's Remote Control
  (`127.0.0.1:8111`). It downloads about 150 m around the sign and selects
  it. If JOSM isn't running with Remote Control on, the button says so.

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
(ODbL). Basemap © [CARTO](https://carto.com/attributions). Photos belong to
their Mapillary, Panoramax and Wikimedia Commons contributors under their
respective licences. Editor logos link to their projects: the OpenStreetMap and
Rapid marks are from Rapid's icon set (ISC), the iD logo from iD (ISC), and the
JOSM logo from JOSM (GPL).
