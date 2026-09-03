/* valuation.js — highest-&-best-use valuation engine.

   ============================================================================
   ALL-EQUITY BY DESIGN. There is no financing, loan, or carry line anywhere.
   The discount rate already prices the cost of capital; adding an interest
   charge for time would charge for time twice. DO NOT add one back.
   ============================================================================

   Region-independent. Everything region-specific arrives through the `region` descriptor:
   county residential-density tables, city-granted mixed-use density, per-city lot values. */

import { DUV } from './classify.js';

export const SEPTIC_DU = 1.0;   // realistic max density on unserved well+septic land
const BUILD_YRS = 2;

/* ---------------- Inputs ---------------- */
export function inp(id, dflt){
  const el=document.getElementById(id); if(!el) return dflt;
  const v=+el.value; return isFinite(v)? v : dflt;
}
/* Reads the market-assumption panel. Defaults here are only a fallback for a missing input --
   the real per-region defaults live in each region's `inputs` block and are rendered into the
   panel at boot, so switching regions switches the assumptions. */
export function devInputs(){
  return {
    net:Math.max(5,inp('dNet',70))/100, years:Math.max(0.25,inp('dYears',2)),
    annexFt:inp('dAnnexFt',1320),   // annexation-path reach: city soft rate, but mains get extended
    horizLot:inp('dHorizLot',55000), horizComm:inp('dHorizComm',200000), horizInd:inp('dHorizInd',150000),
    lot:inp('dLot',130000), comm:inp('dComm',900000), ind:inp('dInd',700000), ag:inp('dAg',20000),
    // hurdles -- separate by product because they are different risks
    rLand:Math.max(0,inp('dRetLand',15))/100,   // land / lots / pads (build-to-sell), compounded
    rComm:Math.max(0,inp('dRetComm',8))/100,    // commercial + industrial rental hold, unlevered
    rApt:Math.max(0,inp('dRetApt',6))/100,      // apartment rental hold, unlevered
    // soft costs: % of REVENUE for build-to-sell, % of CONSTRUCTION for income deals
    softCity:inp('dSoftCity',18)/100, softCounty:inp('dSoftCounty',12)/100, softInc:inp('dSoftInc',25)/100,
    commission:inp('dCommission',6)/100,        // paid at CLOSING, not t0
    // utilities
    noSewer:inp('dNoSewer',45000), noWater:inp('dNoWater',20000),  // main extension, per developable acre
    well:inp('dWell',12000), septic:inp('dSeptic',8000),           // per LOT, outside the annexation path
    floodF:Math.max(1,inp('dFloodF',1.4)), slopeF:Math.max(1,inp('dSlopeF',1.5)),
    // income product inputs
    aptRent:inp('dAptRent',1500), aptBuild:inp('dAptBuild',220000), aptCap:inp('dAptCap',5.6)/100,
    aptVac:inp('dAptVac',5)/100, aptOpex:inp('dAptOpex',38)/100,
    cRent:inp('dCRent',24), cFar:inp('dCFar',0.25), cCap:inp('dCCap',6.6)/100,
    cBuild:inp('dCBuild',160), cVac:inp('dCVac',8)/100, cOpex:inp('dCOpex',5)/100,
    iRent:inp('dIRent',9.5), iFar:inp('dIFar',0.45), iCap:inp('dICap',7.5)/100,
    iBuild:inp('dIBuild',150), iVac:inp('dIVac',8)/100, iOpex:inp('dIOpex',3)/100,
    rentGrow:inp('dRentGrow',3)/100, exitBps:inp('dExitBps',25), costSale:inp('dCostSale',2)/100
  };
}

/* ---------------- Math helpers ---------------- */
export function pv(x,r,t){ return x/Math.pow(1+r,t); }
/* Unlevered IRR by bisection. cfs[t] indexed from t=0. */
export function irr(cfs){
  const f=r=>cfs.reduce((s,c,t)=>s+(c||0)/Math.pow(1+r,t),0);
  let lo=-0.95, hi=3, flo=f(lo), fhi=f(hi);
  if(!isFinite(flo)||!isFinite(fhi)||flo*fhi>0) return null;
  for(let i=0;i<160;i++){ const m=(lo+hi)/2, fm=f(m); if(flo*fm<=0){hi=m;fhi=fm;} else {lo=m;flo=fm;} }
  return (lo+hi)/2;
}
function cMultOf(d,cons){ return (cons.flood?d.floodF:1)*(cons.slope?d.slopeF:1); }

