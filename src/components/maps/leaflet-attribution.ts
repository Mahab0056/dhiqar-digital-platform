// The «Leaflet» credit that opens the attribution line of every Leaflet (2D) map on the platform: the public
// department page, the 2D fallback of the departments map, the location picker and the operations map. Leaflet 1.9
// puts a flag icon in front of it by default; the platform shows the plain link instead.
// No Leaflet import here (the map is typed structurally), so importing it never pulls a map chunk.

export const LEAFLET_ATTRIBUTION_PREFIX = '<a href="https://leafletjs.com">Leaflet</a>'

/** The part of a Leaflet map this module touches. */
type AttributedMap = { attributionControl?: { setPrefix(prefix: string | false): unknown } | null }

/**
 * `ref` of every react-leaflet `<MapContainer>`: swaps Leaflet's default attribution prefix for
 * {@link LEAFLET_ATTRIBUTION_PREFIX} as soon as the map exists (before it paints). The attribution control itself
 * stays, with the OpenStreetMap credit the tile layers add to it.
 */
export function plainLeafletPrefix(map: AttributedMap | null) {
  map?.attributionControl?.setPrefix(LEAFLET_ATTRIBUTION_PREFIX)
}
