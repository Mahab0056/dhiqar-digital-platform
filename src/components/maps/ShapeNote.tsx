import { Info } from 'lucide-react'
import { SHAPE_NOTE, type BuildingShape } from './building-shape'

/** the card line; an approximate shape is set apart so it is not read past */
export function ShapeNote({ shape }: { shape: BuildingShape }) {
  const approximate = shape !== 'osm'
  return (
    <p className={`map3d-card-source map3d-card-shape${approximate ? ' is-approx' : ''}`} data-shape={shape}>
      {approximate && <Info aria-hidden="true" />}
      {SHAPE_NOTE[shape]}
    </p>
  )
}
