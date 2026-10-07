/* map.js — the Leaflet map, panes, layers, legends and overlays.

   Knows nothing about regions beyond what it is handed. Parcel clicks are routed out through
   `handlers`, which app.js fills in — that keeps this module free of any dependency on the
   sidebar or the scoring engine, and avoids an import cycle with render.js. */

import { TIER_COLOR, TIER_LABEL } from './classify.js';
import { featStyle, fluStyle } from './render.js';
import { basemapUrl, labelsUrl, BASEMAP_OPTS, BASEMAP_ATTRIBUTION } from './basemap.js';

export const handlers = { click:null, ctrlClick:null };

/* An initial center/zoom MUST be set here, not later: Leaflet throws "Set map center and zoom
   first" the moment a layer is added to a view-less map, and the layers below are added at import
   time. applyRegionToMap() moves it to the active region straight after. */
export const map = L.map('map',{preferCanvas:true, zoomControl:true, center:[43.62,-116.42], zoom:11});
let baseLayer = L.tileLayer(basemapUrl(), Object.assign({}, BASEMAP_OPTS, {attribution:''})).addTo(map);
/* Labels sit in their own pane above the parcels so street names stay readable over colored lots. */
map.createPane('labelPane'); map.getPane('labelPane').style.zIndex = 470; map.getPane('labelPane').style.pointerEvents = 'none';
/* Esri's label tiles stop at native zoom 16; stretched further they turn into giant blurry text,
   so they drop out past 17 (parcels are readable on their own by then). */
if(labelsUrl()) L.tileLayer(labelsUrl(), Object.assign({}, BASEMAP_OPTS, {attribution:'', pane:'labelPane', maxZoom:17})).addTo(map);

export const parcelLayer = L.geoJSON(null,{
  style:(f)=>featStyle(f),
  onEachFeature:(f,layer)=>{
    layer.on('click',(e)=>{
      const oe=e.originalEvent||{};
      if((oe.ctrlKey||oe.metaKey) && handlers.ctrlClick){ L.DomEvent.stop(e); handlers.ctrlClick(f); return; }
      if(handlers.click) handlers.click(f);
    });
  }
}).addTo(map);

/* Future Land Use gets its own pane ABOVE the scored parcels, with its own canvas, so the colors
   stay visible when toggled on — otherwise the parcel fills, redrawn each refresh, cover it.
   Click-through, so parcel clicks still reach the layer underneath. */
map.createPane('fluPane');
map.getPane('fluPane').style.zIndex = 450;
map.getPane('fluPane').style.pointerEvents = 'none';
export const fluLayer = L.geoJSON(null,{style:(f)=>fluStyle(f), interactive:false,
  pane:'fluPane', renderer:L.canvas({pane:'fluPane'})});

/* Selected-parcel highlight, on its own top pane and click-through, so the outline of the parcel
   you clicked stays visible while the sidebar is open. A white casing under a dark line keeps it
   readable over any fill (green/yellow/red/gray/blue). */
map.createPane('highlightPane');
map.getPane('highlightPane').style.zIndex = 460;
map.getPane('highlightPane').style.pointerEvents = 'none';
const _hlR = L.canvas({pane:'highlightPane'});
const highlightCasing = L.geoJSON(null,{interactive:false, pane:'highlightPane', renderer:_hlR,
  style:{color:'#ffffff', weight:5, opacity:0.95, fill:false}}).addTo(map);
const highlightLayer  = L.geoJSON(null,{interactive:false, pane:'highlightPane', renderer:_hlR,
  style:{color:'#111827', weight:2.5, opacity:1, fill:false}}).addTo(map);
export function setHighlight(f){
  try{ highlightCasing.clearLayers(); highlightLayer.clearLayers();
    if(f&&f.geometry){ highlightCasing.addData(f); highlightLayer.addData(f); } }catch(e){}
}
export function clearHighlight(){
  try{ highlightCasing.clearLayers(); highlightLayer.clearLayers(); }catch(e){}
}

/* Multi-select outline (Ctrl/Cmd-click): a persistent violet outline on the same top pane, so the
   whole assembled set stays visible while you keep clicking and while the analysis runs. */
const _selR = L.canvas({pane:'highlightPane'});
const selectionCasing = L.geoJSON(null,{interactive:false, pane:'highlightPane', renderer:_selR,
  style:{color:'#ffffff', weight:5, opacity:0.9, fill:false}}).addTo(map);
const selectionLayer  = L.geoJSON(null,{interactive:false, pane:'highlightPane', renderer:_selR,
  style:{color:'#7c3aed', weight:3, opacity:1, fillColor:'#7c3aed', fillOpacity:0.12}}).addTo(map);
export function renderSelectionOutline(features){
  try{ selectionCasing.clearLayers(); selectionLayer.clearLayers();
    (features||[]).forEach(f=>{ if(f&&f.geometry){ selectionCasing.addData(f); selectionLayer.addData(f); } });
  }catch(e){}
}

