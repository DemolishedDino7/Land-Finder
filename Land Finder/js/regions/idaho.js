/* idaho.js — Treasure Valley region: Ada, Canyon, Gem (+ Elmore FLU overlays).

   Everything Idaho-specific lives here. The engine in js/core/ never mentions a state. */

import { arcQuery, fetchPaged, esc, polyHit, distToCityM, store } from '../core/data.js';
import { buildIdahoTracedFlu } from './idaho-traced-flu.js';

const ORG    = "https://services2.arcgis.com/dgGjZc6xAH5m5JyP/ArcGIS/rest/services";
const CANYON = "https://maps.canyonco.org/arcgisserver/rest/services";
/* Gem County: the statewide IDWR parcel layer carries geometry + PIN only. The county's
   value-bearing service is token-secured, so these parcels have NO assessed value and are
   never deal-scored -- they show as "no value data", not as free land. */
const IDWR_PARCELS_URL = "https://gis.idwr.idaho.gov/hosting/rest/services/Reference/Parcels/FeatureServer/0/query";

export const idaho = {
  id:"id", name:"Idaho — Treasure Valley", short:"Idaho",
  center:[43.62,-116.42], zoom:11,           // frames Ada (E) + Canyon (W)
  minZoom:15, minZoomOverlay:12,
  attribution:'Parcels: Ada &amp; Canyon County Assessors, IDWR',

  /* Idaho protects land that Utah deliberately does not -- see the note at the top of
     core/classify.js before changing either list. */
  classify:{
    protectedExtra:["GREEN SPACE","GREENSPACE","GREENBELT","RECREATION","BSU"],
    protectedEq:[]
  },

  fluLayers:[
    {name:"Boise",        url:ORG+"/Boise_Future_Land_Use/FeatureServer/0/query",        field:"LandUse"},
    {name:"Meridian",     url:ORG+"/Meridian_Future_Land_Use/FeatureServer/0/query",     field:"class2"},
    {name:"Eagle",        url:ORG+"/Eagle_Future_Land_Use/FeatureServer/0/query",        field:"general_", denField:"resdenmax", denText:"usedensity"},
    {name:"Star",         url:ORG+"/Star_Future_Land_Use/FeatureServer/0/query",         field:"Land_Use"},
    {name:"Garden City",  url:ORG+"/Garden_City_Future_Land_Use/FeatureServer/0/query",  field:"ZONING"},
    {name:"Ada County",   url:ORG+"/Ada_County_Future_Land_Use/FeatureServer/0/query",   field:"NAME"},
    {name:"Avimor",       url:ORG+"/Avimor_Future_Land_Use/FeatureServer/0/query",       field:null},
    {name:"Cartwright",   url:ORG+"/Cartwright_Ranch_Future_Land_Use/FeatureServer/0/query", field:null},
    {name:"Dry Creek",    url:ORG+"/Dry_Creek_Ranch_Future_Land_Use/FeatureServer/0/query",  field:null},
    {name:"Kuna",         url:"https://services2.arcgis.com/zGDMrUABi5rG1bng/arcgis/rest/services/Open_House_Future_Land_Use_Map_Draft_WFL1/FeatureServer/1/query", field:"COMP_CODE"},
    {name:"Canyon County",url:CANYON+"/DSD/Future_Land_Use_2030_Adopted/MapServer/1/query", field:"FLU_ZONE_C"},
    // Elmore County — Mountain Home city FLU + the county plan. NOTE (Oct 2026): the county's
    // Future_Land_Use layer is published with the wrong spatial reference -- its polygons project
    // to northern Arizona, so it currently returns nothing in Idaho. Fix is on the county's side
    // (or trace their PDF). Parcels there are token-secured without value, so overlays only.
    {name:"Mountain Home", url:"https://services.arcgis.com/zuVYcGbo1L9xuj72/arcgis/rest/services/FUTURE_LAND_USE_2021/FeatureServer/0/query", field:"layer"},
    {name:"Elmore County", url:"https://services.arcgis.com/91hXl6NfvLGEi8x5/arcgis/rest/services/Elmore_Planning_and_Zoning/FeatureServer/9/query", field:"Future"},
    // ---- Beyond the Treasure Valley (added Oct 2026). Parcels don't load outside Ada / Canyon /
    // Gem yet, so these show on the FLU overlay now and feed scoring once parcels are wired.
    // Every one is bbox-gated (ext) so it only fires when its own area is in view.
    {name:"Twin Falls",   url:"https://tfportal.tfid.org/arcgisserver/rest/services/Future_Land_Use_Public/MapServer/0/query", field:"Zone", ext:[-114.55,42.47,-114.37,42.64]},
    {name:"Pocatello",    url:"https://services3.arcgis.com/My1Vo0yFlHe2fnKB/arcgis/rest/services/Future_LandUse/FeatureServer/9/query", field:"COMP_PLAN_TYPE", ext:[-112.64,42.78,-112.35,42.96],
     codes:{C:"Commercial",MU:"Mixed Use",R:"Residential",E:"Employment",UC:"Urban Core (mixed use)",I:"Industrial",SD:"Special District (public / institutional)",OS:"Open Space"}},
    {name:"Lewiston",     url:"https://services5.arcgis.com/R6cBwHlkwfCfBjSM/arcgis/rest/services/my_cdFutureLandUseDesignation_gdb_view/FeatureServer/0/query", field:"Designation", ext:[-117.07,46.34,-116.88,46.45]},
    {name:"Jerome",       url:"https://services.arcgis.com/ivTxDS7DflQhZTzu/arcgis/rest/services/Future_Land_Use_2023/FeatureServer/0/query", field:"FutureLU2022", ext:[-114.57,42.63,-114.42,42.76],
     codes:{"RESIDENTIAL HIGH":"High Density Residential","RESIDENTIAL MED":"Medium Density Residential","RESIDENTIAL LOW":"Low Density Residential","RESIDENTIAL RURAL":"Rural Residential","AG TRANSITION":"Agricultural (future growth area)"}},
    {name:"Buhl",         url:"https://services3.arcgis.com/2lFfYsoBD697ZuE3/arcgis/rest/services/Buhl_Comprehensive_Plan_Land_Use/FeatureServer/0/query", field:"LandUse", ext:[-114.82,42.57,-114.70,42.63]},
    {name:"Hailey",       url:"https://services9.arcgis.com/X6IADK3MAoq4CuNd/arcgis/rest/services/Hailey_Future_Land_Use/FeatureServer/0/query", field:"FutureLand", ext:[-114.36,43.46,-114.25,43.57],
     codes:{"Sensitive":"Sensitive Lands (protected)","Growth Reserve":"Rural / growth reserve"}},
    {name:"Ketchum",      url:"https://services1.arcgis.com/Du5HbCSCJ3Dxz51s/arcgis/rest/services/Future_Land_Use_Categories_2025/FeatureServer/0/query", field:"Future_LU", ext:[-114.42,43.65,-114.34,43.72]},
    {name:"Sun Valley",   url:"https://services9.arcgis.com/EnV60CNPaeEPPS2P/arcgis/rest/services/Sun_Valley_Future_Land_Use_2015/FeatureServer/0/query", field:"FLU_Category", ext:[-114.37,43.31,-113.93,43.73]},
    // Post Falls: GS-1 / GS2 / GS-3 / CCS codes are undocumented in the layer and read as
    // low-density by default. The city is adopting a new 2045 plan -- recheck this layer then.
    {name:"Post Falls",   url:"https://services1.arcgis.com/QjiQKkFtXufcXWpu/arcgis/rest/services/Future_Land_Use_PF/FeatureServer/5/query", field:"FUTURE_LAND_USE", ext:[-117.05,47.68,-116.84,47.78]},
    {name:"Dover",        url:"https://services1.arcgis.com/QjiQKkFtXufcXWpu/arcgis/rest/services/CompPlanDesignation/FeatureServer/40/query", field:"CompPlan", ext:[-116.70,48.24,-116.57,48.31],
     codes:{"Compact Suburban Single Family (4 units/acre)":"Single Family Residential (4 units/acre)",
            "Small Lot Single-Family Traditional (6 units/acre)":"Medium Density Residential (6 units/acre)",
            "Small-Scale Working Lands - 5 acres":"Rural / working lands (5 acres)"}},
    {name:"Council",      url:"https://services8.arcgis.com/fhV7YmN3ZH8F4stQ/arcgis/rest/services/Council_FLUM_ACI/FeatureServer/0/query", field:"LandUse", ext:[-116.46,44.70,-116.41,44.77],
     codes:{"Agricultural Transition":"Agricultural (future growth area)"}},
    {name:"Lava Hot Springs", url:"https://services3.arcgis.com/unGRzvbK9SNTRUps/arcgis/rest/services/Future_Land_Use/FeatureServer/2/query", field:"FutureLU", ext:[-112.05,42.59,-111.98,42.64],
     codes:{"1":"High Density Residential","2":"Commercial (resort / tourism)","3":"Park","4":"Residential/Office","5":"Commercial","6":"Low Density Residential","7":"Medium Density Residential"}},
    {name:"Bonners Ferry", url:"https://services5.arcgis.com/4CllgMSJJaeToEFP/arcgis/rest/services/Admin_Bounds/FeatureServer/3/query", field:"Zoning", ext:[-116.37,48.65,-116.26,48.72]},
    // ---- Second pass (Oct 7, 2026): city GIS servers and name-matched ArcGIS Online layers.
    {name:"Idaho Falls",  url:"https://cifgis.idahofalls.gov/arcgis/rest/services/UtilityDevelopment/MapServer/720/query", field:"Transect", ext:[-112.15,43.42,-111.97,43.58],
     codes:{"Urban Core":"Urban Core (mixed use)","General Urban":"Medium Density Residential (general urban)","Mixed Use Centers and Corridors":"Mixed Use",
            "Special Use":"Special Use (public / institutional)"}},
    // Rexburg's server is joined to a description table and rejects paging parameters.
    {name:"Rexburg",      url:"https://madison.rexburg.org/mrgis/rest/services/Data/CompPlan/MapServer/0/query", field:"DBO.T_COMPPLANDESCRIPTION.DESCRIPTION", noPaging:true, ext:[-111.85,43.78,-111.74,43.87],
     codes:{"Intermediate Residential":"Medium Density Residential","High Residential":"High Density Residential","Low Residential":"Low Density Residential","Form Based":"Mixed Use (form based)"}},
    {name:"Rathdrum",     url:"https://services.arcgis.com/aDVuwZJfhoSYo0Ie/arcgis/rest/services/Jan_PUB_3_WFL1_FBD/FeatureServer/40/query", field:"ZONING", ext:[-116.97,47.75,-116.84,47.84],
     codes:{"Residential Rural Ag Transition":"Rural Residential (ag transition)"}},
    {name:"Ririe",        url:"https://services8.arcgis.com/8rulC8tP1E1nOcyo/arcgis/rest/services/Ririe_PLUM_-_View/FeatureServer/0/query", field:"LandUse", ext:[-111.81,43.60,-111.74,43.65],
     skip:["Historic Downtown Overlay"], codes:{"Planned Transition":"Low Density Residential (planned transition)","Mixed Residential Use":"Medium Density Residential"}},
    // Chubbuck: the city's FLU as copied into ITD District 5's 2017 Yellowstone corridor study.
    {name:"Chubbuck (2017 copy)", url:"https://services1.arcgis.com/Qqv4dYPC8Vv8e3c3/arcgis/rest/services/D5_YellowstoneCorridorRefresh2017/FeatureServer/26/query", field:"Future_Des", ext:[-112.53,42.90,-112.43,42.96],
     codes:{"Low Density":"Low Density Residential","Medium Density":"Medium Density Residential","High Density":"High Density Residential"}},
    {name:"McCall",       url:"https://mccallgis.mccall.id.us/mcgis/rest/services/Future_Land_Use_Plan/MapServer/1/query", field:"LANDUSEDEC", ext:[-116.17,44.86,-116.02,45.03],
     codes:{"Large Residential 5-10+ Acres":"Rural Residential (5-10+ acres)"}},
    {name:"Ponderay",     url:"https://services.arcgis.com/MyTLiOs93fmcFMug/arcgis/rest/services/LandUseProposed/FeatureServer/0/query", field:"LANDUSEDESC", ext:[-116.56,48.28,-116.52,48.34]},
    // Teton County (Driggs / Victor / Tetonia) comp plan: one layer per character area, so each gets a fixed label.
    ...[[19,"Industrial (research)"],[20,"Industrial (Driggs area of impact)"],[21,"Town Neighborhood (low density)"],[22,"Rural Agriculture"],
        [23,"Foothills (rural)"],[24,"Rural Neighborhood"],[25,"Rural Agriculture / Rural Neighborhood"],[26,"Agriculture / Wetland (rural)"]]
      .map(([id,label])=>({name:"Teton County: "+label, url:"https://services1.arcgis.com/as6biEYkl7PaUM4Y/arcgis/rest/services/COMP_PLAN/FeatureServer/"+id+"/query", label, ext:[-111.41,43.45,-110.95,43.96]})),
    // County plans: AFTER the city layers so a city's own plan wins inside its limits.
    {name:"Bannock County", url:"https://services6.arcgis.com/jEWFLsriO24ArCMH/arcgis/rest/services/Planning_and_Zoning/FeatureServer/18/query", field:"FLUP", ext:[-112.53,42.25,-111.87,43.00],
     skip:["CITY"], codes:{AG:"Agricultural",RES:"Residential",RR:"Rural Residential",SR:"Suburban Residential",PUB:"Public",REC:"Recreation",COM:"Commercial",IND:"Industrial",ROW:"ROW"}},
    {name:"Bonneville County", url:"https://gis.bonnevillecountyidaho.gov/hosted/rest/services/Zoning/MapServer/2/query", field:"comp_plan", ext:[-112.53,43.01,-111.03,43.63],
     skip:["","Impact Area"], codes:{"Suburban Mixed":"Suburban Residential","Rural Growth Center":"Rural Residential (growth area)","Urban Residential":"Medium Density Residential (urban)"}},
    {name:"Madison County", url:"https://madison.rexburg.org/mrgis/rest/services/Data/CompPlan/MapServer/2/query", field:"DBO.T_COMPPLANDESCRIPTION.DESCRIPTION", noPaging:true, ext:[-111.99,43.62,-111.39,43.94],
     skip:["Townsite Overlay","Ag / Rec Overlay","Sensitive Land Overlay","Hwy Mixed Use Overlay"], codes:{"Ag Land":"Agricultural","Rural Cluster":"Rural Residential (cluster)","State Land":"State Land (public)"}},
    {name:"Payette County", url:"https://services6.arcgis.com/3LBwvT7tWlJIoXCb/arcgis/rest/services/Comprehensive_Plans/FeatureServer/3/query", field:"Description", ext:[-116.99,43.79,-116.44,44.16],
     codes:{"AGRICULTURE MIXED":"Agricultural (general)"}},
    {name:"Jefferson County", url:"https://services.arcgis.com/7iO9jzKTrQqVrA3p/arcgis/rest/services/Comprehensive_Plan_-_View/FeatureServer/0/query", field:"LandUse", ext:[-112.70,43.62,-111.62,44.06],
     codes:{"01":"Residential","02":"Recreation","03":"Commercial","04":"Agricultural","05":"Industrial"}},
    {name:"Caribou County", url:"https://services1.arcgis.com/qnw9CxcuDG55fwTB/arcgis/rest/services/Zoning_and_Land_Use_PUBLIC/FeatureServer/1/query", field:"ZoneClass", ext:[-112.15,42.41,-111.04,43.03],
     skip:["CITY"], codes:{AG:"Agricultural",COM:"Commercial",IND:"Industrial",RES:"Residential"}},
    // COMPASS regional comp plans fill the city gaps in BOTH counties (Nampa, Caldwell, Middleton,
    // small towns). LAST, so it only fills where no finer layer already covers the parcel.
    {name:"COMPASS Regional", url:"https://swidrdc.org/arcgis/rest/services/COMPASSData/CommonFeatures/FeatureServer/13/query", field:"regionalgeneral"},
  ],

  /* Ada's own City_Limits layer has ownership-based access control: anonymous queries return an
     EMPTY feature set instead of an error, so every parcel silently scored as "not in a city".
     COMPASS publishes city limits for BOTH Ada and Canyon and queries cleanly. */
  cityLimitsUrls:[
    "https://swidrdc.org/arcgis/rest/services/COMPASSData/CommonFeatures/FeatureServer/4/query", // field: city
    CANYON+"/General/CITY_LIMITS_PUBLIC/FeatureServer/0/query",                                  // field: CITY
  ],
  sewerUrl:  ORG+"/Sewer_and_Water_Districts/FeatureServer/11/query",  // field: NAME
  impactUrl: "https://swidrdc.org/arcgis/rest/services/COMPASSData/CommonFeatures/FeatureServer/5/query", // areas of city impact
  floodUrl:  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query",     // FLD_ZONE, SFHA_TF
  hillsideUrl:"https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/Hillside/FeatureServer/123/query",
  slopeImg:null,          // Ada publishes a hillside polygon layer, so no elevation sampling needed
  ownLayers:[
    {agency:"ACHD (Ada Co. Highway District)", url:"https://services1.arcgis.com/QjiQKkFtXufcXWpu/arcgis/rest/services/ACHD_ROW/FeatureServer/2/query"},  // layer moved 0 -> 2 (Oct 2026)
  ],
  zoningJoin:{ url:CANYON+"/DSD/Current_Zoning/FeatureServer/0/query", field:"ZONE_DESC", county:"canyon" },

  tracedFlu:[],
  init(){ this.tracedFlu = buildIdahoTracedFlu(this); },

  /* Three parcel sources, normalized into one field set so the engine sees one shape. */
  async fetchParcels(bbox){
    const F = (u,fields,where) => arcQuery(u,bbox,where,fields);
    const [ada, can, gem] = await Promise.all([
      F(ORG+"/Parcels/FeatureServer/5/query","PARCEL,ADDRESS,ZONING,TOTALVALUE,ACRES,PROPCODE,CITY_STATE,SUBNM")
        .then(fs=>{ fs.forEach(f=>{ f.__county="ada"; f.properties.COUNTY="ADA"; }); return fs; }),
      F(CANYON+"/Assessor/CCPublicTaxparcels/MapServer/0/query","PIN,SiteAddress,SiteCity,FCVTotal,FCVLand,FCVImp,ACRES,SubName")
        .then(fs=>{ fs.forEach(f=>{ const p=f.properties||{};
          f.properties={PARCEL:p.PIN, ADDRESS:p.SiteAddress, ZONING:"", TOTALVALUE:p.FCVTotal, ACRES:p.ACRES,
            CITY_STATE:(p.SiteCity?(p.SiteCity+", ID"):""), SUBNM:p.SubName, FCVLand:p.FCVLand, FCVImp:p.FCVImp,
            COUNTY:"CANYON"};
          f.__county="canyon"; }); return fs; }),
      F(IDWR_PARCELS_URL,"PIN,COUNTY,OWNER","COUNTY='Gem'")
        .then(fs=>{ fs.forEach(f=>{ const p=f.properties||{};
          f.properties={PARCEL:p.PIN, ADDRESS:"", ZONING:"", TOTALVALUE:0, CITY_STATE:"", OWNER:p.OWNER, COUNTY:"GEM"};
          f.__county="gem"; f.__novalue=true; }); return fs; }),
    ]);
    return { features: ada.concat(can, gem), capped:false };
  },

  /* Per-parcel joins that differ from Utah's: the Canyon zoning join, and a service model built on
     sewer districts + adopted areas of city impact rather than distance to the city line alone. */
  annotate(p, d){
    // Canyon parcels carry no zoning field -> spatial join to Current_Zoning
    if(p.feature.__county==="canyon" && !p.props.ZONING){
      const zh=polyHit(p.centroid, store.zoningJoin);
      if(zh && zh.properties) p.props.ZONING = zh.properties.ZONE_DESC || "";
    }
    const cityHit  = polyHit(p.centroid, store.cities);
    const sewerHit = polyHit(p.centroid, store.sewers);
    const cityName = cityHit ? (cityHit.properties&&(cityHit.properties.CITY||cityHit.properties.city||cityHit.properties.NAME||cityHit.properties.name)) : null;
    p.inImpact = !!polyHit(p.centroid, store.impacts);
    p.util = { inCity:!!cityHit, cityName, inSewer:!!sewerHit,
               sewerName: sewerHit ? (sewerHit.properties&&sewerHit.properties.NAME) : null,
               sewer:(!!cityHit||!!sewerHit), water:!!cityHit };
    if(cityName) p.city=(""+cityName).toUpperCase();
    // SERVICE, not the city line. Fully served -> city. Inside an area of city impact, or within
    // the annexation reach of a city / impact boundary -> city soft rate, but mains get extended.
    const served = p.util.sewer && p.util.water;
    const annexM = (d.annexFt||1320)*0.3048;
    // Emmett's adopted plan area functions as its area of city impact -- Gem County publishes none.
    const emmett = (this.tracedFlu||[]).filter(f=>f.properties && f.properties.__override==="Emmett FLU");
    p.annexDistM = served ? 0 : distToCityM(p.centroid, store.cities.concat(store.impacts, emmett));
    p.service = served ? "city"
              : (p.inImpact || (p.annexDistM!=null && p.annexDistM<=annexM)) ? "annex" : "county";
    // Only the missing mains are charged. Sewer service here genuinely extends past the city line.
    p.utilMissing = { sewer:!p.util.sewer, water:!p.util.water };
  },

  countyRes:null,   // no per-county Idaho zoning-ordinance density table wired yet

  cityLotInputs:{"BOISE":"dLotBoise","MERIDIAN":"dLotMeridian","EAGLE":"dLotEagle","STAR":"dLotStar",
    "KUNA":"dLotKuna","GARDEN CITY":"dLotGarden","NAMPA":"dLotNampa","CALDWELL":"dLotCaldwell",
    "MIDDLETON":"dLotMiddleton"},
  cityLot(city){
    const id=this.cityLotInputs[city]; if(!id) return null;
    const el=document.getElementById(id); const v=el? (+el.value||0):0; return v>0? v : null;
  },
  /* City-granted mixed-use density the published plans don't carry. */
  cityMixedDu:{ "EAGLE":20 },

  /* Per-parcel corrections. `units` = entitled lot count = ground truth: it beats zoning AND the
     plan, and entitles ag land -- but it can NEVER override protected land. Gem/Elmore/Owyhee
     parcels publish no assessed value, so an asking price is what unlocks scoring there. */
  overrides:{
    "RP07N01W310650": {price:1300000},
    "RP07N01W308550": {price:1400000, units:14, zoning:"R-2", lotVal:250000}  // 14 x ~1-ac entitled lots
  },

  estimate:null,   // no LIR-style land-value field to build comps from
  /* Market assumptions — the real Treasure Valley numbers carried over from the Idaho app.
     Idaho's older engine used a different input vocabulary, so these are the mapped equivalents:
       dReturn->dRetLand, dRetRent->dRetComm, dRentUnit->dAptRent, dBuildUnit->dAptBuild,
       dCapMF->dAptCap, dOpexMF->dAptOpex, dRentComm->dCRent, dFarComm->dCFar, dCapComm->dCCap,
       dBuildComm->dCBuild, dRentInd->dIRent, dFarInd->dIFar, dCapInd->dICap, dBuildInd->dIBuild,
       dGrowth->dRentGrow, dExitShift(0.25%)->dExitBps(25), dSellCost->dCostSale, dVac->dCVac/dIVac.
     Three old Idaho knobs have NO equivalent because the Utah engine fixes them: hold period
     (10 yr), build period (2 yr) and the 8 du/ac lot-vs-apartment routing threshold.
     dCommission did not exist in Idaho — its flat 18% soft cost bundled the commission. Splitting
     it 6% at closing + 12% at t0 totals the same 18%, just with correct timing. */
  inputs:{
    dHorizLot:35000, dHorizComm:130000, dHorizInd:100000, dNet:70, dYears:2, dAnnexFt:1320,
    dDenLow:3, dDenMed:8, dDenMH:12, dDenHigh:20, dDenMixed:16,
    dLot:120000, dComm:400000, dInd:250000, dAg:45000,
    dRetLand:15, dRetComm:8, dRetApt:6,
    dSoftCity:18, dSoftCounty:12, dSoftInc:25, dCommission:6,
    dNoSewer:45000, dNoWater:20000, dWell:18000, dSeptic:12000, dFloodF:1.4, dSlopeF:1.5,
    dAptRent:1900, dAptBuild:185000, dAptCap:5.5, dAptVac:5, dAptOpex:35,
    dCRent:26, dCFar:0.22, dCCap:6.75, dCBuild:175, dCVac:7, dCOpex:5,
    dIRent:11, dIFar:0.40, dICap:6.25, dIBuild:95, dIVac:7, dIOpex:5,
    dRentGrow:3, dExitBps:25, dCostSale:2
  },
  cityLotFields:[
    {id:"dLotBoise",     label:"Boise",       value:115000},
    {id:"dLotMeridian",  label:"Meridian",    value:125000},
    {id:"dLotEagle",     label:"Eagle",       value:280000},
    {id:"dLotStar",      label:"Star",        value:125000},
    {id:"dLotKuna",      label:"Kuna",        value:100000},
    {id:"dLotGarden",    label:"Garden City", value:105000},
    {id:"dLotNampa",     label:"Nampa",       value:90000},
    {id:"dLotCaldwell",  label:"Caldwell",    value:85000},
    {id:"dLotMiddleton", label:"Middleton",   value:110000},
  ]
};
