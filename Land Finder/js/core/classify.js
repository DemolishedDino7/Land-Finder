/* classify.js — land-use / zoning text -> intensity tier + density.
   Shared by every region. The classifier itself is Utah's (the more evolved of the two), with
   ONE region hook: the protected-land keyword list.

   WHY THAT HOOK EXISTS — read before touching it. The two source apps disagreed, on purpose:
     GREENBELT   Idaho: protected open space.   Utah: Farmland Assessment Act ag land -> tier 0 rural,
                                                so a known entitled lot count can still override it.
     RECREATION  Idaho: "Recreation and Natural Resources" (Gem County) is protected.
                        Utah: an assessor class, and Beaver's "Forest/Recreation Residential" is
                        large-lot housing -> rural.
     GOLF / BSU / RIGHT-OF-WAY  Idaho-specific labels with no Utah equivalent.
   Collapsing these into one list silently flips Idaho golf courses, greenbelt and Gem County's
   natural-resource land to developable — which paints them GREEN on the map. Keep them per-region. */

/* ---------------- Editable residential densities (units per developable acre) ---------------- */
export let DUV = {low:3, med:8, mh:12, high:20, mixed:16};
export function setDU(duv){ DUV = Object.assign({}, DUV, duv||{}); }

export const SYS_FIELDS = new Set(["OBJECTID","OBJECTID_1","FID","Id","ID","Shape__Area","Shape__Length",
  "Shape_Leng","Shape_Length","ShapeSTAre","ShapeSTLen","Acres","ACRES","Resolution"]);

/* Protected / public / institutional -> not developable for private investment, and NEVER
   overridable. This is the list both regions agree on; each region adds its own on top. */
const PROTECTED_BASE = ["PARK","OPEN SPACE","CONSERV","SLOPE","FLOOD","CEMET","WATER",
  "PUBLIC","QUASI","SCHOOL","GOVERNMENT","INSTITUT","CIVIC","FEDERAL","MILITARY",
  "AIRPORT","UNIVERSITY","COLLEGE","CAMPUS","TAX EXEMPT","RELIGIOUS","CHURCH",
  "NOBUILD","NO BUILD","PROTECTED",
  // GOLF and RIGHT OF WAY were protected in the Idaho app but had NO rule in the Utah one, where
  // they fell through to the tier-1 default -- i.e. a Utah golf course or road right-of-way was
  // priced as developable low-density housing. Nothing state-specific about either, so both are
  // shared now. (Utah caught only the bare code eq("ROW"), never the spelled-out phrase.)
  "GOLF","RIGHT OF WAY","RIGHT-OF-WAY"];
const PROTECTED_BASE_EQ = ["STATE"];

/* Classify any land-use or zoning string -> {t: coarse tier (-1..6), label, du: units/acre
   (0 if non-residential)}. `du` carries the ACTUAL allowed residential density, so medium stays
   medium and med-high stays med-high rather than collapsing to one bucket.
   `region` is optional; without it only the shared protected list applies. */