/* ---------------- Legends ---------------- */
const fluLegend = L.control({position:'bottomright'});
fluLegend.onAdd = function(){
  const div = L.DomUtil.create('div','flu-legend');
  let h = '<div class="flt">Future Land Use</div>';
  ["4","5","6","3","2","1","0","-1"].forEach(t=>{
    h += `<div class="flr"><span class="fls" style="background:${TIER_COLOR[t]}"></span>${TIER_LABEL[t]}</div>`;
  });
  div.innerHTML = h; return div;
};
let fluLegendOn=false;
export function setFluLegend(on){
  if(on && !fluLegendOn){ fluLegend.addTo(map); fluLegendOn=true; }
  else if(!on && fluLegendOn){ map.removeControl(fluLegend); fluLegendOn=false; }
}

export const utilLayer = L.layerGroup();
/* Four overlays can all be on at once, so they must differ by HUE and by LINE STYLE.
   City is a bold purple outline with almost no fill so it never competes with flood's blue fill;
   sewer is dashed teal (never a warm hue — it must not sit next to the brown hillside). */
export const UTIL_CITY_COLOR="#6a1b9a", UTIL_SEWER_COLOR="#00897b",
             UTIL_FLOOD_COLOR="#1565c0", UTIL_SLOPE_LINE="#8b4a1a", UTIL_SLOPE_FILL="#d2691e";
const utilLegend = L.control({position:'bottomleft'});
utilLegend.onAdd = function(){
  const div = L.DomUtil.create('div','flu-legend');
  div.innerHTML = '<div class="flt">Utilities &amp; site</div>'+
    `<div class="flr"><span class="fls" style="background:#fff;border:2.5px solid ${UTIL_CITY_COLOR}"></span>In city — municipal water + sewer</div>`+
    `<div class="flr"><span class="fls" style="background:${UTIL_SEWER_COLOR}33;border:1.5px dashed ${UTIL_SEWER_COLOR}"></span>Sewer district</div>`+
    `<div class="flr"><span class="fls" style="background:${UTIL_FLOOD_COLOR}"></span>FEMA floodplain (SFHA)</div>`+
    `<div class="flr"><span class="fls" style="background:repeating-linear-gradient(45deg,${UTIL_SLOPE_FILL},${UTIL_SLOPE_FILL} 3px,${UTIL_SLOPE_LINE} 3px,${UTIL_SLOPE_LINE} 5px)"></span>Hillside &gt;15% slope</div>`+
    `<div class="flr"><span class="fls" style="background:#fff"></span>Outside — well &amp; septic</div>`;
  return div;
};
let utilLegendOn=false;
export function setUtilLegend(on){
  if(on && !utilLegendOn){ utilLegend.addTo(map); utilLegendOn=true; }
  else if(!on && utilLegendOn){ map.removeControl(utilLegend); utilLegendOn=false; }
}

/* Steep-slope raster overlay from USGS 3DEP, for regions with no published hillside polygons.
   One exportImage request per view, rebuilt on refresh, on the click-through FLU pane. */
let slopeOverlay=null;
export function updateSlopeOverlay(region, show){
  if(!show || !region.slopeImg){
    if(slopeOverlay){ map.removeLayer(slopeOverlay); slopeOverlay=null; } return;
  }
  const steep=region.steepPct||15;
  const RR={rasterFunction:"Colormap",rasterFunctionArguments:{Colormap:[[1,176,124,80]],
    Raster:{rasterFunction:"Remap",rasterFunctionArguments:{InputRanges:[steep,10000],OutputValues:[1],
      NoDataRanges:[-10000,steep],
      Raster:{rasterFunction:"Slope",rasterFunctionArguments:{SlopeType:2,ZFactor:1}}}}}};
  const b=map.getBounds();
  const sw=map.options.crs.project(b.getSouthWest()), ne=map.options.crs.project(b.getNorthEast());
  const size=map.getSize();
  const url=region.slopeImg+"/exportImage?bbox="+[sw.x,sw.y,ne.x,ne.y].join(",")+
    "&bboxSR=3857&imageSR=3857&size="+size.x+","+size.y+"&format=png32&transparent=true&renderingRule="+
    encodeURIComponent(JSON.stringify(RR))+"&f=image";
  if(slopeOverlay) map.removeLayer(slopeOverlay);
  slopeOverlay=L.imageOverlay(url, b, {opacity:0.5, interactive:false, pane:'fluPane'}).addTo(map);
}

/* Point the map at a region: recenter, and swap the attribution to that region's data sources. */
export function applyRegionToMap(region){
  map.setView(region.center, region.zoom);
  baseLayer.getContainer && baseLayer.setUrl(basemapUrl());
  map.attributionControl.setPrefix('');
  if(baseLayer._attribution) map.attributionControl.removeAttribution(baseLayer._attribution);
  baseLayer._attribution = BASEMAP_ATTRIBUTION + ' • ' + region.attribution;
  map.attributionControl.addAttribution(baseLayer._attribution);
}
