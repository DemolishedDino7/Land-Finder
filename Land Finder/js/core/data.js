/* data.js — remote fetching, spatial joins and geometry helpers.
   Region-independent. Each region supplies its own `fetchParcels` (the parcel services differ
   fundamentally between states) and declares its FLU / utility / constraint layers as config,
   which the generic fetchers below drive.

   Mutable in-view state lives on the exported `store` object rather than as exported `let`
   bindings, so every module reads the same values after a refresh. */

import { detectFluField, fluPlanDensity, intensity } from './classify.js';

export const store = {
  parcels: [],      // scored parcels in view
  flu: [],          // fetched future-land-use polygons in view
  cities: [],       // city-limit polygons in view
  sewers: [],       // sewer-district polygons in view
  impacts: [],      // areas of city impact (Idaho annexation path)
  flood: [],        // FEMA SFHA polygons in view
  slope: [],        // published hillside (>15% slope) polygons in view
  own: [],          // agency-owned land (right of way) -> undevelopable
  zoningJoin: [],   // zoning polygons for regions whose parcels carry no zoning field
  seq: 0            // request sequence; a newer refresh invalidates an older one in flight
};
export function nextSeq(){ return ++store.seq; }
export function stale(seq){ return seq !== store.seq; }

export function esc(u){ return encodeURIComponent(u); }
export function bboxOf(map){
  const b = map.getBounds();
  return [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(",");
}
const GEO = bbox => "&geometry="+esc(bbox)+"&geometryType=esriGeometryEnvelope&inSR=4326"+
  "&spatialRel=esriSpatialRelIntersects&outSR=4326&returnGeometry=true&f=geojson&resultRecordCount=2000";

/* One ArcGIS query -> GeoJSON features with geometry, [] on any failure. A layer that 404s or
   blocks CORS must never take the whole refresh down with it. */
export function arcQuery(url, bbox, where, outFields){
  if(!url) return Promise.resolve([]);
  const u = url+"?where="+esc(where||"1=1")+GEO(bbox)+"&outFields="+esc(outFields||"*");
  return fetch(u).then(r=>r.json()).then(j=>(j.features||[]).filter(f=>f.geometry)).catch(()=>[]);
}

/* PAGINATE. A single 2,000-record page is not enough in dense areas, and some counties return
   their attribute-less "shell" parcels FIRST -- so a one-page query in a dense downtown fills up
   with no-value shells and truncates the actually-valued parcels past the cap. Page with
   resultOffset until the server stops flagging exceededTransferLimit (or we hit the page cap). */
export async function fetchPaged(url, bbox, outFields, maxPages){
  maxPages = maxPages||5;   // 5 x 2000 = up to 10k features per layer in view
  const base=url+"?where="+esc("1=1")+GEO(bbox)+"&outFields="+esc(outFields||"*");
  let feats=[], offset=0, capped=false;
  for(let page=0; page<maxPages; page++){
    let j; try{ j=await fetch(base+"&resultOffset="+offset).then(r=>r.json()); }catch(e){ break; }
    const fs=(j.features||[]); feats=feats.concat(fs);
    const ex=j.exceededTransferLimit||(j.properties&&j.properties.exceededTransferLimit);
    if(!ex || fs.length<2000) break;                 // got everything
    if(page===maxPages-1){ capped=true; break; }     // hit the page cap, more remain
    offset+=2000;
  }
  return {feats, capped};
}

/* ---------------- Generic layer fetchers, driven by region config ---------------- */

/* Only query an FLU layer if it has no `ext` (always-on) or its extent overlaps the view.
   Without that gate every region would fire all of its city layers on every pan. */
export async function fetchFLU(region, bbox, seq){
  const [w,s,e,n]=bbox.split(",").map(Number);
  const layers=(region.fluLayers||[]).filter(c=> !c.ext || (c.ext[0]<=e && c.ext[2]>=w && c.ext[1]<=n && c.ext[3]>=s));
  const arrs = await Promise.all(layers.map(cfg =>
    arcQuery(cfg.url, bbox).then(fs=>{ fs.forEach(f=>{ f.__cfg=cfg; }); return fs; })));
  if(stale(seq)) return null;
  return arrs.flat();
}
export async function fetchUtil(region, bbox, seq){
  const cityJobs=(region.cityLimitsUrls||[]).map(u=>arcQuery(u,bbox));
  const [cityArrs, sewers, impacts] = await Promise.all([
    Promise.all(cityJobs), arcQuery(region.sewerUrl,bbox), arcQuery(region.impactUrl,bbox)]);
  if(stale(seq)) return null;
  return {cities:cityArrs.flat(), sewers, impacts};
}
export async function fetchConstraints(region, bbox, seq){
  // FEMA: only Special Flood Hazard Areas (SFHA_TF='T'); if it fails, no flood factor is applied.
  const [flood, slope] = await Promise.all([
    arcQuery(region.floodUrl, bbox, "SFHA_TF='T'"),
    arcQuery(region.hillsideUrl, bbox)]);
  if(stale(seq)) return null;
  return {flood, slope};
}
export async function fetchOwnership(region, bbox, seq){
  const arrs = await Promise.all((region.ownLayers||[]).map(cfg =>
    arcQuery(cfg.url, bbox).then(fs=>{
      fs.forEach(f=>{ f.__agency=cfg.agency; });
      return fs.filter(f=>f.geometry.type==="Polygon"||f.geometry.type==="MultiPolygon");
    })));
  if(stale(seq)) return null;
  return arrs.flat();
}

/* Derive % slope from USGS 3DEP elevation, for regions with no published hillside polygon layer.
   Samples a 5-point cross (~20 m arms) per parcel and takes the gradient magnitude -> % grade.
   Batched at 190 parcels (950 points) to stay under the 1,000-sample POST cap. */
export async function fetchSlopes(region, parcels, seq){
  if(!region.slopeImg) return;
  const cap=region.slopeMaxParcels||570, steep=region.steepPct||15;
  const list=(parcels||[]).filter(p=>p.centroid && p.slopePct===undefined).slice(0,cap);
  if(!list.length) return;
  const dm=0.00022, mLat=111320, BATCH=190;
  const batches=[];
  for(let i=0;i<list.length;i+=BATCH) batches.push(list.slice(i,i+BATCH));
  await Promise.all(batches.map(async chunk=>{
    const pts=[];
    chunk.forEach(p=>{ const [lon,lat]=p.centroid; pts.push([lon,lat],[lon+dm,lat],[lon-dm,lat],[lon,lat+dm],[lon,lat-dm]); });
    let vals=null;
    try{
      const body=new URLSearchParams({geometry:JSON.stringify({points:pts,spatialReference:{wkid:4326}}),
        geometryType:"esriGeometryMultipoint", returnFirstValueOnly:"true", f:"json"});
      const j=await fetch(region.slopeImg+"/getSamples",{method:"POST",
        headers:{'Content-Type':'application/x-www-form-urlencoded'}, body}).then(r=>r.json());
      vals=(j.samples||[]).map(s=>+s.value);
    }catch(e){ vals=null; }
    if(stale(seq) || !vals || vals.length<chunk.length*5) return;
    chunk.forEach((p,k)=>{ const b=k*5, c=vals[b],e=vals[b+1],w=vals[b+2],n=vals[b+3],s=vals[b+4];
      if([c,e,w,n,s].some(v=>!isFinite(v))) return;
      const lat=p.centroid[1];
      const dx=(e-w)/(2*dm*mLat*Math.cos(lat*Math.PI/180));
      const dy=(n-s)/(2*dm*mLat);
      const pct=Math.sqrt(dx*dx+dy*dy)*100;
      p.slopePct=+pct.toFixed(1); p.slope = pct>=steep;
    });
  }));
}

/* ---------------- Spatial helpers ---------------- */
export function polyHit(centroid, feats){
  if(!centroid) return null; const pt = turf.point(centroid);
  for(const f of feats){ try{ if(turf.booleanPointInPolygon(pt, f)) return f; }catch(e){} }
  return null;
}
/* Shortest distance (m) from a point to the nearest city-limit boundary. Drives the annexation-path
   test: soft rate and utilities follow SERVICE, not the city line. */
export function distToCityM(centroid, cities){
  if(!centroid || !cities || !cities.length) return null;
  const pt=turf.point(centroid); let best=null;
  for(const c of cities){
    try{
      const g=c.geometry; if(!g) continue;
      const polys = g.type==="MultiPolygon" ? g.coordinates : [g.coordinates];
      for(const poly of polys) for(const ring of poly){
        const d=turf.pointToLineDistance(pt, turf.lineString(ring), {units:"meters"});
        if(best==null || d<best) best=d;
      }
    }catch(e){}
  }
  return best;
}
export function acresOf(feature, props){
  let a = Number(props.ACRES); if(a && a>0) return a;
  try{ return turf.area(feature)/4046.8564224; }catch(e){ return 0; }
}
export function centroidOf(feature){ try{ return turf.centroid(feature).geometry.coordinates; }catch(e){ return null; } }

/* Normalize fetched FLU features: resolve the designation field, the plan's published density,
   and the tier. Region is passed through so the protected-word rules apply correctly. */
export function normalizeFlu(features, region){
  return (features||[]).filter(f=>f.geometry).map(f=>{
    const cfg=f.__cfg||{}; const field=detectFluField(f.properties||{}, cfg);
    f.luLabel = field ? f.properties[field] : null;
    f.luDen   = fluPlanDensity(f.properties||{}, cfg);   // plan's published max du/acre, if any
    f.luTier  = intensity(f.luLabel, region);
    return f;
  });
}

/* A PROTECTED polygon must beat any overlapping designation, including a hand-traced override.
   Taking the first point-in-polygon hit would let a coarse traced district bury a park's
   designation and score it as developable, so scan every hit and let tier -1 win outright.
   Traced polygons are checked first (they are the finer, adopted-plan source). */
export function fluFor(centroid, region){
  if(!centroid) return null; const pt = turf.point(centroid);
  let first=null;
  for(const f of (region.tracedFlu||[]).concat(store.flu)){
    try{
      if(turf.booleanPointInPolygon(pt, f)){
        if(f.luTier && f.luTier.t===-1) return f;   // protected wins immediately
        if(!first) first=f;                          // otherwise keep the highest-priority hit
      }
    }catch(e){}
  }
  return first;
}
