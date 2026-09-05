import { getServiceDefinition } from '../../service-forms'
import { NotFound } from '../NotFound'
import { DynamicServiceFormPage } from './DynamicServiceFormPage'
import { SpecializedServiceFormPage } from './SpecializedServiceFormPage'

export function ServiceFormPage({ serviceKey }: { serviceKey: string }) {
  const definition = getServiceDefinition(serviceKey)
  if (!definition) return <NotFound />
  return definition.mode === 'SPECIALIZED' ? (
    <SpecializedServiceFormPage serviceKey={serviceKey} />
  ) : (
    <DynamicServiceFormPage serviceKey={serviceKey} />
  )
}
