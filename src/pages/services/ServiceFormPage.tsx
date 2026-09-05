import { getServiceDefinition } from '../../service-forms'
import { DynamicServiceFormPage } from './DynamicServiceFormPage'
import { SpecializedServiceFormPage } from './SpecializedServiceFormPage'

/** Services with a bespoke flow (e.g. store license with GIS) keep their specialized page; everything else is catalog-driven. */
export function ServiceFormPage({ serviceKey }: { serviceKey: string }) {
  const definition = getServiceDefinition(serviceKey)
  return definition?.mode === 'SPECIALIZED' ? (
    <SpecializedServiceFormPage serviceKey={serviceKey} />
  ) : (
    <DynamicServiceFormPage serviceKey={serviceKey} />
  )
}
