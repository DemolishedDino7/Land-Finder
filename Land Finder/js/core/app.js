/* app.js — orchestration, region switching, UI wiring, boot. */

import { REGIONS, regionById } from '../regions/index.js';
import { setDU, DUV } from './classify.js';
import { devInputs, productsFor } from './valuation.js';
import { scoreParcel } from './scoring.js';
import { store, nextSeq, stale, bboxOf, fetchFLU, fetchUtil, fetchConstraints, fetchOwnership,
         fetchSlopes, arcQuery, polyHit, acresOf, centroidOf, normalizeFlu, fluFor } from './data.js';
import { ensureCountyBaselines, estimateNoValueParcels } from './estimate.js';
import { COLORS } from './render.js';
import { map, parcelLayer, fluLayer, utilLayer, handlers, setFluLegend, setUtilLegend,
         updateSlopeOverlay, applyRegionToMap, renderSelectionOutline, clearHighlight,
         UTIL_CITY_COLOR, UTIL_SEWER_COLOR, UTIL_FLOOD_COLOR, UTIL_SLOPE_LINE, UTIL_SLOPE_FILL } from './map.js';
import * as ui from './ui.js';
import * as saved from './saved.js';

const REGION_KEY="landfinder.region";
let region = regionById((()=>{ try{ return localStorage.getItem(REGION_KEY); }catch(e){ return null; } })());

const $ = id => document.getElementById(id);
const spin=()=>$('spin'), statusEl=()=>$('status');
function setStatus(h){ statusEl().innerHTML=h; }
function refreshDU(){
  const n=id=>{ const el=$(id); return el? (+el.value||0):0; };
  setDU({low:n('dDenLow'), med:n('dDenMed'), mh:n('dDenMH'), high:n('dDenHigh'), mixed:n('dDenMixed')});
}
function tally(){
  const c={green:0,yellow:0,red:0,gray:0,blue:0};
  store.parcels.forEach(p=>{ const v=p.feature.__score.verdict; if(c[v]!=null) c[v]++; });
  return c;
}
function statusLine(prefix){
  const c=tally();
  return `${prefix}<br>`+
    `<span style="color:${COLORS.green}">■</span> ${c.green} good · `+
    `<span style="color:${COLORS.yellow}">■</span> ${c.yellow} negotiable · `+
    `<span style="color:${COLORS.red}">■</span> ${c.red} overpriced · `+
    `<span style="color:${COLORS.gray}">■</span> ${c.gray} n/a · `+
    `<span style="color:${COLORS.blue}">■</span> ${c.blue} no value`;
}

