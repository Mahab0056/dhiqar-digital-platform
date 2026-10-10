import { lazy, Suspense, useState } from 'react'
import { MapBoundary } from './map-fallback'
import { hasWebGL } from './webgl'
import { DepartmentsLeafletMap } from './DepartmentsLeafletMap'
import type { LocatedDepartment } from './departments-map-model'

// MapLibre (~1 MB) is only fetched by pages that show this map
const DhiQar3DMap = lazy(() => import('./DhiQar3DMap'))

type Props = {
  /** every located department (drawn once, so filtering can animate pillars in and out) */
  departments: LocatedDepartment[]
  /** ids that pass the page's filters */
  visibleIds: ReadonlySet<string>
}

/** 3D departments map with an automatic fallback to the flat Leaflet map. */
export function DepartmentsMap({ departments, visibleIds }: Props) {
  const [mode, setMode] = useState<'3d' | '2d'>(() => (hasWebGL() ? '3d' : '2d'))
  const visible = departments.filter(item => visibleIds.has(item.id))
  const flat = <DepartmentsLeafletMap departments={visible} />

  if (mode === '2d') return flat
  return (
    <MapBoundary fallback={flat}>
      <Suspense fallback={<div className="map3d-shell is-loading" aria-hidden="true" />}>
        <DhiQar3DMap departments={departments} visibleIds={visibleIds} onUnavailable={() => setMode('2d')} />
      </Suspense>
    </MapBoundary>
  )
}