export function intensity(raw, region){
  if(raw==null) return null;
  const t = (""+raw).trim().toUpperCase();
  if(!t) return null;
  // Normalize separators for KEYWORD matching only ("OPEN_SPACE" must match "OPEN SPACE").
  // Regex/eq tests below still use the raw `t`, so codes like R-1 / M-H keep their punctuation.
  const tn = t.replace(/[_]+/g," ").replace(/\s+/g," ");
  const has = (...w)=>w.some(x=>tn.includes(x));
  const eq  = (...w)=>w.includes(t);
  const rc  = (region && region.classify) || {};

  // Employment "parks"/"campus" are commercial centers, not protected parkland or a university --
  // catch before the PARK / CAMPUS rules below.
  if(has("BUSINESS PARK","OFFICE PARK","RESEARCH PARK","TECH PARK","BUSINESS CAMPUS","CORPORATE CAMPUS"))
    return {t:5,label:"Business park / employment",du:0};

  // Protected: shared list + this region's additions.
  if(has(...PROTECTED_BASE) || eq(...PROTECTED_BASE_EQ)
     || (rc.protectedExtra && has(...rc.protectedExtra))
     || (rc.protectedEq && eq(...rc.protectedEq)))
    return {t:-1,label:"Protected / public",du:0};

  // Explicit zoning code R-N (Meridian etc. encode max units/acre): R-8 => 8 du/ac
  const mz = t.match(/\bR-?(\d{1,2})\b/);
  if(mz){ const n=+mz[1]; const tt = n<=4?1 : n<=8?2 : n<=12?3 : 3;
    const lbl = n<=4?"Low-density residential" : n<=8?"Medium-density residential" : n<=12?"Medium-high residential" : "High-density residential";
    return {t:tt, label:lbl, du:n}; }
  // Manufactured/mobile-home housing is residential -- catch M-H before the M- industrial rule.
  if(eq("MH","M-H","MHP","RMH","MHR")) return {t:1,label:"Low-density residential",du:DUV.low};
  // Commercial / industrial zoning codes (mandatory dash so "MEDIUM" etc. don't match)
  if(/^C-[A-Z]/.test(t)) return {t:5,label:"Commercial / office",du:0};            // C-G, C-N, C-C
  if(/^[IM]-[A-Z0-9]/.test(t)) return {t:6,label:"Industrial / employment",du:0};  // I-L, I-H, M-E
  // Bare (dash-less) zoning codes common in rural Utah counties (Uintah, Carbon, etc.):
  // A1..A5 agricultural, C1/C2/HC1/CC1 commercial, M1/M2/I1/I2 industrial.
  if(/^A\d/.test(t)) return {t:0,label:"Rural / agricultural",du:0};
  if(/^[A-Z]?C\d/.test(t)) return {t:5,label:"Commercial / office",du:0};
  if(/^[IM]\d/.test(t)) return {t:6,label:"Industrial / employment",du:0};
  // Bare single-letter / short zone codes (Blanding etc.): whole-string matches only, so safe.
  if(eq("C","GC","HC","NC","CG","O","OL")) return {t:5,label:"Commercial / office",du:0};
  if(eq("I","LI","HI","MI","IND")) return {t:6,label:"Industrial / employment",du:0};
  if(eq("A")) return {t:0,label:"Rural / agricultural",du:0};
  if(eq("ROW")) return {t:-1,label:"Protected / public",du:0};
  // Bare density codes (Kuna "Envision" plan uses HIGH / MEDIUM / LOW)
  if(eq("HIGH")) return {t:3,label:"High-density residential",du:DUV.high};
  if(eq("MEDIUM")) return {t:2,label:"Medium-density residential",du:DUV.med};
  if(eq("LOW")) return {t:1,label:"Low-density residential",du:DUV.low};
  // Planned-community / master-planned zoning permits a mix, but typically builds out around
  // MEDIUM density -> treat as medium-density residential.
  if(has("PLANNED COMMUNITY","MASTER PLAN","MASTER-PLAN","MASTER PLANNED","PLANNED DEVELOPMENT","PLANNED UNIT")
     || eq("PC","P-C","PCD","MPC","PUD")) return {t:2,label:"Planned community (medium density)",du:DUV.med};
  // Mixed residential + commercial (WFRC "Residential/Office", "Residential/Retail") -> mixed use
  if(has("RESIDENTIAL") && has("OFFICE","RETAIL","COMMERCIAL")) return {t:4,label:"Mixed use",du:DUV.mixed};
  // "Multiple / multi-family residential" is high-density HOUSING, not "multiple use" mixed
  if(has("MULTIPLE RESID","MULTIPLE-FAMILY","MULTIPLE FAMILY","MULTI-FAMILY","MULTI FAMILY","MULTIFAMILY")) return {t:3,label:"High-density residential",du:DUV.high};
  // "Multiple Use" / "Multi-Use" in rural COUNTY zoning = large-lot grazing/ag/resource land
  // (NOT urban mixed use). Catch before the MIXED rule.
  if(has("MULTIPLE USE","MULTIPLE-USE","MULTI-USE","MULTIPLE  USE")) return {t:0,label:"Rural / multiple-use",du:0};
  // Apartments/condos are HOUSING. Utah's assessor class is literally "Commercial - Apartment
  // & Condo", which hits the COMMERCIAL rule first unless caught here.
  if(has("APARTMENT","CONDO")) return {t:3,label:"High-density residential",du:DUV.high};
  if(has("INDUSTRIAL","WAREHOUSE","MANUFACT","I-L","I-1","M-1","M-2","M-3")) return {t:6,label:"Industrial / employment",du:0};
  if(has("COMMERCIAL","MERCIAL","RETAIL","OFFICE","BUSINESS","EMPLOYMENT","C-C","C-1","C-2","C-3","L-O","O-T","CENTER")) return {t:5,label:"Commercial / office",du:0};
  // Downtown / central business district / mixed -> mixed use
  if(has("MIXED","MULTIPLE","DOWNTOWN","OLD TOWN","CBD","CENTRAL BUSINESS","ACTIVITY","TRANSIT","TN-","VILLAGE","MU-") || eq("MU")) return {t:4,label:"Mixed use",du:DUV.mixed};
  // Residential -- MED-HIGH before HIGH before MEDIUM ("Med-High Density" contains "High Density")
  if(has("MED-HIGH","MED HIGH","MEDIUM-HIGH","MEDIUM HIGH","MHDR")) return {t:3,label:"Medium-high residential",du:DUV.mh};
  if(has("HIGH DENSITY","HIGH-DENSITY","MULTI","APARTMENT","HDR","MFR"," MF","-MF") || eq("MF")) return {t:3,label:"High-density residential",du:DUV.high};
  if(has("COMPACT")) return {t:3,label:"Medium-high residential",du:DUV.mh};
  if(has("MEDIUM","MED DENSITY","MDR","TOWNH")) return {t:2,label:"Medium-density residential",du:DUV.med};
  // Rural BEFORE low, so "Rural Residential" / "Agriculture" stay rural rather than low-density.
  // GREENBELT / PRESERV / RECREATION land READS HERE in Utah, not as protected, so a known
  // entitled lot count can still override it. In Idaho those words are protected above.
  if(has("RURAL","LARGE LOT","ESTATE","AGRICULT","FARM","RANGELAND","RUT","RR","A-1","AG"," A ","MINING","GRAZING","FOREST",
         "GREENBELT","PRESERV","RECREATION","UNDEVELOPED")) return {t:0,label:"Rural / agricultural",du:0};
  if(has("SUBURBAN","LOW DENSITY","LDR","SINGLE","RESIDENTIAL","SFR")) return {t:1,label:"Low-density residential",du:DUV.low};
  return {t:1,label:(""+raw),du:DUV.low};
}

