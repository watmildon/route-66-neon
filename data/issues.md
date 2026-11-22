# Data issues

Problems in the OpenStreetMap data that the last data update worked around.
Each one says what the map does about it until it's fixed in OSM. This file
is rewritten by every run of `scripts/fetch-signs.mjs`, so fixed issues drop
off on their own.

1 issue:

| Sign | Kind | Problem |
|---|---|---|
| [Charm of yesterday ... convenience of tomorrow](https://www.openstreetmap.org/node/14403431100) `node/14403431100` | Mapillary photo far away | Mapillary photo [1589365052602726](https://www.mapillary.com/app/?pKey=1589365052602726&focus=photo) was taken 1159 km from the sign. It still shows, but the viewer isn't turned toward the sign. Wrong photo id, or the sign is in the wrong place? |