/* ---------------- Refresh cycle ---------------- */
async function refresh(){
  const z=map.getZoom();
  if(z<region.minZoomOverlay){
    parcelLayer.clearLayers(); fluLayer.clearLayers(); utilLayer.clearLayers();
    setFluLegend(false); setUtilLegend(false); updateSlopeOverlay(region,false);
    store.parcels=[];
    setStatus(`Zoom to <b>${region.minZoomOverlay}+</b> for land-use / utility layers, <b>${region.minZoom}+</b> to score parcels. Zoom ${z}.`);
    return;
  }
  const wantParcels = z>=region.minZoom;
  const seq=nextSeq(), bbox=bboxOf(map);
  refreshDU();
  spin().classList.add('on');
  setStatus(wantParcels?"Loading parcels, land use &amp; utilities…":"Loading land use &amp; utilities…");
  try{
    const zj = (wantParcels && region.zoningJoin)
      ? arcQuery(region.zoningJoin.url, bbox, "1=1", region.zoningJoin.field) : Promise.resolve([]);
    const [pj, flu, util, cons, zoningJoin, own] = await Promise.all([
      wantParcels? region.fetchParcels(bbox, seq) : Promise.resolve(null),
      fetchFLU(region,bbox,seq), fetchUtil(region,bbox,seq), fetchConstraints(region,bbox,seq),
      zj, wantParcels? fetchOwnership(region,bbox,seq) : Promise.resolve([])]);
    if(stale(seq)) return;

    store.zoningJoin = zoningJoin||[];
    store.own        = own||[];
    store.cities  = (util&&util.cities)||[];
    store.sewers  = (util&&util.sewers)||[];
    store.impacts = (util&&util.impacts)||[];
    store.flood   = (cons&&cons.flood)||[];
    store.slope   = (cons&&cons.slope)||[];

    // Utilities + site-constraint overlay
    utilLayer.clearLayers();
    const showUtil=$('tUtil').checked;
    if(showUtil){
      const add=(feats,style)=>L.geoJSON({type:"FeatureCollection",features:feats},{interactive:false,style}).addTo(utilLayer);
      add(store.cities, {color:UTIL_CITY_COLOR,weight:2.2,fillColor:UTIL_CITY_COLOR,fillOpacity:.04});
      add(store.sewers, {color:UTIL_SEWER_COLOR,weight:1.4,dashArray:"4 3",fillColor:UTIL_SEWER_COLOR,fillOpacity:.16});
      add(store.flood,  {color:UTIL_FLOOD_COLOR,weight:0.5,fillColor:UTIL_FLOOD_COLOR,fillOpacity:.26});
      add(store.slope,  {color:UTIL_SLOPE_LINE,weight:0.5,fillColor:UTIL_SLOPE_FILL,fillOpacity:.3});
      utilLayer.addTo(map);
    } else map.removeLayer(utilLayer);
    setUtilLegend(showUtil);
    updateSlopeOverlay(region, showUtil);   // derived steep-slope raster, where a region needs it

    store.flu = normalizeFlu(flu||[], region);
    fluLayer.clearLayers();
    // Fetched layers first, then the hand-traced local plans on top, so the overlay matches the
    // scoring — which checks the traced polygons first.
    const drawFeats = store.flu.concat(region.tracedFlu||[]);
    const showFlu=$('tFLU').checked && drawFeats.length;
    if(showFlu){ fluLayer.addData({type:"FeatureCollection",features:drawFeats}); fluLayer.addTo(map); }
    else map.removeLayer(fluLayer);
    setFluLegend($('tFLU').checked);

    if(!wantParcels){
      parcelLayer.clearLayers(); store.parcels=[];
      setStatus(`Showing land use &amp; utilities. Zoom to <b>${region.minZoom}+</b> to load &amp; score parcels. Zoom ${z}.`);
      spin().classList.remove('on'); return;
    }

    const d=devInputs();
    const feats=(pj&&pj.features)||[];
    store.parcels=feats.filter(f=>f.geometry).map(f=>{
      const props=f.properties||{}; const acres=acresOf(f,props);
      const tv=Number(props.TOTALVALUE)||0;
      return {feature:f, props, acres, vpa:acres>0? tv/acres : null, centroid:centroidOf(f),
              city:(props.CITY_STATE||"").split(",")[0].trim().toUpperCase(),
              flu:null, novalue:!!f.__novalue};
    });
    store.parcels.forEach(p=>{
      const hit=fluFor(p.centroid, region);
      if(hit){ p.flu={luLabel:hit.luLabel, luDen:hit.luDen}; }
      // Site constraints, shared by every region
      const fh=polyHit(p.centroid, store.flood);
      p.flood=!!fh; p.floodZone = fh ? (fh.properties&&(fh.properties.FLD_ZONE||fh.properties.fld_zone)) : null;
      p.slope=!!polyHit(p.centroid, store.slope);
      const oh=polyHit(p.centroid, store.own);
      p.owned=!!oh; p.ownedBy = oh ? oh.__agency : null;
      // Region-specific joins: service model, zoning joins
      region.annotate(p, d);
    });

    if(region.estimate && region.estimate.enabled && (!$('tEstimate') || $('tEstimate').checked)){
      await ensureCountyBaselines(region, bbox);
      if(stale(seq)) return;
    }
    drawParcels();
    setStatus(statusLine(`<b>${store.parcels.length}</b> parcels scored${(pj&&pj.capped)?" (capped — zoom in for full coverage)":""}.`));

    // Slope only matters (and only costs elevation requests) when the site-constraints view is on.
    // Sample in the BACKGROUND so parcels appear immediately, then re-score and recolor steep ones.
    if(region.slopeImg && $('tUtil') && $('tUtil').checked){
      fetchSlopes(region, store.parcels, seq).then(()=>{
        if(!stale(seq)){ drawParcels(); if(selection.size) renderCompare(); ui.refreshDetail(); }
      });
    }
  }catch(e){ setStatus("Error loading data: "+e.message+". Try zooming or panning again."); }
  finally{ spin().classList.remove('on'); }
}

