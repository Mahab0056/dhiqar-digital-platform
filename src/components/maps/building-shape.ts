// What a map card says about the building drawn for a department or a facility: a real OpenStreetMap outline, or
// a block the offline scripts generated because OSM has no building outline there (`matchQuality: 'generic'` for
// departments, `g: 1` for facilities). A generated block must never pass for the real building.
// No MapLibre import: shared by both 3D maps' cards and their tests.

export type BuildingShape = 'osm' | 'generic' | 'site'

export const SHAPE_NOTE: Record<BuildingShape, string> = {
  osm: 'شكل المبنى من مخطط OpenStreetMap الحقيقي',
  generic: 'شكل تقريبي — لا توجد حدود مبنى في OpenStreetMap',
  site: 'شكل تقريبي — لا توجد حدود مبنى في OpenStreetMap (يرسم المجمّع كله فقط)',
}

/** a department's footprint (department-buildings.geojson); none at all means a generated stand-in square */
export function departmentShape(print: { generic: boolean; site: boolean } | null | undefined): BuildingShape {
  if (!print || print.generic) return print?.site ? 'site' : 'generic'
  return 'osm'
}
