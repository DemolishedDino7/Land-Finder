# Land Finder — Idaho & Utah

Interactive deal-analysis map. Pulls live parcel and planning data from public ArcGIS services,
develops each parcel to its highest and best use, and scores it against the asking/assessed price.
One app, two regions: **Idaho** (Ada, Canyon, Gem, + Elmore FLU overlays) and **Utah** (all 29
counties via UGRC LIR).

## Running it

**You now need a server** — `serve.bat` (Windows) or `./serve.sh`, then open
<http://localhost:8000>. Double-clicking `index.html` no longer works: the app is ES modules, and
browsers refuse to load modules over `file://`. That was the price of merging two codebases that
collided on 61 global names.

Requires an internet connection — all parcel and planning data is fetched live.

## The basemap needs a key

CARTO retired keyless access to their basemap tiles, so without a key the map shows an
"API KEY REQUIRED" watermark. A key is free (5M tiles/month, no account) from
<https://carto.com/basemaps/apikey/>. Paste it into **one place**: `CARTO_KEY` at the top of
`js/core/basemap.js`.

## Layout

    index.html              markup + control panel shell
    css/app.css             all styling
    js/core/                the engine — knows nothing about any state
      classify.js           land-use text -> intensity tier + density   <-- read the header note
      valuation.js          the pro-formas (all-equity by design)
      scoring.js            highest & best use -> verdict
      data.js               fetching, spatial joins, geometry helpers
      estimate.js           comp-based value for parcels with no assessor value
      map.js                Leaflet map, panes, layers, legends
      render.js             parcel colors + the detail markup (pure)
      ui.js                 assumptions panel, tabs, saved list, detail sidebar
      basemap.js            tiles + the CARTO key
      app.js                orchestration, region switching, boot
    js/regions/
      index.js              the region registry
      idaho.js              Idaho: services, layers, market numbers, service model
      utah.js               Utah: ditto, plus the per-county density table
      idaho-traced-flu.js   FLU traced from adopted PDFs (Star CBD, Emmett, Gem)
      utah-beaver-zones.js  Beaver City zoning traced from its GeoPDF
      utah-counties.js      the 29 county extents + in-view lookup
    source-plans/           the adopted PDF plans + georeferenced crops the traces came from

## Adding a region

Write a descriptor in `js/regions/`, add one line to `js/regions/index.js`. Nothing in `js/core/`
should ever need to know the state's name. See `docs/ARCHITECTURE.md` for the contract.

## Two things that will bite you

**The protected-land keyword list is per region, on purpose.** GREENBELT and RECREATION are
protected open space in Idaho and ordinary ag/assessor terms in Utah. Merging those lists silently
flips Idaho greenbelt and Gem County natural-resource land to developable — which paints them
green. The header comment in `js/core/classify.js` spells it out.

**Three old Idaho knobs are gone.** The Utah engine fixes the hold period (10 yr), the build period
(2 yr) and the 8 du/ac lot-vs-apartment routing threshold as constants; Idaho used to expose them as
inputs. Idaho verdicts came out unchanged on the merged engine, with max offers 2–5% higher —
that rise is the commission now being netted at closing before discounting instead of bundled into
day-one soft costs.