/* The assessor's class is a CURRENT-USE class, not zoning. "Vacant" / "Undeveloped" / "Unknown"
   carry NO land-use signal -- returning low-density residential for them would silently entitle
   every vacant parcel. Return null so the adopted plan (FLU) governs instead. */
const NO_SIGNAL = new Set(["VACANT","UNKNOWN","UNDEVELOPED",""]);
export function zoningSignal(raw, region){
  if(raw==null) return null;
  const t=(""+raw).trim().toUpperCase();
  if(NO_SIGNAL.has(t)) return null;
  return intensity(raw, region);
}

export const TIER_USE = {
  "-1":"Preserve as open space","0":"Rural home site / agriculture","1":"Single-family homes",
  "2":"Townhomes / small-lot residential","3":"Higher-density housing",
  "4":"Mixed-use (retail + housing)","5":"Retail / office commercial","6":"Light industrial / flex / warehouse"
};
/* Categorical colors + labels for the Future Land Use overlay and legend (planning-map palette) */
export const TIER_COLOR = {"-1":"#2e7d32","0":"#b07d2b","1":"#fff4a3","2":"#ffcf7a","3":"#f28e4e","4":"#b56ad0","5":"#e05a5a","6":"#7f8bb0"};
export const TIER_LABEL = {"-1":"Parks / public / open space","0":"Rural / agricultural","1":"Low-density residential",
  "2":"Medium-density residential","3":"High-density residential","4":"Mixed use","5":"Commercial / office","6":"Industrial / employment"};

const FLU_FIELD_HINTS = ["general_","class2","landuse","land_use","comp_code","designation","futurelu","flu","plandesig","name","zoning","use","category","type"];
export function detectFluField(props, cfg){
  if(cfg.field && props[cfg.field]!=null) return cfg.field;
  const keys=Object.keys(props);
  // Prefer a field whose NAME looks like a land-use designation (avoids grabbing citycode/id columns)
  for(const h of FLU_FIELD_HINTS){
    const k=keys.find(x=>x.toLowerCase()===h);
    if(k && typeof props[k]==="string" && props[k].trim().length>1) return k;
  }
  for(const k of keys){
    if(SYS_FIELDS.has(k)) continue;
    const v = props[k];
    if(typeof v === "string" && v.trim().length>1 && isNaN(Number(v))) return k;
  }
  return null;
}
/* Numeric residential density published by a plan (Eagle resdenmax / usedensity "4 du/acre"), else null. */
export function fluPlanDensity(props, cfg){
  if(cfg && cfg.denField){ const v=+props[cfg.denField]; if(v>0) return v; }
  if(cfg && cfg.denText && props[cfg.denText]){ const m=(""+props[cfg.denText]).match(/([\d.]+)/); if(m && +m[1]>0) return +m[1]; }
  return null;
}