function enabledVerdicts(){
  const c=id=>{ const el=$(id); return el? el.checked : true; };
  return {green:c('fGreen'), yellow:c('fYellow'), red:c('fRed'), gray:c('fGray'), blue:c('fBlue')};
}
function applyFilter(){
  parcelLayer.clearLayers();
  if(!$('tParcels').checked) return;
  const en=enabledVerdicts();
  const feats=store.parcels.filter(p=>p.feature.__score && en[p.feature.__score.verdict]).map(p=>p.feature);
  parcelLayer.addData({type:"FeatureCollection",features:feats});
}
function drawParcels(){
  if(!store.parcels.length){ parcelLayer.clearLayers(); return; }
  refreshDU();
  store.parcels.forEach(p=>{ p.feature.__pdata=p; p.feature.__score=scoreParcel(p, region); });
  estimateNoValueParcels(region);
  applyFilter();
}
function reScoreOnly(){
  drawParcels();
  setStatus(statusLine(`<b>${store.parcels.length}</b> parcels re-scored.`));
  if(selection.size) renderCompare();
  ui.refreshDetail();
}

/* ---------------- Multi-select assemblage (Ctrl / Cmd-click) ----------------
   Ctrl/Cmd-click parcels to build a set, then treat them as ONE assembled site. We show two
   things: the SUM of the parcels' individual max offers, and an ASSEMBLAGE valuation that re-runs
   the engine on the combined developable acreage at the best use any parcel permits — because
   adjacent parcels developed together are usually worth more (or less) than the sum of the parts. */
