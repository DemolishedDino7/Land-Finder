/* estimate.js — comp-based value estimate for parcels with no assessor value.

   Only runs for regions that expose `estimate.enabled` (today: Utah, whose LIR schema publishes
   LAND_MKT_VALUE per parcel). Many Utah counties ship "shell" parcels, and some never populated
   the value field at all. Rather than leave a developable parcel unscored, impute a LAND value
   and score against it — tiered, and always flagged, never silently green:
     high — >=3 valued comps within ~1.3 km (same city preferred)
     med  — >=3 valued comps within ~5 km
     low  — county-wide median land $/acre (last resort)
   Estimated parcels draw dashed and faded: a proxy, NOT assessor data. */

import { store, esc } from './data.js';
import { thresholds } from './scoring.js';

const COUNTY_LAND_PERAC = {};   // per-county median land $/acre, fetched once and cached

export async function ensureCountyBaselines(region, bbox){
  const cfg = region.estimate;
  if(!cfg || !cfg.enabled) return;
  const suffixes = cfg.countiesInView(bbox) || [];
  await Promise.all(suffixes.map(async suffix=>{
    if(COUNTY_LAND_PERAC["__"+suffix]) return;
    COUNTY_LAND_PERAC["__"+suffix]=true;   // mark attempted -- don't retry on empty/failure
    try{
      const u=cfg.lirUrl(suffix)+"?where="+esc("LAND_MKT_VALUE>0 AND PARCEL_ACRES>0")+
        "&outFields="+esc("LAND_MKT_VALUE,PARCEL_ACRES,COUNTY_NAME")+
        "&returnGeometry=false&resultRecordCount=2000&f=json";
      const j=await fetch(u).then(r=>r.json());
      const fs=(j.features||[]).map(f=>f.attributes||{});
      if(fs.length<20) return;
      const name=(""+(fs[0].COUNTY_NAME||"")).replace(/\s*county\s*$/i,"").trim().toUpperCase();
      const pa=fs.map(a=>a.LAND_MKT_VALUE/a.PARCEL_ACRES).filter(v=>isFinite(v)&&v>0).sort((a,b)=>a-b);
      if(pa.length<20 || !name) return;
      COUNTY_LAND_PERAC[name]={perAcre:pa[Math.floor(pa.length/2)], n:pa.length};
    }catch(e){}
  }));
}

export function estimateNoValueParcels(region){
  if(!region.estimate || !region.estimate.enabled) return;
  const on = document.getElementById('tEstimate');
  if(on && !on.checked) return;
  const parcels = store.parcels;
  if(parcels.length>12000) return;              // perf guard for extreme-density views
  const comps=[];
  parcels.forEach(p=>{ const s=p.feature.__score;
    if(s && s.hasValue && !s.estimated && p.acres>0 && p.centroid){
      const lv = Number(p.props.LAND_MKT_VALUE)>0 ? Number(p.props.LAND_MKT_VALUE) : Number(s.price);
      if(lv>0) comps.push({lon:p.centroid[0], lat:p.centroid[1], perAcre:lv/p.acres, city:p.city});
    }
  });
  const {green:gT, yellow:yT} = thresholds();
  const R1=0.014, R2=0.05, MINC=3, KMAX=15;     // ~1.3 km and ~5 km boxes
  parcels.forEach(p=>{ const s=p.feature.__score;
    if(!s || s.verdict!=="blue" || !(p.acres>0) || !p.centroid) return;   // only developable no-value parcels
    let med=null, n=0, conf=null, method=null;
    if(comps.length>=MINC){
      const near=[];
      for(const c of comps){
        const dl=c.lon-p.centroid[0], da=c.lat-p.centroid[1];
        if(Math.abs(dl)>R2 || Math.abs(da)>R2) continue;
        near.push({d:dl*dl+da*da, perAcre:c.perAcre, city:c.city, within1:(Math.abs(dl)<=R1&&Math.abs(da)<=R1)});
      }
      const sc1=near.filter(x=>x.within1 && x.city && x.city===p.city);
      const any1=near.filter(x=>x.within1);
      let use=null;
      if(sc1.length>=MINC){ use=sc1; conf="high"; }
      else if(any1.length>=MINC){ use=any1; conf="high"; }
      else if(near.length>=MINC){ use=near; conf="med"; }
      if(use){ use.sort((a,b)=>a.d-b.d); use=use.slice(0,KMAX);
        const arr=use.map(x=>x.perAcre).sort((a,b)=>a-b);
        med=arr[Math.floor(arr.length/2)]; n=use.length;
        method=n+" comps "+(conf==="high"?"≤1.3 km":"≤5 km")+(sc1.length>=MINC?", same city":""); }
    }
    if(med==null){   // last resort: county-wide median land $/acre
      const base=COUNTY_LAND_PERAC[p.props.COUNTY];
      if(base){ med=base.perAcre; n=base.n; conf="low"; method=(p.props.COUNTY||"county")+" county median ("+base.n+" parcels)"; }
    }
    if(!(med>0)) return;
    const est=med*p.acres, ratio=s.fairOffer/est;
    s.estimated=true; s.estPerAcre=med; s.estComps=n; s.estConf=conf; s.estMethod=method;
    s.price=est; s.hasValue=true; s.ratio=ratio; s.npvAtMarket=s.fairOffer-est;
    s.score=Math.round(Math.min(300,ratio*100));
    s.verdict = ratio>=gT?"green":ratio>=yT?"yellow":"red";
  });
}
