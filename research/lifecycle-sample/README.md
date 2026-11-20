# Lifecycle styling sample

Made-up signs for reviewing how lifecycle tagging shows on the map. There are
7 tagging variants (rows, top to bottom) and 9 colours (columns, left to right:
default pink, red, pink, blue, turquoise, green, yellow, orange, white). They're
laid out on a 50 m grid in open desert near Amboy, CA.

| Row | Tagging | Stage |
|---|---|---|
| 1 | `advertising=sign` + `luminous=yes` + `light:method=neon` | active |
| 2 | `disused:advertising=sign` + `luminous=yes` + `light:method=neon` | disused |
| 3 | `advertising=sign` + `disused:luminous=yes` + `disused:light:method=neon` | disused |
| 4 | `advertising=sign` + `luminous=yes` + `light:method=neon` + `disused=yes` | disused |
| 5 | `advertising=sign` + `abandoned:luminous=neon` + `abandoned:light:method=neon` | abandoned |
| 6 | `abandoned:advertising=sign` + `abandoned:light:method=neon` | abandoned |
| 7 | `disused:advertising=sign` + `abandoned:light:method=neon` | abandoned (worst wins) |

Each sign's inscription names its row and colour, and the detail panel's
"About" line lists its tags. The ids are fake (900000xxxx), so the OSM and
editor links don't lead to these signs.

## View it

```sh
node research/lifecycle-sample/make-sample.mjs   # regenerate signs.geojson
```

Then serve a copy of the site with `research/lifecycle-sample/signs.geojson`
as its `data/signs.geojson`, and open `#node/9000000304` (the middle of the
grid). Don't copy it over the real `data/signs.geojson`.
