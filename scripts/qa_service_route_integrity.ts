import { serviceDefinitions, getServiceDefinition } from '../src/service-forms'
import { services } from '../src/data'
import { readFileSync } from 'node:fs'

const keys = serviceDefinitions.map(service => service.key)
const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index)
if (duplicates.length) throw new Error(`Duplicate service keys: ${duplicates.join(', ')}`)

for (const service of services) {
  const definition = getServiceDefinition(service.key)
  if (!definition) throw new Error(`Missing definition for ${service.key}`)
  if (definition.title !== service.title) throw new Error(`Title mismatch for ${service.key}`)
  if (definition.mode !== 'EXTERNAL' && definition.mode !== 'SPECIALIZED' && definition.fields.length === 0) {
    throw new Error(`Missing specialized form fields for ${service.key}`)
  }
}

const specialized = serviceDefinitions.filter(service => service.mode === 'SPECIALIZED').map(service => service.key)
if (specialized.length !== 1 || specialized[0] !== 'store-license') throw new Error('Only store-license may use the specialized form')

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
if (app.includes('href="/service/store-license"')) throw new Error('A generic citizen action still opens store-license directly')
if (!app.includes('availableServices.map(service')) throw new Error('Citizen direct catalog is not rendering all services')
if (!app.includes('href={`/service/${service.key}`}')) throw new Error('Service cards do not use each service key')

console.log(`service_route_integrity=pass services=${services.length} specialized=${specialized.length}`)
