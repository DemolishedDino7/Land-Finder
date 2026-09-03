/* render.js — parcel colors and the parcel detail markup.

   Pure: it builds strings and style objects and touches no Leaflet or DOM state, so it can be
   used by the sidebar, and later by a server-side renderer, without dragging the map in.
   This replaced the old bindPopup content — same information, laid out for a tall sidebar
   instead of a 340px popup, so the priced-options table finally has room to breathe. */

import { TIER_COLOR } from './classify.js';
import { SEPTIC_DU } from './valuation.js';

export const COLORS={green:"#2e9e4f",yellow:"#e6b800",red:"#c0392b",gray:"#8a8f98",blue:"#2b7fc4"};
export const VERDICT_LABEL={green:"BUY AT ASK",yellow:"NEGOTIATE",red:"AVOID",
  gray:"NO DEV UPSIDE",blue:"NO VALUE DATA"};
const SERVICE_TXT={city:"In city — municipal water + sewer",
  annex:"Annexation path — city soft rate, mains extended",
  county:"County — well + septic per lot"};

export function featStyle(f){
  const s=f.__score; const c = s? COLORS[s.verdict] : "#999";
  // Comp-estimated parcels: dashed border + faded fill, so they read as "indicative, not assessed".
  if(s && s.estimated) return {color:"#7a5c1f",weight:1,dashArray:"3 3",fillColor:c,fillOpacity:0.38};
  return {color:"#39424d",weight:.6,fillColor:c,fillOpacity: s&&s.verdict==="gray"?0.18:0.55};
}
export function fluColor(f){ const t = f.luTier ? f.luTier.t : f.__tier; return TIER_COLOR[String(t)]||"#c9ccd4"; }
export function fluStyle(f){ const c=fluColor(f); return {color:c,weight:.6,fillColor:c,fillOpacity:.4}; }