const selection = new Map();
function selKey(f){ const p=f.__pdata||{}; return (p.props&&p.props.PARCEL) || (p.centroid?p.centroid.join(","):Math.random()); }
function median(a){ if(!a.length) return null; const s=a.slice().sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; }
function toggleSelect(f){
  const k=selKey(f);
  if(selection.has(k)) selection.delete(k); else selection.set(k,{f, p:f.__pdata});
  renderSelectionOutline([...selection.values()].map(v=>v.f));
  renderCompare();
  if(selection.size) ui.showTab('compare');
}
function clearSelection(){ selection.clear(); renderSelectionOutline([]); renderCompare(); }
function assembleSelection(){
  const d=devInputs();
  const rows=[...selection.values()].map(({p})=>({p, s:scoreParcel(p, region)}));
  let totAc=0, devAc=0, sumOffer=0, sumOfferDev=0, sumPrice=0, nEst=0, nPriced=0, nProt=0;
  let bestTier=-1, bestDu=0; const services=[], lotVals=[], mixedDus=[]; let flood=false, slope=false;
  rows.forEach(({p,s})=>{
    const ac=p.acres||0; totAc+=ac; sumOffer+=s.fairOffer||0;
    if(s.hasValue){ sumPrice+=s.price||0; nPriced++; if(s.estimated) nEst++; }
    if(s.protectedLand){ nProt++; return; }
    if(s.best && s.best.mode!=="rural"){
      devAc+=ac; sumOfferDev+=s.fairOffer||0;
      (s.desigs||[]).forEach(x=>{ if(x.t>bestTier || (x.t===bestTier && (x.du||0)>bestDu)){ bestTier=x.t; bestDu=x.du||0; } });
      services.push(s.service); if(s.lotVal) lotVals.push(s.lotVal); if(s.mixedDu) mixedDus.push(s.mixedDu);
      if(s.cons&&s.cons.flood) flood=true; if(s.cons&&s.cons.slope) slope=true;
    }
  });
  let asm=null;
  if(devAc>0 && bestTier>=0){
    const svc = services.includes("city")?"city":services.includes("annex")?"annex":"county";
    const ctx={acres:devAc, d, cons:{flood,slope}, service:svc,
      utilMissing: svc==="city"?{sewer:false,water:false}:{sewer:true,water:true},
      lotVal: median(lotVals)||d.lot, mixedDu: Math.max.apply(null,[DUV.mixed].concat(mixedDus))};
    const prods=productsFor(bestTier, bestDu, ctx).sort((a,b)=>b.offer-a.offer);
    if(prods.length) asm={product:prods[0].product, offer:Math.max(0,prods[0].offer), devAc, service:svc};
  }
  return {rows, n:selection.size, totAc, devAc, sumOffer, sumOfferDev, sumPrice, nEst, nPriced, nProt, asm};
}
function setSelAsk(parcelId, val){
  if(!parcelId) return;
  const ov = region.overrides[parcelId] || (region.overrides[parcelId]={});
  const n = parseFloat((""+val).replace(/[^0-9.]/g,""));
  if(isFinite(n) && n>0) ov.price=n; else delete ov.price;
  if(!Object.keys(ov).length) delete region.overrides[parcelId];
  reScoreOnly();
}
const M=v=>v==null||!isFinite(v)?"—":"$"+Math.round(v).toLocaleString();
const esc2=s=>(""+(s==null?"":s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const SHORT={"Finished lots (build to sell)":"Lots","Apartments (build to rent, 10 yr)":"Apts BTR",
  "Apartments (merchant: build & sell yr 3)":"Apts merch","Commercial (build to rent, 10 yr)":"Comm BTR",
  "Industrial (build to rent, 10 yr)":"Indust BTR","Commercial pad sale":"Comm pad",
  "Industrial pad sale":"Indust pad","Rural / ag land (no project)":"Rural"};
function renderCompare(){
  const el=$('compareList'); if(!el) return;
  const badge=$('compareCount');
  if(badge){ badge.textContent=selection.size||""; badge.style.display=selection.size?"":"none"; }
  if(selection.size===0){
    el.innerHTML=`<div class="empty"><b>Nothing selected.</b>
      <div><b>Ctrl-click</b> (⌘-click on a Mac) parcels on the map to compare them, and to price
      them as one assembled site.</div></div>`;
    return;
  }
  const a=assembleSelection();
  const prem = a.asm ? a.asm.offer - a.sumOfferDev : null;
  const rowsHtml=a.rows.map(({p,s})=>{
    const id=p.props&&p.props.PARCEL;
    const addr=(p.props&&p.props.ADDRESS)||("Parcel "+(id||"?"));
    const use=s.best?(SHORT[s.best.product]||s.best.product):(s.protectedLand?"Protected":"—");
    const gap=(s.hasValue)?(s.fairOffer-s.price):null;
    return `<tr>
      <td><span class="sel-dot" style="background:${COLORS[s.verdict]}"></span></td>
      <td class="sel-addr" title="${esc2(addr)}">${esc2(addr)}<div class="sel-meta">${esc2(use)} · ${(p.acres||0).toFixed(2)} ac${s.estimated?' · <span class="est-tag">EST</span>':''}</div></td>
      <td class="num">${M(s.fairOffer)}</td>
      <td class="num">${id?`<input class="sel-ask" data-k="${esc2(id)}" value="${s.hasValue?Math.round(s.price):""}" placeholder="${s.estimated?"est":"—"}" title="Type an asking price; blank = assessed">`:'<span class="dim">n/a</span>'}</td>
      <td class="num" style="color:${gap==null?'#8a8f98':(gap>=0?COLORS.green:COLORS.red)}">${gap==null?'—':(gap>=0?'+':'')+M(gap)}</td>
      <td><button class="sel-x" data-x="${esc2(id||'')}" title="remove">✕</button></td></tr>`;
  }).join("");
  el.innerHTML=`
    <div class="sel-head"><b>${a.n} parcel${a.n>1?"s":""} selected</b><button id="selClear">clear ✕</button></div>
    <table class="sel-table">
      <thead><tr><th></th><th>Parcel</th><th class="num">Max offer</th><th class="num">Asking</th><th class="num">Gap</th><th></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr><td></td>
        <td><b>Totals</b><div class="sel-meta">${a.totAc.toFixed(2)} ac${a.nProt?` · ${a.nProt} protected`:""}</div></td>
        <td class="num"><b>${M(a.sumOffer)}</b></td>
        <td class="num"><b>${M(a.sumPrice)}</b>${a.nPriced<a.n?`<div class="sel-meta" style="color:${COLORS.blue}">${a.n-a.nPriced} no-value</div>`:""}</td>
        <td class="num"><b style="color:${(a.sumOffer-a.sumPrice)>=0?COLORS.green:COLORS.red}">${(a.sumOffer-a.sumPrice)>=0?'+':''}${M(a.sumOffer-a.sumPrice)}</b></td>
        <td></td></tr></tfoot>
    </table>
    ${a.asm?`
      <div class="sel-sub">Assembled as one site — ${a.devAc.toFixed(2)} developable ac, ${a.asm.service}</div>
      <div class="pp-grid">
        <div>Best combined use</div><div><b>${esc2(a.asm.product)}</b></div>
        <div>Assembled max offer</div><div><b>${M(a.asm.offer)}</b></div>
        <div>Assembly premium</div><div><b style="color:${prem>=0?COLORS.green:COLORS.red}">${prem>=0?"+":""}${M(prem)}</b> <span class="dim">vs parts</span></div>
      </div>`:`<div class="sel-sub dim">No developable acreage selected — nothing to assemble.</div>`}
    <div class="note">Type an asking price into any row to re-score it live (blank = assessed).
    Assembled at the best use any selected parcel permits, on combined developable acres —
    optimistic, and not apples-to-apples across hurdles.</div>`;
  const c=$('selClear'); if(c) c.onclick=clearSelection;
  el.querySelectorAll('.sel-ask').forEach(i=>{
    i.addEventListener('change',()=>setSelAsk(i.getAttribute('data-k'), i.value));
    i.addEventListener('click',e=>e.stopPropagation());
  });
  el.querySelectorAll('.sel-x').forEach(b=>b.addEventListener('click',()=>{
    const k=b.getAttribute('data-x');
    for(const [key,v] of selection){ if(((v.p.props&&v.p.props.PARCEL)||"")===k){ selection.delete(key); break; } }
    renderSelectionOutline([...selection.values()].map(v=>v.f)); renderCompare();
  }));
}

/* ---------------- Region switching ---------------- */
function applyRegion(r, firstBoot){
  region = r;
  try{ localStorage.setItem(REGION_KEY, r.id); }catch(e){}
  if(!r.tracedFlu || !r.tracedFlu.length) r.init();
  document.querySelectorAll('.region-btn').forEach(b=>b.classList.toggle('on', b.getAttribute('data-region')===r.id));
  $('regionName').textContent = r.name;
  // Estimation is region-dependent — hide the toggle where there is no land-value field to comp on.
  const estRow=$('estimateRow'); if(estRow) estRow.style.display = (r.estimate&&r.estimate.enabled)?"":"none";
  ui.buildPanel(r);
  wireFieldListeners();
  clearSelection(); ui.closeDetail(); clearHighlight();
  store.parcels=[]; parcelLayer.clearLayers(); fluLayer.clearLayers(); utilLayer.clearLayers();
  ui.renderSaved(r);
  applyRegionToMap(r);
  if(!firstBoot) refresh();   // on boot, moveend from setView triggers the first refresh
}
let fieldsWired=[];
function wireFieldListeners(){
  fieldsWired.forEach(([el,fn])=>el.removeEventListener('change',fn));
  fieldsWired=[];
  ui.allFieldIds(region).forEach(id=>{
    const el=$(id); if(!el) return;
    const fn=()=>reScoreOnly();
    el.addEventListener('change',fn); fieldsWired.push([el,fn]);
  });
}

/* ---------------- Boot ---------------- */
function boot(){
  ui.initTabs();
  ui.initSidebar({
    onSaveToggle: async (f)=>{ await saved.toggle(f.__pdata, f.__score, region); },
    onFlyTo: (rec)=>{ map.setView([rec.centroid[1], rec.centroid[0]], Math.max(map.getZoom(), region.minZoom)); }
  });
  saved.onChange(()=>{ ui.renderSaved(region); ui.refreshDetail(); });
  saved.load();

  handlers.click     = (f)=>ui.showDetail(f, region);
  handlers.ctrlClick = (f)=>toggleSelect(f);

  document.querySelectorAll('.region-btn').forEach(b=>
    b.addEventListener('click',()=>{
      const r=regionById(b.getAttribute('data-region'));
      if(r.id!==region.id) applyRegion(r);
    }));

  ["tGreen","tYellow"].forEach(id=>{
    const el=$(id), out=$(id+"V");
    el.addEventListener('input',()=>{ if(out) out.textContent=el.value; });
    el.addEventListener('change',reScoreOnly);
  });
  $('reScore').addEventListener('click',reScoreOnly);
  $('tParcels').addEventListener('change',applyFilter);
  $('tFLU').addEventListener('change',refresh);
  $('tUtil').addEventListener('change',refresh);
  { const te=$('tEstimate'); if(te) te.addEventListener('change',reScoreOnly); }
  ["fGreen","fYellow","fRed","fGray","fBlue"].forEach(id=>{
    const el=$(id); if(el) el.addEventListener('change',applyFilter); });
  $('fOnlyGreen').addEventListener('click',()=>{
    ["fYellow","fRed","fGray","fBlue"].forEach(id=>$(id).checked=false);
    $('fGreen').checked=true; applyFilter();
  });
  $('fAll').addEventListener('click',()=>{
    ["fGreen","fYellow","fRed","fGray","fBlue"].forEach(id=>$(id).checked=true); applyFilter();
  });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && selection.size) clearSelection(); });

  let deb;
  map.on('moveend',()=>{ clearTimeout(deb); deb=setTimeout(refresh,300); });

  applyRegion(region, true);
  refresh();
}
boot();
