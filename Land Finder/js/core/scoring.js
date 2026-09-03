/* scoring.js — highest & best use, then max offer vs asking/assessed price -> a verdict.
   Region-independent. County density tables, per-city lot values, city mixed-use density and
   per-parcel overrides all come from the active region descriptor. */

import { DUV, intensity, zoningSignal } from './classify.js';
import { devInputs, productsFor, valLotSale, valApartmentBTR, valApartmentMerchant, SEPTIC_DU } from './valuation.js';

export function thresholds(){
  const g=document.getElementById('tGreen'), y=document.getElementById('tYellow');
  return { green:(g?+g.value:100)/100, yellow:(y?+y.value:85)/100 };
}

export function scoreParcel(p, region){
  const d=devInputs();
  const ov = (region.overrides && region.overrides[p.props.PARCEL]) || {};
  const zi = zoningSignal(ov.zoning || p.props.ZONING, region);       // assessor class (current use)
  let fi = intensity(ov.flu || (p.flu? p.flu.luLabel : null), region); // adopted plan / zoning layer
  if(fi && fi.du>0 && p.flu && p.flu.luDen>0) fi={t:fi.t,label:fi.label,du:p.flu.luDen};
  // Protected from EITHER zoning or the plan. Protected can never be overridden.
  const protectedLand = (fi&&fi.t===-1) || (zi&&zi.t===-1) || !!p.owned;

  const acres=p.acres||0;
  const cons={flood:!!p.flood, slope:!!p.slope};
  const service=p.service||"city";
  const cityLotVal = region.cityLot ? region.cityLot(p.city) : null;
  const lotVal = ov.lotVal || cityLotVal || d.lot;
  const lotFromCity = !ov.lotVal && cityLotVal!=null;
  const mixedDu = (region.cityMixedDu && region.cityMixedDu[p.city]) || DUV.mixed;
  // Which mains are missing, so an annexation-path parcel is only charged for what it lacks.
  // Set explicitly by each region's annotate() -- NOT derived from p.util, whose fields mean
  // different things in the two regions. Absent it, assume both mains must be extended.
  const utilMissing = p.utilMissing || {sewer:true, water:true};
  const ctx={acres,d,cons,service,lotVal,mixedDu,utilMissing};

  // County residential density on UNINCORPORATED land. Served land can reach the county's densest
  // by-right SF zone; unserved well+septic land is held to SEPTIC_DU. Regions without a county
  // ordinance table (Idaho, for now) simply get null and fall back to the generic default.
  const crd = region.countyRes ? region.countyRes(p.props.COUNTY) : null;
  const countyDuServed = crd ? crd.sf : null;
  const countyDuEff = crd ? (service==="county" ? Math.min(crd.sf, SEPTIC_DU) : crd.sf) : null;

  let prods=[], desigsInfo=[];
  if(!protectedLand && acres>0){
    const desigs=[zi,fi].filter(x=>x&&x.t>=0);
    if(desigs.length===0){
      const du = (service!=="city" && countyDuEff) ? countyDuEff : DUV.low;
      desigs.push({t: du>8?3:1, du,
        label: (service!=="city" && crd) ? `${p.props.COUNTY} County ${crd.zone} — ${(+du).toFixed(2)} du/ac` : "No designation — assumed low-density"});
    }
    // On unincorporated land a generic/low residential signal (assessor "Residential", or the flat
    // default) is really governed by county zoning, so use the county's effective density -- which
    // may be higher (served land, full SF zone) or lower (well+septic, capped near 1/ac) than the
    // generic guess. A specific medium/high plan designation (tier 2+) is left untouched.
    if(service!=="city" && countyDuEff){
      desigs.forEach(x=>{ if(x.t===1 && (!x.du || x.du<=DUV.low)){ x.du=countyDuEff; x.__countyDu=true; } });
    }
    desigs.forEach(x=>{ prods=prods.concat(productsFor(x.t, x.du, ctx)); });
    // Entitled lot count is GROUND TRUTH: overrides zoning and plan, and entitles ag land.
    if(ov.units>0){
      const dens=ov.units/acres;
      prods=prods.concat(dens<=8 ? [valLotSale(Object.assign({},ctx,{du:dens}))]
                                 : [valApartmentBTR(Object.assign({},ctx,{aptDu:dens})),
                                    valApartmentMerchant(Object.assign({},ctx,{aptDu:dens}))]);
    }
    // dedupe by product name, keeping the better offer
    const seen={}; prods.forEach(x=>{ if(!seen[x.product]||x.offer>seen[x.product].offer) seen[x.product]=x; });
    prods=Object.values(seen).sort((a,b)=>b.offer-a.offer);
    desigsInfo = desigs.map(x=>({t:x.t, du:x.du||0}));   // for multi-parcel assemblage analysis
  }
  const best = prods.length? prods[0] : null;
  const developable = !protectedLand && !!best && best.mode!=="rural" && best.offer>0;
  const fairOffer = best? Math.max(0,best.offer) : 0;

  // NEVER let a missing assessed value read as "free" -- it painted every such parcel green.
  const rawPrice = ov.price>0 ? ov.price : Number(p.props.TOTALVALUE);
  const price = (isFinite(rawPrice) && rawPrice>0) ? rawPrice : null;
  const hasValue = price!=null;
  const ratio = hasValue && price>0 ? fairOffer/price : null;
  const npvAtMarket = hasValue ? fairOffer-price : null;

  const {green:gT, yellow:yT} = thresholds();
  let verdict;
  if(!developable) verdict="gray";
  else if(!hasValue) verdict="blue";            // NO VALUE DATA -- never scores green/yellow/red
  else if(ratio>=gT) verdict="green";
  else if(ratio>=yT) verdict="yellow";
  else verdict="red";
  const score = (hasValue && ratio!=null) ? Math.round(Math.min(300,ratio*100)) : null;
  const useLabel = best? best.product : (protectedLand? "Protected / public" : "—");
  const desigLabel = (fi&&fi.label) || (zi&&zi.label) || "—";
  return {score, verdict, prods, best, tk:best, fairOffer, npvAtMarket, ratio, price, hasValue,
    assessed:price, useLabel, desigLabel, protectedLand, service, cons, lotFromCity,
    county:p.props.COUNTY, crd, countyDuServed, countyDuEff,
    desigs:desigsInfo, lotVal, mixedDu, acres,            // exposed for multi-parcel assemblage
    owned:!!p.owned, ownedBy:p.ownedBy, overridden:!!(ov.units||ov.price||ov.zoning||ov.flu||ov.lotVal)};
}
