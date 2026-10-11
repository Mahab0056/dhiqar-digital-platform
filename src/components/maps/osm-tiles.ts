// The OpenStreetMap raster tiles every Leaflet map on the platform draws (the public department page, the 2D
// fallback of the departments map, the location picker and the operations map's «خريطة» basemap), and the credit
// the OSM tile usage policy requires on each of them (https://operations.osmfoundation.org/policies/tiles/).
// One host: the a/b/c subdomains are deprecated and only defeat HTTP/2 connection reuse and browser caching.
// No Leaflet or MapLibre import here, so any page can use it without pulling a map chunk.

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
/** OSM's own tiles go up to 19 */
export const OSM_TILE_MAX_ZOOM = 19