/* ---- Build-to-sell: finished residential lots (<= 8 du/ac only) ---- */
export function valLotSale(ctx){
  const {acres,d,cons,service,lotVal,du}=ctx;
  const units=Math.max(1,Math.round(acres*du));      // density is a GROSS max -> units off gross acres
  const revenue=units*lotVal;
  const commission=revenue*d.commission;             // ~6% paid at CLOSING -> net it BEFORE discounting
  const softRate=(service==="county")?d.softCounty:d.softCity;
  const otherSoft=revenue*Math.max(0,softRate-d.commission);   // remaining soft paid at t0
  const devAc=acres*d.net, cM=cMultOf(d,cons);
  // Charge only the mains this parcel actually lacks. A parcel inside a sewer district but outside
  // city water needs a water main, not both -- billing both was a real overstatement on Idaho's
  // Ada/Canyon sewer-district land, where sewer service extends past the city line.
  const miss = ctx.utilMissing || {sewer:true, water:true};
  let util=0, utilNote="in city — municipal water + sewer";
  if(service==="annex"){
    util=devAc*((miss.sewer?d.noSewer:0)+(miss.water?d.noWater:0));
    utilNote = (miss.sewer&&miss.water) ? "extend water + sewer mains (annexation path)"
             : miss.sewer ? "extend sewer main (water served)"
             : miss.water ? "extend water main (in sewer district)"
             : "mains already at the property";
  }
  else if(service==="county"){ util=units*(d.well+d.septic); utilNote="well + septic, per lot"; }
  const horizBase=units*d.horizLot;
  const horiz=horizBase*cM+util;
  const pvRev=pv(revenue-commission, d.rLand, d.years);
  return {product:"Finished lots (build to sell)", mode:"lot", units, dens:du, lotVal, devAc,
    revenue, grossValue:revenue, pvRevenue:pvRev, commission, soft:otherSoft,
    horiz, horizBase, horizConstraint:horizBase*(cM-1), horizExtra:util, utilNote,
    hurdle:d.rLand, offer:pvRev-horiz-otherSoft};
}

