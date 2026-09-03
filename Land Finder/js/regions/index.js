/* index.js — the region registry. Adding a state means adding a descriptor and one line here. */
import { idaho } from './idaho.js';
import { utah }  from './utah.js';

export const REGIONS = [idaho, utah];
export function regionById(id){ return REGIONS.find(r=>r.id===id) || REGIONS[0]; }
