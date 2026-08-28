import { readFileSync } from 'node:fs'

const source = readFileSync('src/App.tsx', 'utf8')
const checks = [
  ['خريطة الناصرية', 'function NasiriyahLocationMap'],
  ['مركز الناصرية', '[31.05799, 46.2563]'],
  ['طبقة خرائط فعلية', 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'],
  ['تحديد النقطة بالنقر', 'useMapEvents({ click: event => onSelect'],
  ['مؤشر الموقع المختار', 'الموقع المختار'],
  ['حفظ اختيار الخريطة', "saveChosenLocation(value, 'map')"],
  ['زر GPS', 'navigator.geolocation.getCurrentPosition'],
  ['حفظ الموقع المحمي', 'api.updateCitizenLocation'],
]
for (const [label, needle] of checks) if (!source.includes(needle)) throw new Error(`missing: ${label}`)
console.log('nasiriyah_location_map_qa=pass')
