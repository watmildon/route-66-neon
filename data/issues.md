# Data issues

Problems in the OpenStreetMap data that the last data update worked around.
Each one says what the map does about it until it's fixed in OSM. This file
is rewritten by every run of `scripts/fetch-signs.mjs`, so fixed issues drop
off on their own.

2 issues:

| Sign | Kind | Problem |
|---|---|---|
| [Charm of yesterday ... convenience of tomorrow](https://www.openstreetmap.org/node/14403431100) `node/14403431100` | Mapillary photo far away | Mapillary photo [1589365052602726](https://www.mapillary.com/app/?pKey=1589365052602726&focus=photo) was taken 1159 km from the sign. It still shows, but the viewer isn't turned toward the sign. Wrong photo id, or the sign is in the wrong place? |
| [Motel](https://www.openstreetmap.org/node/14410949110) `node/14410949110` | Mapillary photo not near the sign | Mapillary photo [28298249769864049](https://www.mapillary.com/app/?pKey=28298249769864049&focus=photo) isn't in Mapillary's coverage around the sign, so the viewer can't turn toward the sign. Wrong photo id, a photo that was removed, or the sign is in the wrong place? |