/* ---- Build-to-rent: 10-yr DCF. Land = the price that drives NPV to zero at the hurdle. ---- */
function btrCashflows(noi3, hardSoft, cap, d){
  const exitCap=cap+d.exitBps/10000;
  const cfs=new Array(11).fill(0);
  for(let t=1;t<=BUILD_YRS;t++) cfs[t]-=hardSoft/BUILD_YRS;   // construction spread over the build
  let noi=noi3;
  for(let t=3;t<=10;t++){ cfs[t]+=noi; if(t<10) noi*=(1+d.rentGrow); }
  const sale=(noi/exitCap)*(1-d.costSale);                    // sell yr10 at exit cap, less cost of sale
  cfs[10]+=sale;
  return {cfs, sale, exitCap, noi10:noi};
}
function valIncome(name, mode, noi3, hardSoft, cap, hurdle, d, extra){
  const {cfs,sale,exitCap}=btrCashflows(noi3,hardSoft,cap,d);
  let L=0; for(let t=1;t<cfs.length;t++) L+=pv(cfs[t],hurdle,t);   // NPV=0 => land = PV(all future cf)
  return Object.assign({product:name, mode, noi:noi3, hardSoft, cap, exitCap, sale, hurdle,
    offer:L, irrLandFree:irr(cfs), landClamped:L<0, grossValue:noi3/cap}, extra||{});
}
export function valApartmentBTR(ctx){
  const {acres,d,cons,aptDu}=ctx;
  const units=Math.max(1,Math.round(acres*aptDu)), devAc=acres*d.net;
  const hard=units*d.aptBuild, site=devAc*d.horizComm*cMultOf(d,cons), soft=hard*d.softInc;
  const gpr=units*d.aptRent*12, noi=gpr*(1-d.aptVac)*(1-d.aptOpex);
  return valIncome("Apartments (build to rent, 10 yr)","apartment",noi,hard+soft+site,d.aptCap,d.rApt,d,
    {units,dens:aptDu,devAc,hard,soft,site,gpr});
}
export function valApartmentMerchant(ctx){
  const {acres,d,cons,aptDu}=ctx;
  const units=Math.max(1,Math.round(acres*aptDu)), devAc=acres*d.net;
  const hard=units*d.aptBuild, site=devAc*d.horizComm*cMultOf(d,cons), soft=hard*d.softInc;
  const hardSoft=hard+soft+site;
  const gpr=units*d.aptRent*12, noi=gpr*(1-d.aptVac)*(1-d.aptOpex);
  const sale=(noi/d.aptCap)*(1-d.costSale);                  // stabilize + sell yr3
  const cfs=[0,-hardSoft/2,-hardSoft/2,sale];
  let L=0; for(let t=1;t<cfs.length;t++) L+=pv(cfs[t],d.rLand,t);   // priced at the LAND hurdle
  return {product:"Apartments (merchant: build & sell yr 3)",mode:"apartment_merchant",units,dens:aptDu,devAc,
    noi, grossValue:sale, sale, hurdle:d.rLand, offer:L, irrLandFree:irr(cfs), landClamped:L<0, hard, soft, site};
}
export function valIncomeCI(ctx, kind){
  const {acres,d,cons}=ctx, isInd=kind==="industrial";
  const far=isInd?d.iFar:d.cFar, rent=isInd?d.iRent:d.cRent, cap=isInd?d.iCap:d.cCap;
  const build=isInd?d.iBuild:d.cBuild, vac=isInd?d.iVac:d.cVac, opex=isInd?d.iOpex:d.cOpex;
  const horizAc=isInd?d.horizInd:d.horizComm;
  const devAc=acres*d.net, sf=devAc*43560*far;
  const hard=sf*build, site=devAc*horizAc*cMultOf(d,cons), soft=hard*d.softInc;
  const gpr=sf*rent, noi=gpr*(1-vac)*(1-opex);   // NNN: opex largely reimbursed, so the rate is small
  return valIncome(isInd?"Industrial (build to rent, 10 yr)":"Commercial (build to rent, 10 yr)",
    isInd?"industrial":"commercial", noi, hard+soft+site, cap, d.rComm, d, {sf,far,devAc,hard,soft,site,rent,gpr});
}
/* ---- Build-to-sell: commercial / industrial pad sale by the acre ---- */
export function valPadSale(ctx, kind){
  const {acres,d,cons,service}=ctx, isInd=kind==="industrial";
  const devAc=acres*d.net, landPerAc=isInd?d.ind:d.comm, horizAc=isInd?d.horizInd:d.horizComm;
  const revenue=devAc*landPerAc, commission=revenue*d.commission;
  const softRate=(service==="county")?d.softCounty:d.softCity;
  const otherSoft=revenue*Math.max(0,softRate-d.commission);
  // Pads need real mains either way -- but only the ones that are missing.
  const miss = ctx.utilMissing || {sewer:true, water:true};
  const util=(service==="city")?0:devAc*((miss.sewer?d.noSewer:0)+(miss.water?d.noWater:0));
  const horiz=devAc*horizAc*cMultOf(d,cons)+util;
  const pvRev=pv(revenue-commission,d.rLand,d.years);
  return {product:isInd?"Industrial pad sale":"Commercial pad sale", mode:isInd?"industrial_pad":"commercial_pad",
    devAc, revenue, grossValue:revenue, pvRevenue:pvRev, commission, soft:otherSoft, horiz,
    hurdle:d.rLand, offer:pvRev-horiz-otherSoft};
}
export function valRural(ctx){ const v=Math.max(0,ctx.acres*ctx.d.ag);
  return {product:"Rural / ag land (no project)",mode:"rural",revenue:v,grossValue:v,offer:v,hurdle:0}; }

/* ---- Which products does a designation permit? Price them ALL, then rank by max land offer. ---- */
export function productsFor(tier, du, ctx){
  if(tier==null||tier<0) return [];
  if(tier===0) return [valRural(ctx)];
  if(tier===4){ // MIXED USE permits BOTH housing and commercial; housing routes to apartments
    const c=Object.assign({},ctx,{aptDu:ctx.mixedDu});
    return [valApartmentBTR(c), valApartmentMerchant(c), valIncomeCI(ctx,"commercial"), valPadSale(ctx,"commercial")];
  }
  if(tier===5) return [valIncomeCI(ctx,"commercial"), valPadSale(ctx,"commercial")];
  if(tier===6) return [valIncomeCI(ctx,"industrial"), valPadSale(ctx,"industrial")];
  const dens = du>0? du : DUV.low;
  // STRICT ROUTING: <=8 du/ac sells finished lots; >8 du/ac is apartments. NEVER price high
  // density as detached lots -- 20 du/ac x a finished-lot value invents enormous phantom revenue.
  if(dens<=8) return [valLotSale(Object.assign({},ctx,{du:dens}))];
  const c=Object.assign({},ctx,{aptDu:dens});
  return [valApartmentBTR(c), valApartmentMerchant(c)];
}
