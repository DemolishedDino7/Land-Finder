# Georeferencing constants

Each traced FLU layer in `js/04-traced-flu.js` was derived from a scanned plan by measuring the
map's own **printed scale bar** (not by eyeballing landmark spacing — that was tried first and was
~23% off, which is what threw the early Emmett alignment).

Formula used for every sheet:

    lng = anchorLng + (px - anchorPx) * (metersPerPx / 80290)
    lat = anchorLat + (anchorPy - py) * (metersPerPx / 110540)

(80290 m per degree of longitude at 43.87 N; 110540 m per degree of latitude.)

| Sheet | Render | Scale bar | m/px | Anchor |
|---|---|---|---|---|
| Emmett — Elevate Emmett | 200 dpi, cropped to 2145x1192 | 161 px = 1/2 mile | **4.998** | Emmett Middle School (301 E 4th St) = 43.871482, -116.496447 at px (1280, 730) |
| Gem County — Emmett-area detail (p2) | 150 dpi, cropped to 1203x1113 | 160.6 px = 1 mile | **10.021** | Hwy 52 / Washington Ave Payette crossing = 43.883238, -116.499622 at px (561, 412) |
| Gem County — county-wide (p1) | 150 dpi, full page 1275x1650 | 120 px = 4 miles | **53.645** | downtown Emmett = 43.8735, -116.4993 at px (660, 1372) |

Validation: the Emmett fit predicts Washington Avenue's longitude to within ~5 px of where it
actually falls on the sheet.

Precedence when polygons overlap (finest wins), set in `js/11-orchestration.js`:

    Emmett parks  >  Emmett city plan  >  Gem Emmett-area detail  >  Gem county-wide  >  live GIS layers

A **protected** designation (parks/public/open space) beats any overlapping override regardless of
this order — otherwise a coarse district would bury a park and it would score as developable.

Working images used to read pixel coordinates are in `../archive/tracing-workfiles/`.
