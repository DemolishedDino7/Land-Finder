# Architecture

## Why it looks like this

The two source apps shared one lineage — Utah was forked from Idaho and then evolved — so they had
the same shape (config → classify → fetch → value → score → render → orchestrate) but had drifted
apart. Both loaded classic `<script>` tags into a single global scope, and they collided on **61
top-level names**, including `map`, `parcelLayer`, `scoreParcel`, `featStyle`, `TIER_COLOR` and
`CITY_LIMITS_URL`. Two `const map` declarations in one scope is a hard SyntaxError, so
concatenation was never an option.

The split is therefore: **one engine, two region descriptors, ES modules.**

Utah's engine won outright. It was a generation ahead — `irr`, `productsFor` (every permitted
product priced, then ranked by max land offer), pad sales, rural/ag, build-to-rent vs merchant
build, and separate hurdle rates per product. Idaho's had `residualValue`, `incomeValue`,
`holdDCF` and two multifamily paths. Meeting in the middle would have thrown away real work, so
Idaho's data was plugged into Utah's engine instead.

## The region contract

A region descriptor supplies data and policy. It never supplies behavior the engine should own.

| Field | Purpose |
|---|---|
| `id`, `name`, `short`, `center`, `zoom`, `minZoom`, `minZoomOverlay`, `attribution` | identity and framing |
| `classify.protectedExtra` / `protectedEq` | protected-land keywords **beyond** the shared list |
| `fluLayers[]` | future-land-use / zoning services, each optionally `ext`-gated to its own extent |
| `cityLimitsUrls[]`, `sewerUrl`, `impactUrl`, `floodUrl`, `hillsideUrl`, `ownLayers[]` | overlay + constraint services |
| `slopeImg`, `steepPct`, `slopeMaxParcels` | elevation-derived slope, where no hillside polygons are published |
| `zoningJoin` | for regions whose parcels carry no zoning field (Canyon County) |
| `init()` | build `tracedFlu` from the hand-traced plan data |
| `fetchParcels(bbox)` | the parcel services genuinely differ; each region does its own, normalizing to one field set |
| `annotate(p, d)` | per-parcel joins that differ: the service model, zoning joins, `utilMissing` |
| `countyRes(name)` | per-county by-right density from the zoning ordinance, or `null` |
| `cityLot(city)`, `cityLotInputs`, `cityMixedDu`, `overrides` | market policy |
| `estimate` | comp-based value imputation, where the schema supports it |
| `inputs`, `cityLotFields` | panel defaults — this is what makes switching regions switch assumptions |

## Two seams worth understanding

**`annotate()` is where the states really differ.** Idaho decides service from sewer districts plus
adopted areas of city impact (sewer service genuinely extends past the city line there, and Emmett's
plan area stands in for the area of impact Gem County never published). Utah has no statewide sewer
layer, so it decides service from distance to the nearest municipal boundary. Both collapse to the
same three states the engine understands — `city` / `annex` / `county` — plus `utilMissing`, which
says which mains this parcel actually lacks so an annexation-path parcel is charged for one main
rather than reflexively both.

**The panel is generated, not written.** `ui.FIELD_GROUPS` is the schema; the region's `inputs`
block supplies the values. That is why adding a per-city lot value to a region takes one array
entry and no markup, and why the same field ids reach the engine in both regions.

## Verifying a change to the engine

`node --check` every file, then score identical synthetic parcels through the merged engine and
through the original Utah engine and diff the results. Ten cases (lot sale, apartments, commercial,
mixed use, county density, annexation path, protected, rural, no-value, industrial) matched the
original to the dollar after the merge. Any engine change should be re-checked the same way —
against the pre-change engine, not against intuition.
