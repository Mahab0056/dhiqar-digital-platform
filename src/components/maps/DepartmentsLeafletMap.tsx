import { Link } from 'wouter'
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip as LeafletTooltip } from 'react-leaflet'
import { sectorOf, type LocatedDepartment } from './departments-map-model'

/** Flat 2D fallback — used when WebGL is unavailable or the 3D map's style/tiles fail to load. */
export function DepartmentsLeafletMap({ departments }: { departments: LocatedDepartment[] }) {
  return (
    <MapContainer center={[31.05, 46.25]} zoom={11} scrollWheelZoom={false} className="depts-leaflet">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
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
