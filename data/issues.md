# Data issues

Problems in the OpenStreetMap data that the last data update worked around.
Each one says what the map does about it until it's fixed in OSM. This file
is rewritten by every run of `scripts/fetch-signs.mjs`, so fixed issues drop
off on their own.

3 issues:

| Sign | Kind | Problem |
|---|---|---|
| [The Al-Pac Motel No Vacancy](https://www.openstreetmap.org/node/14382412200) `node/14382412200` | Mapillary photo not near the sign | Mapillary photo [39503586129289071](https://www.mapillary.com/app/?pKey=39503586129289071&focus=photo) isn't in Mapillary's coverage around the sign, so the viewer can't turn toward the sign. Wrong photo id, a photo that was removed, or the sign is in the wrong place? |
| [Charm of yesterday ... convenience of tomorrow](https://www.openstreetmap.org/node/14403431100) `node/14403431100` | Mapillary photo far away | Mapillary photo [1589365052602726](https://www.mapillary.com/app/?pKey=1589365052602726&focus=photo) was taken 1159 km from the sign. It still shows, but the viewer isn't turned toward the sign. Wrong photo id, or the sign is in the wrong place? |
| [MOTEL \| HENNING \| FREE TV](https://www.openstreetmap.org/node/14410949110) `node/14410949110` | Mapillary photo not near the sign | Mapillary photo [28298249769864049](https://www.mapillary.com/app/?pKey=28298249769864049&focus=photo) isn't in Mapillary's coverage around the sign, so the viewer can't turn toward the sign. Wrong photo id, a photo that was removed, or the sign is in the wrong place? |
