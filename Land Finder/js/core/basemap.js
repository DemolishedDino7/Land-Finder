/* basemap.js — the map tiles, and the ONE place the CARTO key lives.

   CARTO retired keyless access to these basemaps, so without a key their CDN serves
   "API KEY REQUIRED" watermark tiles instead of the light-grey canvas. A key is free
   (5M tiles/month) from https://carto.com/basemaps/apikey/ — paste it below and the
   watermark goes away everywhere in the app.

   Note their raster service is being retired in favour of vector basemaps. The same key
   covers both, so that migration is a MapLibre swap later, not another signup. */
export const CARTO_KEY = "";   // <-- paste the key here

export function basemapUrl(){
  const base = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  return CARTO_KEY ? base + '?key=' + encodeURIComponent(CARTO_KEY) : base;
}
export const BASEMAP_OPTS = { subdomains:'abcd', maxZoom:20 };
