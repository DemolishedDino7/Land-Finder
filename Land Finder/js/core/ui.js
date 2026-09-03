/* ui.js — the market-assumptions panel, the toolbar tabs, the saved list and the detail sidebar.

   The panel is GENERATED from the schema below plus the active region's `inputs` block, rather
   than hand-written twice in HTML. That is what makes switching states cheap: same field ids and
   same engine, different numbers, and a region can add per-city lot fields without touching markup. */

import { parcelDetailHtml, COLORS, VERDICT_LABEL } from './render.js';
import * as saved from './saved.js';
import { setHighlight, clearHighlight, map } from './map.js';

/* Every editable market assumption, in the order it appears in the panel. `s` = step. */
export const FIELD_GROUPS = [
  {title:"Land takeoff &amp; dev costs", fields:[
    ["dHorizLot","Horizontal — residential ($/lot)",5000],
    ["dHorizComm","Horizontal — commercial ($/dev acre)",10000],
    ["dHorizInd","Horizontal — industrial ($/dev acre)",10000],
    ["dNet","Net developable factor (%)",5],
    ["dYears","Years to sell out (build-to-sell)",0.5],
    ["dAnnexFt","Annexation path reach (ft)",120],
  ]},
  {title:"Densities (units per acre)", fields:[
    ["dDenLow","Low density",1],["dDenMed","Medium density",1],["dDenMH","Medium-high",1],
    ["dDenHigh","High density",1],["dDenMixed","Mixed use",1],
  ], note:"Medium density and below = <b>sell finished lots</b>. Anything above it, and <b>all mixed use</b>, = apartments."},
  {title:"Finished lot values ($/lot)", fields:[["dLot","Default (any other city)",5000]], cityLots:true},
  {title:"Land sale values", fields:[
    ["dComm","Commercial pad ($/dev acre)",25000],["dInd","Industrial pad ($/dev acre)",25000],
    ["dAg","Rural / ag ($/acre)",1000],
  ]},
  {title:"Hurdle rates (%)", fields:[
    ["dRetLand","Land / lots / pads (build to sell)",0.5],
    ["dRetComm","Commercial + industrial hold",0.25],
    ["dRetApt","Apartment hold",0.25],
  ], note:"Different products carry different risk, so they are judged against different bars. That also means their max offers are <b>not apples-to-apples</b>."},
  {title:"Soft costs (%)", fields:[
    ["dSoftCity","In city / annexation path (% of revenue)",1],
    ["dSoftCounty","County (% of revenue)",1],
    ["dSoftInc","Income deals (% of construction)",1],
    ["dCommission","Sales commission (% at closing)",0.5],
  ]},
  {title:"Utilities", fields:[
    ["dNoSewer","Extend sewer main ($/dev acre)",5000],["dNoWater","Extend water main ($/dev acre)",5000],
    ["dWell","Well ($/lot)",1000],["dSeptic","Septic ($/lot)",1000],
  ]},
  {title:"Site constraint cost factors", fields:[
    ["dFloodF","Floodplain multiplier",0.1],["dSlopeF","Steep slope multiplier",0.1],
  ]},
  {title:"Apartments", fields:[
    ["dAptRent","Rent ($/unit/mo)",50],["dAptBuild","Build ($/unit)",5000],["dAptCap","Going-in cap (%)",0.1],
    ["dAptVac","Vacancy (%)",1],["dAptOpex","Opex (% of EGI)",1],
  ]},
  {title:"Commercial", fields:[
    ["dCRent","NNN rent ($/sf/yr)",1],["dCFar","FAR",0.05],["dCCap","Going-in cap (%)",0.1],
    ["dCBuild","Build ($/sf)",10],["dCVac","Vacancy (%)",1],["dCOpex","Opex (% of EGI)",1],
  ]},
  {title:"Industrial", fields:[
    ["dIRent","NNN rent ($/sf/yr)",0.5],["dIFar","FAR",0.05],["dICap","Going-in cap (%)",0.1],
    ["dIBuild","Build ($/sf)",10],["dIVac","Vacancy (%)",1],["dIOpex","Opex (% of EGI)",1],
  ]},
  {title:"Growth &amp; exit", fields:[
    ["dRentGrow","NOI growth (%/yr)",0.5],["dExitBps","Exit cap premium (bps)",5],
    ["dCostSale","Cost of sale (%)",0.5],
  ]},
];

/* All ids the panel can produce, so app.js can wire change listeners in one pass. */
export function allFieldIds(region){
  const ids=[];
  FIELD_GROUPS.forEach(g=>{
    g.fields.forEach(f=>ids.push(f[0]));
    if(g.cityLots) (region.cityLotFields||[]).forEach(c=>ids.push(c.id));
  });
  return ids;
}

export function buildPanel(region){
  const host=document.getElementById('assumptions');
  const v = id => (region.inputs && region.inputs[id]!=null) ? region.inputs[id] : "";
  host.innerHTML = FIELD_GROUPS.map(g=>{
    let rows = g.fields.map(([id,label,step])=>
      `<div class="row"><label for="${id}">${label}</label><input type="number" id="${id}" value="${v(id)}" step="${step}"></div>`).join("");
    if(g.cityLots){
      rows += (region.cityLotFields||[]).map(c=>
        `<div class="row"><label for="${c.id}">${c.label}</label><input type="number" id="${c.id}" value="${c.value}" step="5000"></div>`).join("");
    }
    return `<div class="card"><h2>${g.title}</h2>${rows}${g.note?`<div class="note">${g.note}</div>`:""}</div>`;
  }).join("");
}

