import { Link } from 'wouter'
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip as LeafletTooltip } from 'react-leaflet'
import { sectorOf, type LocatedDepartment } from './departments-map-model'
import { plainLeafletPrefix } from './leaflet-attribution'
import { OSM_TILE_ATTRIBUTION, OSM_TILE_MAX_ZOOM, OSM_TILE_URL } from './osm-tiles'

/** Flat 2D fallback — used when WebGL is unavailable or the 3D map's style/tiles fail to load. */
export function DepartmentsLeafletMap({ departments }: { departments: LocatedDepartment[] }) {
  return (
    <MapContainer
      ref={plainLeafletPrefix}
      center={[31.05, 46.25]}
      zoom={11}
      scrollWheelZoom={false}
      className="depts-leaflet"
    >
      <TileLayer attribution={OSM_TILE_ATTRIBUTION} url={OSM_TILE_URL} maxZoom={OSM_TILE_MAX_ZOOM} />
      {departments.map(item => (
        <CircleMarker
          key={item.id}
          center={[item.lat, item.lng]}
          radius={8}
          pathOptions={{ color: '#ffffff', weight: 2, fillColor: sectorOf(item.category).color, fillOpacity: 1 }}
        >
          <LeafletTooltip direction="top" offset={[0, -8]} opacity={1}>
            {item.name}
          </LeafletTooltip>
          <Popup>
            <div className="gis-popup">
              <strong>{item.name}</strong>
              <span>
                {item.district} — {item.category}
              </span>
              <Link href={`/departments/${item.id}`}>صفحة الدائرة ←</Link>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
