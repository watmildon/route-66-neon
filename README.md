# Route 66 Neon

A [MapLibre GL](https://maplibre.org/) map of the neon signs along Historic
Route 66, built from OpenStreetMap data mapped during the OSM US
[#mapping-route-66-neon](https://tasks.openstreetmap.us/projects/1352) event.

- Every sign tagged `advertising=sign` (or `billboard`) that is lit from
  within, i.e. `luminous=yes`, `luminous=neon` or `light:method=neon`, within
  400 m of the
  Historic Route 66 alignment shows as a glowing dot, coloured by `colour=*`
  when it's set. Disused signs lose the glow and abandoned ones show as a
  ring (see the lifecycle table under [Data pipeline](#data-pipeline)).
- The corridor also takes in former US 66 alignments that OSM's Historic
  Route 66 relations leave out (dashed on the map; hover for what each one is):
  ways tagged `old_ref=US 66`, and state routes on old 66 such as OK 66,
  MO 366 and K-66. See [`scripts/lib/alignments.mjs`](scripts/lib/alignments.mjs).
- Click a sign (or pick it from the list) to see its photo, key tags, and
  links to view or edit it in OSM.
- The list is grouped by state; click a state's heading to fold it (remembered
  in this browser). Rows mark only what's uncommon: **W** for a Wikipedia or
  Wikidata link, a sparkle for a Wikimedia Commons photo (often a night shot),
  and the map-pin icon for historical photos on Yesterdays. The chips under the
  search box show only signs with those, on the list and the map, and the
  ◀ ▶ stepper follows the filter.
- **◀ Toward L.A. / Toward Chicago ▶** (or the ← → keys) steps sign by sign
  along the drive. Left is west, as on the map.
- Each sign has a shareable URL such as `…/#node/8813401256`.

No build step: it's a static site (HTML, CSS, ES modules) plus two GeoJSON
files that a GitHub Action keeps fresh.

## Photos

The detail panel reads photos from these tags, in this order:

| Tag | Shown as |
|---|---|
| `wikimedia_commons=File:…` | Wikimedia Commons image, credited with its author and licence (looked up from the Commons API when shown) |
| `wikimedia_commons=Category:…` | A "Gallery" tab: thumbnails of the category's files (up to 50). Click one to enlarge it; the **Gallery** button on the photo, or Esc, goes back to the grid |
| `flickr=*`, `flickr:N=*` | Flickr photo: the photo page URL (`https://www.flickr.com/photos/<user>/<id>`), a `flic.kr/p/…` short link, or the bare photo id. Shown with its title, author and licence, and linked back to Flickr. Photos under any Creative Commons licence (non-commercial included), CC0, public domain, "no known copyright restrictions" or US Government Work are shown inline; All Rights Reserved photos get an "Open on Flickr" link instead. Album and user links stay plain links. |
| `mapillary=*`, `mapillary:N=*` | Mapillary image ID (the project's required tag). Uses the Graph API thumbnail if a client token is set in [`js/config.js`](js/config.js); otherwise falls back to Mapillary's embedded viewer. |
| `panoramax=*`, `panoramax:N=*` | Panoramax picture, via the federated `api.panoramax.xyz` catalogue |
| *(no tag: matched by the data pipeline)* | A "Yesterdays" tab: historical photos and postcards from [Yesterdays](https://yesterdays.today), e.g. the Newberry Library's Route 66 postcards and John Margolies' Roadside America photos. Each is credited with its date, source and licence (or a link to the rights statement at the source) and links to its Yesterdays page. Images are Yesterdays' ~500 px versions. |
| `image=*`, `image:N=*` | Commons file/category, Flickr photo, Mapillary and Panoramax URLs are recognised; direct `.jpg/.png/.webp` links are shown inline; anything else becomes an "open original" link |

Commons comes first, then Flickr, because those photos are usually chosen
shots, often at night with the neon lit; street-level imagery is mostly
daytime.

Multiple values (`a;b`) and several sources per sign all appear as tabs. The
expand button (bottom-left of the photo) opens it full-screen. You can keep
stepping through signs while it's expanded; Esc backs out one step at a time
(enlarged gallery photo → gallery, then full-screen → panel).

### Aiming 360° photos at the sign

All of the project's Mapillary imagery (the National Trust for Historic
Preservation's Route 66 drive) is 360° panoramas, and the sign is often off
to the side. So the viewer opens turned toward the sign:

1. The data pipeline looks up each tagged photo in Mapillary's coverage tiles
   and stores where it was taken, its `compass_angle`, whether it's a
   panorama, its capture date, and its uploader (`properties.mapillary` in
   `data/signs.geojson`). For panoramas it also asks the Graph API for
   Mapillary's `computed_compass_angle` (stored as `computedCompass`), the
   heading of the image centre.
2. The page computes the bearing and tilt from that spot to the sign's OSM
   position ([`js/aim.js`](js/aim.js)). It passes them to Mapillary's viewer
   as the starting view (`x`/`y`), and to the "Open original" link.

`compass_angle` in the tiles is usually the direction of travel, not where the
panorama's centre points. 360° cameras are normally mounted with their lenses
facing the sides of the car (it keeps the stitch seams off the road and the
camera out of the wind), so the centre points sideways, and which side can
change from one sequence to the next. NTHP's June 2026 drive has both, even
on the same day. `computedCompass` settles it, so the page uses it whenever
it's there. It agreed with an independent image-motion check on all 123
photos that check could call (`research/mapillary-heading/`).

Without it (a tiles-only token, or a photo Mapillary hasn't aligned yet),
`js/aim.js` falls back to a guess and assumes the centre faces 90° left of travel (`DEFAULT_LENS_OFFSET = -90`).
That's verified for NTHP's June 2026 drive against signs in Tulsa and
Albuquerque, and pinned in `LENS_OFFSET_BY_CREATOR`. A rig mounted the other
way (+90°) or facing forward (0°) gets an entry in that table, and an entry
can be a list of date ranges when an uploader's rig changed between drives:
NTHP's April 2025 photos (Williams AZ) face right of travel, so they're +90°
before 2026. To calibrate one, open a
panorama in the embed with `x=0.5` and see which way it faces relative to the
car. With a client token configured in `js/config.js`, the page also reads
`computed_compass_angle` live for photos the data doesn't have it for.

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
| [`data/issues.md`](data/issues.md) | `scripts/fetch-signs.mjs`: problems in the OSM data it worked around, for mappers to fix | daily |

[`.github/workflows/update-data.yml`](.github/workflows/update-data.yml) runs
both, runs the tests, and commits only if the data changed. Safety rails:

- refuses OSM data older than 48 h
- refuses to overwrite if the sign count (or route length) drops by more than 50%
- writes one feature per line, sorted by OSM id, so diffs are readable
- leaves `signs.geojson` untouched when no sign changed, so there are no empty commits
- if the weekly route refresh fails, the committed line is kept
- Mapillary photo info is looked up once per photo and carried forward, since photos don't move
- Flickr photos are looked up through Flickr's oEmbed endpoint (no API key) and stored in `properties.flickr`. Each is rechecked after 30 days, since owners can change the licence or delete the photo; a deleted photo (404) is dropped, and any other failure keeps the previous entry
- if the place lookup or Wikidata is unavailable, the previous run's wiki links and labels are kept
- if Yesterdays is unavailable, each sign keeps its previous Yesterdays photos
- problems in the OSM data don't fail the run. A Mapillary photo taken far
  from its sign (usually a photo id copied onto the wrong sign) isn't aimed,
  a tagged Mapillary photo that isn't anywhere near the sign isn't aimed, a
  Yesterdays photo matched to a sign but taken far from it is left off, and a
  deleted Flickr photo is dropped. Each one is listed in `data/issues.md`,
  which is committed with the data and shown in the run's summary. The tests
  still fail the run for malformed data, which would point to a pipeline bug.

### Yesterdays matches

[Yesterdays](https://yesterdays.today) is an archive of old photos and
postcards that volunteers georeference and tag with "subjects" (Wikidata
items). `scripts/lib/yesterdays.mjs` links a sign to an image automatically
when any of these hold:

- one of the image's subjects is an item the sign links to (`wikidata=*`,
  `subject:wikidata=*`, or the wiki-linked place next to it);
- one of its subjects names the sign and Wikidata puts that subject within
  250 m of it. This works for photos that aren't georeferenced, and for signs
  with no Wikidata link in OSM;
- the image is georeferenced within 150 m of the sign **and** its title names
  the sign. Position alone isn't enough, because a block of old motels has
  many photos;
- the image has the "neon sign" subject
  ([Q6006](https://www.wikidata.org/wiki/Q6006)) and is georeferenced within
  60 m of the sign, with a view direction within 30° of it. This catches
  untitled photos, and signs whose words are all generic ("Restaurant"). A
  photo aimed at a cluster of signs shows up on each of them.

"Names the sign" means sharing at least two distinctive words, or the only
one, ignoring words like "motel" or "cafe"; words run together count too
("Blueswallow"). So on Yesterdays, either georeferencing a photo or giving it
the motel's Wikidata subject brings it onto this map at the next data run. A
run makes a few dozen Yesterdays requests, spaced a second apart, plus a
Wikidata lookup for the subjects whose names match a sign.
Every sign's "Open in" row also links to Yesterdays' map at that spot.

The 400 m corridor matters because outside Route 66 many `luminous=yes`
signs are ordinary backlit boxes, not neon.

When tagging, prefer `light:method=neon` (with `luminous=yes`): it tells
neon apart from other signs that are lit from within. The map accepts
`luminous=yes` alone too, so older tagging still shows. A sign that's lit
but isn't neon gets `luminous=yes` plus its actual `light:method` (`LED`,
`fluorescent`, or `electric` when the technology is unknown); any
`light:method` without `neon` keeps the sign off the map. Anything with
`animated=*` other than `no` (`screen`, `digital_display` …) is treated as a
digital display and left out, unless it's tagged `light:method=neon`.

Signs in disrepair use OSM's
[lifecycle prefixes](https://wiki.openstreetmap.org/wiki/Lifecycle_prefix) on
those same keys, and the map shows the stage:

| Tagging | Example | On the map |
|---|---|---|
| no prefix | `advertising=sign` + `light:method=neon` | glowing dot |
| `disused:` on any of `advertising`, `luminous`, `light:method` | `disused:advertising=sign` (the sign is out of service) | dot without the glow |
| `abandoned:` on any of them | `advertising=sign` + `abandoned:light:method=neon` + `abandoned:luminous=neon` (the sign is fine, the neon is wrecked) | unfilled ring, no glow |

The worst stage on any of the three keys wins, and the older `disused=yes` /
`abandoned=yes` on the sign count too. Later stages (`demolished:`,
`removed:`, `was:` …) mean the sign is gone, so it drops off the map.

### Settings

All optional. Set them as repository **variables**, or the **secret** for the
Overpass URL:

| Name | Default | Purpose |
|---|---|---|
| `OVERPASS_PRIMARY_URL` (secret) | — | Private Overpass instance tried before the public mirrors. Never logged. |
| `MAPILLARY_TOKEN` (secret) | — | Mapillary client token for looking up newly tagged photos. Its app needs **Read** access so the Graph API returns `computed_compass_angle`; a tiles-only token still positions photos but leaves 360° ones aimed by guesswork. Photos already in the data are reused, so it's only needed for new ones. Locally: env var or a gitignored `.mapillary-token` file. |
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
respective licences. Historical photos are found through
[Yesterdays](https://yesterdays.today) and belong to the institutions credited
with each one. Editor logos link to their projects: the OpenStreetMap and
Rapid marks are from Rapid's icon set (ISC), the iD logo from iD (ISC), and the
JOSM logo from JOSM (GPL). The Yesterdays icon is
[Font Awesome Free](https://fontawesome.com)'s "map-location-dot"
([CC BY 4.0](https://fontawesome.com/license/free)).
