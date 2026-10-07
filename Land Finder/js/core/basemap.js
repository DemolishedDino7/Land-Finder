/* basemap.js — the map tiles. The one place basemap choice and the optional CARTO key live.

   CARTO retired keyless access to their basemaps: with no key their CDN serves
   "API KEY REQUIRED" watermark tiles instead of the light-grey canvas. So with no key the app
   falls back to Esri's World Light Gray Canvas, which is keyless and looks nearly the same
   (base + a separate label layer). To go back to CARTO, get a free key
   (5M tiles/month) from https://carto.com/basemaps/apikey/ and paste it below. Nothing else
   needs to change. */
export const CARTO_KEY = "";   // <-- optional: paste a CARTO key here to use CARTO instead of Esri

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';

export function basemapUrl(){
  if(CARTO_KEY)
    return 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=' + encodeURIComponent(CARTO_KEY);
  return ESRI + '/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
}

/* Esri's canvas splits labels into their own layer; CARTO's light_all has them baked in. */
export function labelsUrl(){
  return CARTO_KEY ? null : ESRI + '/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
}

/* Esri's canvas stops at native zoom 16; Leaflet upscales past that so parcel zooms (15+) still work. */
export const BASEMAP_OPTS = CARTO_KEY
  ? { subdomains:'abcd', maxZoom:20 }
  : { maxNativeZoom:16, maxZoom:20 };

export const BASEMAP_ATTRIBUTION = CARTO_KEY
  ? '&copy; OpenStreetMap, &copy; CARTO'
  : 'Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
