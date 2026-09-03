/* saved.js — the parcels a user has starred.

   Deliberately written against a tiny `backend` interface rather than calling localStorage
   directly, because this is the piece that has to move server-side the moment there are real
   accounts: swap `localBackend` for a Supabase-backed one with the same four methods and saves
   start following the user across devices, with nothing else in the app changing.

   Until then this is per-browser only. Clearing site data clears the list — say so in the UI
   rather than letting someone assume their shortlist is safe somewhere. */

const KEY = "landfinder.saved.v1";

const localBackend = {
  async all(){
    try{ const raw=localStorage.getItem(KEY); return raw? JSON.parse(raw) : []; }
    catch(e){ return []; }   // private windows / blocked site data throw on access
  },
  async put(rec){
    const all=await this.all().catch(()=>[]);
    const i=all.findIndex(r=>r.id===rec.id && r.region===rec.region);
    if(i>=0) all[i]=rec; else all.push(rec);
    try{ localStorage.setItem(KEY, JSON.stringify(all)); }catch(e){}
    return rec;
  },
  async remove(id, region){
    const all=(await this.all().catch(()=>[])).filter(r=>!(r.id===id && r.region===region));
    try{ localStorage.setItem(KEY, JSON.stringify(all)); }catch(e){}
  },
  async clear(){ try{ localStorage.removeItem(KEY); }catch(e){} }
};

let backend = localBackend;
export function setBackend(b){ backend = b; }

let cache = [];
const listeners = new Set();
export function onChange(fn){ listeners.add(fn); return ()=>listeners.delete(fn); }
function emit(){ listeners.forEach(fn=>{ try{ fn(cache); }catch(e){} }); }

export async function load(){ cache = await backend.all(); emit(); return cache; }
export function all(){ return cache; }
export function forRegion(regionId){ return cache.filter(r=>r.region===regionId); }
export function isSaved(id, regionId){ return cache.some(r=>r.id===id && r.region===regionId); }

/* Snapshot the numbers as they were when saved. The verdict depends on the market assumptions in
   the panel, which the user edits constantly — so the list shows what it looked like when starred,
   and flags it as a snapshot rather than pretending to be live. */
export async function toggle(p, s, region){
  const id = p.props.PARCEL;
  if(!id) return false;
  if(isSaved(id, region.id)){
    await backend.remove(id, region.id);
    cache = cache.filter(r=>!(r.id===id && r.region===region.id));
    emit(); return false;
  }
  const rec = {
    id, region:region.id,
    address: p.props.ADDRESS || "(no address)",
    city: p.props.CITY_STATE || region.short,
    acres: p.acres || 0,
    centroid: p.centroid || null,
    verdict: s.verdict, fairOffer: s.fairOffer, price: s.price,
    use: s.best ? s.best.product : (s.protectedLand ? "Protected / public" : "—"),
    estimated: !!s.estimated,
    savedAt: Date.now(), note: ""
  };
  await backend.put(rec);
  cache = cache.concat([rec]);
  emit(); return true;
}
export async function remove(id, regionId){
  await backend.remove(id, regionId);
  cache = cache.filter(r=>!(r.id===id && r.region===regionId));
  emit();
}
export async function setNote(id, regionId, note){
  const rec = cache.find(r=>r.id===id && r.region===regionId);
  if(!rec) return;
  rec.note = note; await backend.put(rec); emit();
}
export async function clearAll(){ await backend.clear(); cache=[]; emit(); }
