import { useEffect, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { Crosshair, LocateFixed, Search, X } from 'lucide-react'

export type PickedLocation = { lat: number; lng: number; address?: string | null; accuracyM?: number | null }

/** Thi Qar governorate bounding box (used to bias the address search). */
const THI_QAR_VIEWBOX = '45.6,32.4,47.4,30.2'
const DEFAULT_CENTER: [number, number] = [31.052, 46.249] // Nasiriyah

const pinIcon = L.divIcon({
  className: 'gov-map-pin',
  html: '<span class="gov-map-pin-dot"></span><span class="gov-map-pin-pulse"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 24],
})

function Recenter({ target }: { target: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 16), { duration: 0.6 })
  }, [map, target])
  return null
}

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: event => onPick(event.latlng.lat, event.latlng.lng) })
  return null
}

type GeocodeHit = { display_name: string; lat: string; lon: string }

/**
 * Real map location picker: OpenStreetMap tiles, click/drag to place the pin, "my location" via GPS,
 * and address search / reverse geocoding through Nominatim (biased to Thi Qar, Arabic labels).
 */
export function LocationPicker({
  value,
  onChange,
  height = 360,
  placeholder = 'اكتب العنوان: الحي، الشارع، أقرب معلم… أو حدد على الخريطة',
}: {
  value: PickedLocation | null
  onChange: (value: PickedLocation | null) => void
  height?: number
  placeholder?: string
}) {
  const [query, setQuery] = useState(value?.address || '')
  const [hits, setHits] = useState<GeocodeHit[]>([])
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [message, setMessage] = useState('')
  const [target, setTarget] = useState<[number, number] | null>(value ? [value.lat, value.lng] : null)
  const debounce = useRef<number | null>(null)

  const reverse = async (lat: number, lng: number) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ar&zoom=18`,
        { headers: { Accept: 'application/json' } }
      )
      if (!response.ok) return null
      const body = (await response.json()) as { display_name?: string }
      return body.display_name || null
    } catch {
      return null
    }
  }

  const place = async (lat: number, lng: number, accuracyM: number | null = null, knownAddress?: string) => {
    const rounded = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 }
    onChange({ ...rounded, accuracyM, address: knownAddress ?? value?.address ?? null })
    setTarget([rounded.lat, rounded.lng])
    if (!knownAddress) {
      const address = await reverse(rounded.lat, rounded.lng)
      if (address) {
        setQuery(address)
        onChange({ ...rounded, accuracyM, address })
      }
    }
  }

  const locate = () => {
    if (!('geolocation' in navigator)) return setMessage('المتصفح لا يدعم تحديد الموقع.')
    setLocating(true)
    setMessage('')
    navigator.geolocation.getCurrentPosition(
      position => {
        setLocating(false)
        void place(position.coords.latitude, position.coords.longitude, Math.round(position.coords.accuracy))
      },
      error => {
        setLocating(false)
        setMessage(
          error.code === error.PERMISSION_DENIED
            ? 'اسمح للموقع باستخدام GPS من إعدادات المتصفح، أو حدد الموقع على الخريطة.'
            : 'تعذر تحديد الموقع الحالي. حدده على الخريطة أو اكتب العنوان.'
        )
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
    )
  }

  const search = (term: string) => {
    setQuery(term)
    if (debounce.current) window.clearTimeout(debounce.current)
    if (term.trim().length < 3) {
      setHits([])
      return
    }
    debounce.current = window.setTimeout(async () => {
      setSearching(true)
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=iq&accept-language=ar&viewbox=${THI_QAR_VIEWBOX}&bounded=0&q=${encodeURIComponent(term.trim())}`,
          { headers: { Accept: 'application/json' } }
        )
        setHits(response.ok ? ((await response.json()) as GeocodeHit[]) : [])
      } catch {
        setHits([])
      } finally {
        setSearching(false)
      }
    }, 350)
  }

  return (
    <div className="gov-location-picker">
      <div className="gov-location-toolbar">
        <div className="gov-location-search">
          <Search />
          <input
            value={query}
            onChange={event => search(event.target.value)}
            placeholder={placeholder}
            aria-label="البحث عن عنوان"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              aria-label="مسح"
              onClick={() => {
                setQuery('')
                setHits([])
              }}
            >
              <X size={16} />
            </button>
          )}
          {(hits.length > 0 || searching) && (
            <ul className="gov-location-hits" role="listbox">
              {searching && <li className="muted">جاري البحث…</li>}
              {hits.map(hit => (
                <li key={`${hit.lat}-${hit.lon}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setHits([])
                      setQuery(hit.display_name)
                      void place(Number(hit.lat), Number(hit.lon), null, hit.display_name)
                    }}
                  >
                    {hit.display_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className="button outline" onClick={locate} disabled={locating}>
          <LocateFixed /> {locating ? 'جاري التحديد…' : 'موقعي الحالي'}
        </button>
      </div>
      <div className="gov-location-map" style={{ height }}>
        <MapContainer
          center={value ? [value.lat, value.lng] : DEFAULT_CENTER}
          zoom={value ? 16 : 12}
          scrollWheelZoom
          className="real-gis-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickToPlace onPick={(lat, lng) => void place(lat, lng)} />
          <Recenter target={target} />
          {value && (
            <Marker
              position={[value.lat, value.lng]}
              icon={pinIcon}
              draggable
              eventHandlers={{
                dragend: event => {
                  const point = (event.target as L.Marker).getLatLng()
                  void place(point.lat, point.lng)
                },
              }}
            />
          )}
        </MapContainer>
        {!value && (
          <div className="gov-location-hint">
            <Crosshair /> اضغط على الخريطة لتحديد الموقع، أو استخدم «موقعي الحالي»، أو اكتب العنوان.
          </div>
        )}
      </div>
      <div className="gov-location-status">
        {value ? (
          <>
            <span>
              {value.address ? value.address : `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`}
              {value.accuracyM ? ` (دقة ±${value.accuracyM} م)` : ''}
            </span>
            <button type="button" className="text-action" onClick={() => onChange(null)}>
              إزالة
            </button>
          </>
        ) : (
          <span className="muted">{message || 'لم يُحدد موقع بعد.'}</span>
        )}
        {message && value && <em>{message}</em>}
      </div>
    </div>
  )
}
