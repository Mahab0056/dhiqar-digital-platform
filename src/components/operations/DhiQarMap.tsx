import { Map } from 'lucide-react'
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip as LeafletTooltip } from 'react-leaflet'
import type { DashboardStats } from '../../types'

export function DhiQarMap({ departments }: { departments: DashboardStats['departments'] }) {
  const located = departments.filter(
    (department): department is typeof department & { lat: number; lng: number } =>
      typeof department.lat === 'number' && typeof department.lng === 'number'
  )
  return (
    <section className="real-gis-shell">
      <div className="real-gis-head">
        <div>
          <span className="section-kicker">GIS موثق المصدر</span>
          <h2>خريطة الجهات ذات المواقع المتحققة</h2>
          <p>
            تعرض الخريطة مواقع الجهات التي توافرت لها إحداثيات منشأة محددة. اضغط على النقطة لعرض المصدر وحالة البيانات.
          </p>
        </div>
        <span>
          <Map /> {located.length.toLocaleString('en-US')} نقطة منشأة موثقة
        </span>
      </div>
      <MapContainer center={[31.052, 46.249]} zoom={13} scrollWheelZoom className="real-gis-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {located.map(department => (
          <CircleMarker
            key={department.id}
            center={[department.lat, department.lng]}
            radius={9}
            pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#0a8f50', fillOpacity: 1 }}
          >
            <LeafletTooltip direction="top" offset={[0, -8]} opacity={1}>
              {department.name}
            </LeafletTooltip>
            <Popup>
              <div className="gis-popup">
                <strong>{department.name}</strong>
                <span>
                  {department.district} — {department.type}
                </span>
                <small>
                  {department.lat.toFixed(6)}, {department.lng.toFixed(6)}
                </small>
                {department.sourceUrl && (
                  <a href={department.sourceUrl} target="_blank" rel="noreferrer">
                    فتح مصدر الموقع ↗
                  </a>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      <div className="real-gis-legend">
        <span>
          <i className="verified" /> إحداثيات منشأة متحققة
        </span>
        <span>
          <i className="pending" /> الجهات بلا نقطة تبقى في السجل ولا تُرسم
        </span>
      </div>
    </section>
  )
}
