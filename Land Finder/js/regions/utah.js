/* utah.js — statewide Utah region: all 29 counties via UGRC LIR tax-roll parcels.

   Everything Utah-specific lives here. The engine in js/core/ never mentions a state. */

import { arcQuery, fetchPaged, esc, polyHit, distToCityM, store } from '../core/data.js';
import { intensity } from '../core/classify.js';
import { UT_COUNTIES, countiesInView } from './utah-counties.js';
import { BEAVER_ZONES } from './utah-beaver-zones.js';

const WFRC = "https://services1.arcgis.com/taguadKoI1XFwivx/arcgis/rest/services";
/* Parcels: UGRC LIR tax-roll data, one hosted layer per county, identical schema. We query only
   the counties whose padded bounding box overlaps the view (usually 1, sometimes 2). */
const PARCEL_BASE = "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services";
export function lirUrl(suffix){ return PARCEL_BASE+"/Parcels_"+suffix+"_LIR/FeatureServer/0/query"; }

export const utah = {
  id:"ut", name:"Utah — statewide", short:"Utah",
  center:[40.66,-111.90], zoom:11,           // Salt Lake Valley (Wasatch Front)
  minZoom:15, minZoomOverlay:12,
  attribution:'Parcels: UGRC LIR / Utah County Assessors',

  /* Utah adds nothing to the shared protected list, and deliberately leaves GREENBELT, PRESERV
     and RECREATION OUT of it -- they are ag/assessor terms here, not open space. See the note at
     the top of core/classify.js. */
  classify:{ protectedExtra:[], protectedEq:[] },

  fluLayers:[
    {name:"Wasatch Front (WFRC/MAG 2025)",
     url:WFRC+"/Generalized_Future_Land_Use_(MAG_and_WFRC_2025)/FeatureServer/0/query",
     field:"GenLUType", denField:"MaxDUA"},
    // Individual cities beyond the WFRC/MAG footprint. Each is bbox-gated (ext) so it only fires
    // when that area is in view.
    {name:"Cedar City",     url:"https://services9.arcgis.com/VNuhornHiZVI8AVM/arcgis/rest/services/Cedar_City_Zoning/FeatureServer/2/query", field:"GP_LANDUSE",  ext:[-113.16,37.59,-112.99,37.76]},
    {name:"Tooele City",    url:"https://services3.arcgis.com/3PP5uLqByhZNekjG/arcgis/rest/services/LandUse/FeatureServer/0/query",            field:"LandUseTyp",  ext:[-112.36,40.48,-112.23,40.59]},
    {name:"Washington City",url:"https://services2.arcgis.com/NdghJNs5zewWZRy3/arcgis/rest/services/General_Land_Use_View/FeatureServer/0/query", field:"LANDUSEDESC", ext:[-113.56,37.07,-113.41,37.19]},
    {name:"Grantsville",    url:"https://services1.arcgis.com/nSnGtAgSmNZcvEzK/arcgis/rest/services/Grantsville_General_Plan_Land_Use/FeatureServer/1/query", field:"Land_Use", ext:[-112.53,40.55,-112.39,40.66]},
    {name:"Nephi",          url:"https://services.arcgis.com/pA2nEVnB6tquxgOW/arcgis/rest/services/Future_Land_Use/FeatureServer/3/query",     field:"LandUseType", ext:[-111.89,39.65,-111.77,39.77]},
    {name:"Moab (zoning)",  url:"https://services1.arcgis.com/ISzBYs4kLsuCgjOn/arcgis/rest/services/City_Zoning/FeatureServer/2/query",        field:"ZONE_CODE",   ext:[-109.61,38.52,-109.50,38.63]},
    // Self-hosted county ArcGIS Servers — CORS verified. Zoning used as an FLU proxy where the
    // city/county publishes no future-land-use layer. All bbox-gated to their own area.
    {name:"St. George (Washington Co. zoning)",  url:"https://agisprodvm.washco.utah.gov/arcgis/rest/services/Zoning/MapServer/11/query", field:"GEN_ZONE", ext:[-113.72,36.99,-113.46,37.21]},
    {name:"Hurricane (Washington Co. zoning)",   url:"https://agisprodvm.washco.utah.gov/arcgis/rest/services/Zoning/MapServer/5/query",  field:"GEN_ZONE", ext:[-113.37,37.08,-113.18,37.27]},
    {name:"Santa Clara (Washington Co. zoning)", url:"https://agisprodvm.washco.utah.gov/arcgis/rest/services/Zoning/MapServer/12/query", field:"GEN_ZONE", ext:[-113.70,37.10,-113.60,37.18]},
    {name:"Ivins (Washington Co. zoning)",       url:"https://agisprodvm.washco.utah.gov/arcgis/rest/services/Zoning/MapServer/6/query",  field:"GEN_ZONE", ext:[-113.73,37.13,-113.63,37.22]},
    {name:"Logan / Cache Co. zoning",   url:"https://gis.cachecounty.gov/arcgis/rest/services/Planning/City_Zoning/MapServer/6/query",       field:"general_zone_type", ext:[-112.05,41.44,-111.68,42.03]},
    {name:"Vernal / Uintah Co. zoning", url:"https://apps.uintah.utah.gov/arcgis/rest/services/Uintah_County_Zoning/FeatureServer/0/query",  field:"ZONE",              ext:[-110.10,39.90,-109.30,40.92]},
    {name:"Price / Carbon Co. zoning",  url:"https://maps.carbon.utah.gov/arcgis/rest/services/CountyGeneralMap/Zoning/MapServer/6/query",   field:"ZONING",            ext:[-110.92,39.54,-110.68,39.70]},
    // Small towns whose general plans turned out to be published as hosted GIS rather than PDF-only.
    {name:"Ephraim (FLU)",       url:"https://services1.arcgis.com/nSnGtAgSmNZcvEzK/arcgis/rest/services/Ephraim_City_Future_Land_Use/FeatureServer/1/query", field:"LandUse",   ext:[-111.64,39.31,-111.55,39.40]},
    {name:"Ballard (land use plan)", url:"https://services1.arcgis.com/nSnGtAgSmNZcvEzK/arcgis/rest/services/Ballard_Land_Use_and_Zoning/FeatureServer/0/query", field:"LU_Desc", ext:[-109.99,40.25,-109.90,40.34]},
    {name:"Monticello (zoning)", url:"https://services1.arcgis.com/nSnGtAgSmNZcvEzK/arcgis/rest/services/City_of_Monticello_Zoning/FeatureServer/0/query", field:"Zone_Desc", ext:[-109.37,37.84,-109.30,37.90]},
    {name:"Oak City (zoning)",   url:"https://services1.arcgis.com/nSnGtAgSmNZcvEzK/arcgis/rest/services/Oak_City_Zoning/FeatureServer/2/query",           field:"Zone_Desc", ext:[-112.37,39.35,-112.32,39.39]},
    {name:"Blanding (zoning)",   url:"https://services1.arcgis.com/nSnGtAgSmNZcvEzK/arcgis/rest/services/Blanding_City_Zoning/FeatureServer/0/query",      field:"ZONES",     ext:[-109.54,37.57,-109.46,37.68]},
    {name:"Richfield (FLU)",     url:"https://services5.arcgis.com/PmhEdhGbiU6Fds6f/arcgis/rest/services/Future_Land_Use/FeatureServer/0/query",           field:"ZONING_DES",ext:[-112.13,38.71,-112.05,38.80]},
    {name:"Beaver Co. zoning",   url:"https://services7.arcgis.com/n8i0jF7SlR2FMUxZ/arcgis/rest/services/Zoning/FeatureServer/40/query",                   field:"ZONE_DEF",  ext:[-114.07,38.12,-112.33,38.60]},
  ],

  /* UGRC statewide municipal boundaries. VERIFIED to return rows with no geometry filter -- a
     city-limits layer that returns an empty set with HTTP 200 would make every parcel read
     "not in a city" and quietly drop them all to well+septic. Always confirm rows before
     trusting inCity. */
  cityLimitsUrls:["https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahMunicipalBoundaries/FeatureServer/0/query"],
  sewerUrl:null,        // no single statewide sewer-district layer wired yet
  impactUrl:null,       // Utah has no areas-of-city-impact equivalent
  floodUrl:"https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query",
  hillsideUrl:null,     // no published >15% slope polygon layer -- derived from elevation instead
  /* Utah zoning doesn't call out hillsides the way Ada County's does, so slope is DERIVED from
     USGS 3DEP elevation. Only runs when the site-constraints view is on (getSamples is capped
     at 1,000 sample points per POST). */
  slopeImg:"https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer",
  steepPct:15, slopeMaxParcels:570,
  ownLayers:[],
  zoningJoin:null,      // LIR parcels carry PROP_CLASS, so no spatial-join zoning layer is needed

  tracedFlu:[],
  init(){
    this.tracedFlu = BEAVER_ZONES.features.map(f=>{
      f.luLabel=f.properties.luLabel; f.luDen=null; f.luTier=intensity(f.luLabel, this); return f;
    });
  },

  async fetchParcels(bbox){
    const fields="PARCEL_ID,PARCEL_ADD,PARCEL_CITY,COUNTY_NAME,PROP_CLASS,TOTAL_MKT_VALUE,LAND_MKT_VALUE,PARCEL_ACRES,SUBDIV_NAME";
    const results = await Promise.all(countiesInView(bbox).map(suffix =>
      fetchPaged(lirUrl(suffix), bbox, fields).catch(()=>({feats:[],capped:false}))));
    let features=[], capped=false;
    results.forEach(r=>{
      (r.feats||[]).forEach(f=>{ const p=f.properties||{};
        f.properties={PARCEL:p.PARCEL_ID, ADDRESS:p.PARCEL_ADD, ZONING:p.PROP_CLASS||"",
          TOTALVALUE:p.TOTAL_MKT_VALUE, ACRES:p.PARCEL_ACRES,
          CITY_STATE:(p.PARCEL_CITY?(p.PARCEL_CITY+", UT"):""), SUBNM:p.SUBDIV_NAME,
          LAND_MKT_VALUE:p.LAND_MKT_VALUE,
          COUNTY:(p.COUNTY_NAME?(""+p.COUNTY_NAME).replace(/\s*County\s*$/i,"").trim().toUpperCase():"")};
        f.__county="ut";
      });
      features=features.concat((r.feats||[]).filter(f=>f.geometry));
      if(r.capped) capped=true;
    });
    return {features, capped};
  },

  annotate(p, d){
    // PARCEL_CITY is null on ~7k Salt Lake parcels, so the municipal POLYGON is authoritative here.
    const cityHit = polyHit(p.centroid, store.cities);
    let service = cityHit ? "city" : "county";
    if(!cityHit){
      const dm = distToCityM(p.centroid, store.cities);
      const annexM=(d.annexFt||1320)*0.3048;
      if(dm!=null && dm<=annexM) service="annex";
      p.annexDistM = dm;
    } else p.annexDistM = 0;
    const cityName = cityHit ? (cityHit.properties&&(cityHit.properties.NAME||cityHit.properties.CITY)) : null;
    if(cityName) p.city=(""+cityName).toUpperCase();   // authoritative for lot value / mixed du
    p.service = service;
    p.util = { inCity:service==="city", cityName:cityName||p.city, service,
               sewer:service!=="county", water:service!=="county" };
    // No statewide sewer-district layer is wired, so any parcel outside a city needs BOTH mains
    // extended. Do not derive this from p.util above -- its fields are informational here.
    p.utilMissing = (service==="city") ? {sewer:false,water:false} : {sewer:true,water:true};
  },

  /* ---- Per-county residential density on UNINCORPORATED land, from each county's zoning ordinance.
     sf = densest by-right single-family du/ac; rr = rural-residential; ag = agricultural floor;
     mf = max multifamily du/ac outside cities (0 = not permitted); zone/lot = the densest SF zone.
     Small-lot SF zones almost always require public water+sewer; on well+septic, Utah county health
     departments commonly hold density near SEPTIC_DU, which core/scoring.js applies. ---- */
  countyResTable:{
   "BEAVER":{sf:4.36,rr:1.0,ag:0.05,mf:10,zone:"R-10",lot:"10,000 sf"},
   "BOX ELDER":{sf:2.18,rr:1.0,ag:0.05,mf:0,zone:"R-1-20",lot:"20,000 sf"},
   "CACHE":{sf:0.5,rr:0.5,ag:0.1,mf:0,zone:"RU2",lot:"2 ac (density cap)"},
   "CARBON":{sf:5.45,rr:1.0,ag:0.15,mf:21.8,zone:"R-1-8000",lot:"8,000 sf"},
   "DAGGETT":{sf:7.26,rr:1.0,ag:0.025,mf:15,zone:"R1-6",lot:"6,000 sf"},
   "DAVIS":{sf:4.84,rr:1.0,ag:0.2,mf:18,zone:"R-1",lot:"9,000 sf"},
   "DUCHESNE":{sf:2.0,rr:1.0,ag:0.1,mf:8,zone:"R-1/2",lot:"0.5 ac"},
   "EMERY":{sf:0.1,rr:0.1,ag:0.1,mf:0,zone:"A-1 (no res zone)",lot:"10 ac"},
   "GARFIELD":{sf:4.0,rr:1.0,ag:0.025,mf:0,zone:"R-1",lot:"0.25 ac served / 1 ac septic"},
   "GRAND":{sf:5.0,rr:1.0,ag:0.2,mf:8,zone:"SLR",lot:"0.20 ac"},
   "IRON":{sf:2.0,rr:0.2,ag:0.05,mf:0,zone:"R-1/2",lot:"0.5 ac"},
   "JUAB":{sf:0.5,rr:0.05,ag:0.05,mf:0,zone:"GA growth area",lot:"2 ac"},
   "KANE":{sf:1.0,rr:0.1,ag:0.025,mf:6,zone:"R-1",lot:"1 ac"},
   "MILLARD":{sf:1.0,rr:1.0,ag:0.05,mf:0,zone:"R1",lot:"1 ac"},
   "MORGAN":{sf:5.4,rr:1.0,ag:0.05,mf:15,zone:"R1-8",lot:"8,000 sf"},
   "PIUTE":{sf:2.0,rr:0.17,ag:0.025,mf:2.0,zone:"R",lot:"0.5 ac"},
   "RICH":{sf:1.0,rr:1.0,ag:0.05,mf:4,zone:"R",lot:"1 ac / 10k sf w/ sewer"},
   "SALT LAKE":{sf:14.5,rr:2.0,ag:0.05,mf:25,zone:"R-1-3",lot:"3,000 sf"},
   "SAN JUAN":{sf:4.0,rr:1.0,ag:1.0,mf:0,zone:"RR-1",lot:"0.25 ac served / 1 ac septic"},
   "SANPETE":{sf:2.0,rr:1.0,ag:0.2,mf:0,zone:"RA-1",lot:"0.5 ac"},
   "SEVIER":{sf:2.0,rr:0.05,ag:0.05,mf:0,zone:"RA",lot:"0.5 ac (near cities)"},
   "SUMMIT":{sf:1.0,rr:0.05,ag:0.05,mf:5,zone:"RR (E. Summit)",lot:"0.75 ac"},
   "TOOELE":{sf:5.45,rr:1.0,ag:0.025,mf:30,zone:"R-1-8",lot:"8,000 sf"},
   "UINTAH":{sf:6.22,rr:2.72,ag:0.2,mf:40,zone:"R-2",lot:"7,000 sf"},
   "UTAH":{sf:0.2,rr:0.2,ag:0.025,mf:0,zone:"RA-5/RR-5",lot:"5 ac"},
   "WASATCH":{sf:0.2,rr:0.2,ag:0.05,mf:8,zone:"RA-1",lot:"5 ac by-right"},
   "WASHINGTON":{sf:4.36,rr:1.0,ag:0.2,mf:10.9,zone:"R-1-10",lot:"10,000 sf"},
   "WAYNE":{sf:1.0,rr:1.0,ag:1.0,mf:4,zone:"RA",lot:"1 ac"},
   "WEBER":{sf:8.71,rr:2.9,ag:1.09,mf:24.2,zone:"R1-5",lot:"5,000 sf"},
  },
  countyRes(name){
    if(!name) return null;
    return this.countyResTable[(""+name).replace(/\s*county\s*$/i,"").trim().toUpperCase()]||null;
  },

  cityLotInputs:{"SALT LAKE CITY":"dLotSLC","SANDY":"dLotSandy","WEST JORDAN":"dLotWJ",
    "SOUTH JORDAN":"dLotSJ","DRAPER":"dLotDraper","WEST VALLEY CITY":"dLotWVC","PROVO":"dLotProvo",
    "LEHI":"dLotLehi","OGDEN":"dLotOgden"},
  cityLot(city){
    const id=this.cityLotInputs[city]; if(!id) return null;
    const el=document.getElementById(id); const v=el? (+el.value||0):0; return v>0? v : null;
  },
  cityMixedDu:{ "SALT LAKE CITY":30 },
  overrides:{},

  /* Comp-based estimation is available here because LIR publishes LAND_MKT_VALUE per parcel. */
  estimate:{ enabled:true, lirUrl, countiesInView },
  /* Market assumptions — the real values carried over from the Utah app. */
  inputs:{
    dHorizLot:55000, dHorizComm:200000, dHorizInd:150000, dNet:70, dYears:2, dAnnexFt:1320,
    dDenLow:3, dDenMed:8, dDenMH:12, dDenHigh:20, dDenMixed:16,
    dLot:130000, dComm:900000, dInd:700000, dAg:20000,
    dRetLand:15, dRetComm:8, dRetApt:6,
    dSoftCity:18, dSoftCounty:12, dSoftInc:25, dCommission:6,
    dNoSewer:45000, dNoWater:20000, dWell:12000, dSeptic:8000, dFloodF:1.4, dSlopeF:1.5,
    dAptRent:1750, dAptBuild:200000, dAptCap:5.6, dAptVac:5, dAptOpex:35,
    dCRent:24, dCFar:0.25, dCCap:6.6, dCBuild:160, dCVac:8, dCOpex:5,
    dIRent:9.5, dIFar:0.45, dICap:7.5, dIBuild:120, dIVac:8, dIOpex:3,
    dRentGrow:3, dExitBps:25, dCostSale:2
  },
  cityLotFields:[
    {id:"dLotSLC",    label:"Salt Lake City",   value:165000},
    {id:"dLotSandy",  label:"Sandy",            value:150000},
    {id:"dLotWJ",     label:"West Jordan",      value:130000},
    {id:"dLotSJ",     label:"South Jordan",     value:150000},
    {id:"dLotDraper", label:"Draper",           value:230000},
    {id:"dLotWVC",    label:"West Valley City", value:115000},
    {id:"dLotProvo",  label:"Provo",            value:115000},
    {id:"dLotLehi",   label:"Lehi",             value:145000},
    {id:"dLotOgden",  label:"Ogden",            value:95000},
  ]
};