/* ---------------- Toolbar tabs ---------------- */
export function initTabs(){
  const tabs=[...document.querySelectorAll('.tab')];
  const panes=[...document.querySelectorAll('.pane')];
  tabs.forEach(t=>t.addEventListener('click',()=>{
    tabs.forEach(x=>x.classList.toggle('on', x===t));
    const want=t.getAttribute('data-tab');
    panes.forEach(p=>p.classList.toggle('on', p.getAttribute('data-pane')===want));
  }));
}
export function showTab(name){
  const t=document.querySelector(`.tab[data-tab="${name}"]`);
  if(t) t.click();
}

/* ---------------- Parcel detail sidebar (replaces the old map popup) ---------------- */
let currentFeature=null, onSaveToggle=null, onFlyTo=null;
export function initSidebar(opts){
  onSaveToggle = opts.onSaveToggle; onFlyTo = opts.onFlyTo;
  const el=document.getElementById('detail');
  el.addEventListener('click', async (e)=>{
    const close=e.target.closest('[data-close]');
    if(close){ closeDetail(); return; }
    const sv=e.target.closest('[data-save]');
    if(sv && currentFeature && onSaveToggle){ await onSaveToggle(currentFeature); refreshDetail(); }
  });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeDetail(); });
}
let detailRegion=null;
export function showDetail(f, region){
  currentFeature=f; detailRegion=region;
  const el=document.getElementById('detail');
  el.innerHTML = parcelDetailHtml(f, region, saved.isSaved(f.__pdata.props.PARCEL, region.id));
  el.scrollTop=0;
  document.body.classList.add('detail-open');
  setHighlight(f);
  // The map pane got narrower — tell Leaflet, or the tiles tear along the new edge.
  setTimeout(()=>map.invalidateSize({pan:false}), 210);
}
export function refreshDetail(){ if(currentFeature && detailRegion) {
  const el=document.getElementById('detail');
  const keep=el.scrollTop;
  el.innerHTML=parcelDetailHtml(currentFeature, detailRegion, saved.isSaved(currentFeature.__pdata.props.PARCEL, detailRegion.id));
  el.scrollTop=keep;
} }
export function closeDetail(){
  if(!document.body.classList.contains('detail-open')) return;
  currentFeature=null;
  document.body.classList.remove('detail-open');
  clearHighlight();
  setTimeout(()=>map.invalidateSize({pan:false}), 210);
}
export function detailFeature(){ return currentFeature; }

/* ---------------- Saved parcels tab ---------------- */
const money=v=>v==null||!isFinite(v)?"—":"$"+Math.round(v).toLocaleString();
const escHtml=s=>(""+(s==null?"":s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export function renderSaved(region){
  const host=document.getElementById('savedList'); if(!host) return;
  const rows=saved.forRegion(region.id).sort((a,b)=>b.savedAt-a.savedAt);
  const other=saved.all().length-rows.length;
  const countEl=document.getElementById('savedCount');
  if(countEl){ countEl.textContent=rows.length||""; countEl.style.display=rows.length?"":"none"; }
  if(!rows.length){
    host.innerHTML=`<div class="empty">
      <b>No saved parcels in ${escHtml(region.short)} yet.</b>
      <div>Click a parcel on the map, then <b>☆ Save this parcel</b> in the detail panel.</div>
      ${other?`<div class="dim">${other} saved in the other region — switch states to see ${other>1?"them":"it"}.</div>`:""}
    </div>`;
    return;
  }
  host.innerHTML = rows.map(r=>`
    <div class="sv" data-id="${escHtml(r.id)}">
      <div class="sv-top">
        <span class="sv-dot" style="background:${COLORS[r.verdict]||'#999'}" title="${escHtml(VERDICT_LABEL[r.verdict]||'')}"></span>
        <button class="sv-addr" data-go="${escHtml(r.id)}" title="Show on the map">${escHtml(r.address)}</button>
        <button class="sv-x" data-rm="${escHtml(r.id)}" title="Remove">✕</button>
      </div>
      <div class="sv-meta">${escHtml(r.use)} · ${(+r.acres||0).toFixed(2)} ac${r.estimated?' · <span class="est-tag">EST</span>':''}</div>
      <div class="sv-nums">
        <span>Max offer <b>${money(r.fairOffer)}</b></span>
        <span class="dim">Ask ${money(r.price)}</span>
      </div>
      <input class="sv-note" data-note="${escHtml(r.id)}" value="${escHtml(r.note||'')}" placeholder="Add a note…">
    </div>`).join("") +
    `<div class="note">Numbers are a <b>snapshot from when you saved</b> — they don't move when you
     change the market assumptions. Saved lists live in this browser only until accounts are wired up.</div>
     <button class="btn ghost" id="savedClear">Clear all saved</button>`;

  host.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>saved.remove(b.getAttribute('data-rm'), region.id));
  host.querySelectorAll('[data-note]').forEach(i=>i.onchange=()=>saved.setNote(i.getAttribute('data-note'), region.id, i.value));
  host.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{
    const rec=rows.find(x=>x.id===b.getAttribute('data-go'));
    if(rec && rec.centroid && onFlyTo) onFlyTo(rec);
  });
  const c=document.getElementById('savedClear');
  if(c) c.onclick=()=>{ if(confirm("Remove every saved parcel in both regions?")) saved.clearAll(); };
}