const money=v=>v==null||!isFinite(v)?"—":"$"+Math.round(v).toLocaleString();
const pct=v=>v==null||!isFinite(v)?"—":(v*100).toFixed(1)+"%";
const escHtml=s=>(""+(s==null?"":s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* The whole parcel detail panel. `saved` says whether this parcel is already on the saved list,
   so the button can render in the right state. */
export function parcelDetailHtml(f, region, saved){
  const p=f.__pdata, s=f.__score, best=s.best;
  const flu = p.flu? p.flu.luLabel : "—";
  const pid = p.props.PARCEL||"";

  const saveBtn = `<button class="sb-save${saved?" on":""}" data-save="${escHtml(pid)}">
    ${saved?"★ Saved":"☆ Save this parcel"}</button>`;

  // Headline: this is a CEILING, not a prediction.
  const fairBlock = (s.verdict==="gray") ? "" : `
    <div class="pp-fair">
      <div class="pp-fair-k">Your maximum offer</div>
      <div class="big">${money(s.fairOffer)}</div>
      <div class="pp-fair-sub">${p.acres?money(s.fairOffer/p.acres)+"/acre":""} · via ${escHtml(best?best.product:"—")}</div>
    </div>`;

  // Every permitted option, ranked by max land offer, with gross value alongside so revenue/offer
  // divergences are visible — revenue and land value routinely disagree.
  const rows=(s.prods||[]).map(x=>{
    const isBest = best && x.product===best.product;
    const irrTxt = (x.irrLandFree!=null) ? pct(x.irrLandFree) : "—";
    const zeroNote = (x.offer<=0 && x.irrLandFree!=null)
      ? `<div class="pp-zero">land $0 — ${pct(x.hurdle)} hurdle exceeds the ${irrTxt} ceiling</div>` : "";
    return `<tr class="${isBest?'is-best':''}">
      <td>${escHtml(x.product)}${zeroNote}</td>
      <td class="num">${money(x.grossValue)}</td>
      <td class="num">${money(Math.max(0,x.offer))}</td>
      <td class="num dim">${pct(x.hurdle)}</td>
      <td class="num dim">${irrTxt}</td></tr>`;
  }).join("");
  const optBlock = (s.prods&&s.prods.length&&s.verdict!=="gray") ? `
    <div class="pp-h">Every permitted use, priced <span class="dim">(ranked by max offer)</span></div>
    <table class="pp-table">
      <thead><tr><th>Product</th><th class="num">Gross value</th><th class="num">Max offer</th>
        <th class="num">Hurdle</th><th class="num">IRR*</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="note">*Unlevered IRR with the land free — the ceiling on the deal. Options priced at
    <b>different hurdles are not apples-to-apples</b>: a lower-hurdle product wins partly because
    it is judged against a softer bar.</div>` : "";

  // Detail on the winning product
  const isLot = best && best.mode==="lot";
  const detail = !best||best.mode==="rural" ? "" : `
    <div class="pp-h">${escHtml(best.product)} — takeoff</div>
    <div class="pp-grid">
      ${isLot? `<div>Density (gross max)</div><div><b>${(+best.dens).toFixed(1)} du/acre</b></div>
        <div>Est. lots</div><div><b>${best.units}</b> on ${p.acres?p.acres.toFixed(2):"—"} ac</div>
        <div>Finished lot value</div><div>${money(best.lotVal)}${s.lotFromCity?` <span class="dim">(city mkt)</span>`:""}</div>
        <div>Gross lot revenue</div><div>${money(best.revenue)}</div>
        <div>– Commission @ closing</div><div>${money(best.commission)}</div>
        <div>PV of net revenue</div><div>${money(best.pvRevenue)}</div>
        <div>– Horizontal</div><div>${money(best.horiz)} <span class="dim">(${escHtml(best.utilNote)})</span></div>
        <div>– Other soft</div><div>${money(best.soft)}</div>` : ""}
      ${best.mode==="apartment"||best.mode==="apartment_merchant"? `<div>Units</div><div><b>${best.units}</b> @ ${(+best.dens).toFixed(1)} du/ac</div>
        <div>Stabilized NOI</div><div>${money(best.noi)}</div>
        <div>Construction + soft</div><div>${money(best.hardSoft||(best.hard+best.soft+best.site))}</div>` : ""}
      ${best.mode==="commercial"||best.mode==="industrial"? `<div>Building SF</div><div><b>${Math.round(best.sf).toLocaleString()}</b> @ FAR ${best.far}</div>
        <div>NNN rent</div><div>$${best.rent}/sf/yr</div>
        <div>Stabilized NOI</div><div>${money(best.noi)}</div>
        <div>Going-in / exit cap</div><div>${pct(best.cap)} / ${pct(best.exitCap)}</div>
        <div>Construction + soft</div><div>${money(best.hardSoft)}</div>` : ""}
      ${best.mode&&best.mode.endsWith("_pad")? `<div>Developable acres</div><div>${best.devAc.toFixed(2)} of ${p.acres?p.acres.toFixed(2):"—"}</div>
        <div>Pad revenue</div><div>${money(best.revenue)}</div>
        <div>– Horizontal</div><div>${money(best.horiz)}</div>` : ""}
      <div>= Max land offer</div><div><b>${money(Math.max(0,best.offer))}</b></div>
    </div>`;

  const cc=s.cons||{};
  const floodTxt = cc.flood ? `<b style="color:${'#1565c0'}">Floodplain</b>${p.floodZone?" (FEMA "+escHtml(p.floodZone)+")":""}` : "";
  const slopeTxt = (p.slopePct!=null)
      ? (p.slope ? `<b style="color:#8c6d3f">Hillside ~${p.slopePct}% grade (steep, +site cost)</b>` : `slope ~${p.slopePct}% (buildable)`)
      : (cc.slope ? `<b style="color:#8c6d3f">Hillside &gt;15% slope</b>` : "");
  const consText = [floodTxt, slopeTxt].filter(Boolean).join(" · ")
      || (p.slopePct!=null ? "None detected" : "None (turn on the Utilities &amp; site view to check slope)");
  const npvColor = (s.npvAtMarket!=null && s.npvAtMarket>=0) ? COLORS.green : COLORS.red;
  const discount = (s.verdict==="yellow" && s.price)
    ? `<div class="note">Needs a <b>${money(s.price-s.fairOffer)}</b> price cut
       (<b>${((1-s.ratio)*100).toFixed(0)}%</b> below the ask) to clear your hurdle.</div>` : "";
  const blueNote = (s.verdict==="blue")
    ? `<div class="note blue"><b>No assessed value on this parcel.</b> It is deliberately not scored
       green/yellow/red — a missing value is not a free parcel. Add a <code>price</code> override to score it.</div>` : "";
  const cliff = (isLot && best.dens>6.5)
    ? `<div class="note">Near the <b>8 du/ac routing cliff</b>: the lot model funds no vertical
       construction, so it will always dwarf an income product just above the threshold. That
       discontinuity is a modeling artifact, not a market fact.</div>` : "";

  // County residential-density block for UNINCORPORATED land — "how much density could I put here"
  const crd=s.crd;
  const countyBlock = (s.service!=="city" && crd) ? `
    <div class="pp-h">Unincorporated ${escHtml(s.county)} County — residential density by right</div>
    <div class="pp-grid">
      <div>Densest single-family</div><div><b>${(+crd.sf).toFixed(2)} du/ac</b> <span class="dim">(${escHtml(crd.zone)}, ${escHtml(crd.lot)})</span></div>
      <div>On this parcel</div><div><b>${s.countyDuEff!=null?(+s.countyDuEff).toFixed(2)+" du/ac":"—"}</b> <span class="dim">(${s.service==="county"?"well+septic — capped ~"+SEPTIC_DU+"/ac":"served — full zone"})</span></div>
      <div>Rural-residential</div><div>${(+crd.rr).toFixed(2)} du/ac</div>
      <div>Agricultural floor</div><div>${(+crd.ag).toFixed(3)} du/ac</div>
      <div>Multifamily</div><div>${crd.mf>0?("up to "+crd.mf+" du/ac"):'<span class="dim">not permitted outside cities</span>'}</div>
    </div>
    <div class="note">Small-lot SF zones generally need public water+sewer; on well+septic, county
    health departments hold density near ${SEPTIC_DU} du/ac. Source: ${escHtml(s.county)} County zoning ordinance.</div>` : "";

  return `
    <div class="sb-head">
      <div>
        <div class="pp-title">${escHtml(p.props.ADDRESS||"(no address)")}</div>
        <div class="pp-sub">Parcel ${escHtml(pid||"—")} · ${escHtml(p.props.CITY_STATE||region.short)}</div>
      </div>
      <button class="sb-close" data-close="1" title="Close (Esc)">✕</button>
    </div>
    <span class="pp-verdict" style="background:${COLORS[s.verdict]}">${VERDICT_LABEL[s.verdict]}${(s.verdict==="green"||s.verdict==="yellow"||s.verdict==="red")?` · offer = ${s.score}% of ${s.estimated?"est.":"ask"}`:""}</span>
    ${saveBtn}
    ${s.overridden?`<div class="note ind"><b>Manual override applied</b> for this parcel.</div>`:""}
    ${s.protectedLand?`<div class="note grn"><b>Protected / public land — not developable.</b> Protected status can never be overridden.</div>`:""}
    ${s.estimated?`<div class="note est"><b>Comp estimate (dashed outline) · ${escHtml((s.estConf||"").toUpperCase())} confidence</b> — no assessor value on file, so value is imputed at a median <b>${money(s.estPerAcre)}/acre</b> of land via <b>${escHtml(s.estMethod||"nearby comps")}</b>. ${s.estConf==="low"?"County-wide median — coarse; ":""}The verdict is <b>indicative, not assessed</b>.</div>`:""}
    ${fairBlock}
    <div class="pp-grid">
      <div>${s.estimated?"Est. value (comps)":"Asking / assessed"}</div><div><b>${s.hasValue?money(s.price):'<span style="color:'+COLORS.blue+'">no value data</span>'}${s.estimated?' <span class="est-tag">EST</span>':''}</b></div>
      <div>NPV at ${s.estimated?"est.":"that"} price</div><div><b style="color:${npvColor}">${(s.verdict==="gray"||!s.hasValue)?"—":money(s.npvAtMarket)}</b></div>
      <div>Acres</div><div>${p.acres? p.acres.toFixed(2):"—"}</div>
      <div>Assessor class</div><div>${escHtml(p.props.ZONING||"—")}</div>
      <div>Future land use</div><div>${escHtml(flu)}</div>
      <div>Service</div><div>${SERVICE_TXT[s.service]||"—"}</div>
      <div>Site constraints</div><div>${consText}</div>
    </div>
    ${blueNote}${discount}
    ${countyBlock}
    ${optBlock}
    ${detail}
    ${cliff}
    <div class="note">All-equity: no financing or carry is modeled anywhere. The hurdle already
    prices the cost of capital.</div>`;
}
