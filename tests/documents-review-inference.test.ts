// Default document template of every catalog service. A wrong default issues a legally wrong official document
// (an inquiry printed as «قرار تخصيص», an instalment request as «براءة ذمة»), so the whole mapping is pinned here:
// any change to the inference rules or to the catalog must be reviewed against this list.
import { beforeAll, describe, expect, it } from 'vitest'
import { configureTestEnv } from './helpers'

configureTestEnv()

/** Every document-issuing service whose default is not the completion notice. Everything else: completion-notice. */
const PINNED: Record<string, string[]> = {
  'allocation-decision': ['muni-dir-cemetery-plot', 'muni-dir-industrial-land-allocation'],
  'appointment-notice': [
    'civ-national-id-booking',
    'health-disability-committee',
    'health-medical-committee-booking',
    'museum-group-visit',
    'nid-first-issue',
    'shat-civ-national-id',
  ],
  'building-permit': [
    'building-permit',
    'chb-muni-building-permit',
    'muni-dir-building-permit-districts',
    'nas-muni-building-permit',
    'nsr-muni-building-permit',
    'rif-muni-building-permit',
    'sha-muni-building-permit',
    'suq-muni-building-permit',
  ],
  certificate: [
    'civ-nationality-certificate',
    'edu-lost-certificate-replacement',
    'forensic-non-conviction-external',
    'forensic-non-conviction-internal',
    'health-birth-certificate',
    'health-death-certificate',
    'health-fitness-certificate',
    'health-food-handler-certificate',
    'police-criminal-record-external',
    'police-non-conviction',
    'shat-civ-nationality-certificate',
    'vet-health-certificate',
  ],
  clearance: ['hf-clearance', 'tax-clearance', 'tax-shatrah-clearance', 'tax-vehicle-clearance'],
  'endorsement-letter': [
    'agri-wheat-marketing',
    'akk-nh-document-certification',
    'akk-nh-residence-confirmation',
    'bth-qm-document-certification',
    'bth-qm-residence-confirmation',
    'chamber-company-name-reservation',
    'chamber-document-attestation',
    'chb-qm-document-certification',
    'chb-qm-residence-confirmation',
    'civ-record-copy',
    'dwy-qm-document-certification',
    'dwy-qm-residence-confirmation',
    'edu-document-authentication-travel',
    'edu-school-document-issuance',
    'fjr-qm-document-certification',
    'fjr-qm-residence-confirmation',
    'fuh-qm-document-certification',
    'fuh-qm-residence-confirmation',
    'ghr-qm-document-certification',
    'ghr-qm-residence-confirmation',
    'gov-official-statement',
    'isl-qm-document-certification',
    'isl-qm-residence-confirmation',
    'nas-qm-document-certification',
    'nas-qm-residence-confirmation',
    'nsr-muni-realty-transaction-statement',
    'nsr-qm-document-certification',
    'nsr-qm-residence-confirmation',
    'nti-document-verification',
    'nti-graduation-document',
    'pension-confirmation',
    'ps-hujja-external-marriage',
    'qls-qm-document-certification',
    'qls-qm-residence-confirmation',
    're1-open-statement',
    're2-open-statement',
    'rif-muni-realty-transaction-statement',
    'rif-qm-document-certification',
    'rif-qm-residence-confirmation',
    'sdk-qm-document-certification',
    'sdk-qm-residence-confirmation',
    'sha-qm-document-certification',
    'sha-qm-residence-confirmation',
    'shat-civ-record-copy',
    'shu-document-verification',
    'shu-graduation-document',
    'spa-annual-statement',
    'spa-north-annual-statement',
    'sti-document-verification',
    'sti-graduation-document',
    'suq-muni-realty-transaction-statement',
    'suq-qm-document-certification',
    'suq-qm-residence-confirmation',
    'uos-document-verification',
    'uos-graduation-document',
    'utq-document-verification',
    'utq-graduation-document',
    'vet-clinic-license-support',
  ],
  'general-licence': [
    'agri-office-license',
    'antiq-excavation-mission-request',
    'antiq-site-visit-permit',
    'driving-license',
    'edu-kindergarten-license',
    'edu-private-institute-license',
    'edu-private-school-license',
    'health-private-clinic-license',
    'health-private-lab-license',
    'health-private-pharmacy-license',
    'invest-license-application',
    'labor-foreign-work-permit',
    'mowr-pump-license',
    'mowr-well-drilling-license',
    'nas-muni-demolition-permit',
    'nas-muni-signboard-permit',
    'opdc-fuel-station-license',
    'police-firearm-license',
    'roads-work-permit',
    'sewer-septic-tank-license',
    'traffic-driving-license-first',
    'traffic-driving-license-international',
    'traffic-driving-license-renew',
    'traffic-driving-license-replacement',
  ],
  'id-card': [
    'chamber-membership-new',
    'chamber-membership-renewal',
    'disability-id-card',
    'ppf-digital-id',
    'youth-forum-membership',
  ],
  'preliminary-approval': ['invest-land-preliminary-approval', 'urban-planning-approval'],
  'profession-licence': [
    'chb-muni-profession-license',
    'nas-muni-profession-license',
    'nsr-muni-profession-license',
    'rif-muni-profession-license',
    'sha-muni-profession-license',
    'suq-muni-profession-license',
  ],
  'renovation-permit': [
    'chb-muni-renovation-permit',
    'nas-muni-renovation-permit',
    'nsr-muni-renovation-permit',
    'rif-muni-renovation-permit',
    'sha-muni-renovation-permit',
    'suq-muni-renovation-permit',
  ],
  'shop-licence': ['store-license'],
  'technical-approval': [
    'antiq-project-clearance',
    'cd-generator-approval',
    'cd-shop-safety-cert',
    'env-approval-renewal',
    'env-project-approval',
    'gov-furniture-transfer-approval',
    'gov-ration-card-transfer-approval',
    'health-shop-sanitary-approval',
    'mod-crossing-permit',
    'shat-cd-shop-safety-cert',
  ],
}

type Service = { key: string; title: string; category: string; channel: string; mode: string }
let services: Service[] = []
let inferTemplateId: (service: Service) => string
let issues: (service: Service) => boolean

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  createPlatformServer({ serveStatic: false })
  const catalog = await import('../server/services/catalog.ts')
  services = catalog.listCatalogServices({ activeOnly: false }) as Service[]
  inferTemplateId = (await import('../server/documents/templates.ts')).inferTemplateId
  issues = (await import('../server/routes/service-requests.ts')).serviceIssuesDocument
})

describe('default template of every catalog service', () => {
  it('matches the pinned mapping for every service that issues a document', () => {
    const expected = new Map(Object.entries(PINNED).flatMap(([template, keys]) => keys.map(key => [key, template])))
    const issuing = services.filter(service => issues(service))
    expect(issuing.length).toBeGreaterThan(300)
    const wrong = issuing
      .map(service => ({
        key: service.key,
        title: service.title,
        inferred: inferTemplateId(service),
        expected: expected.get(service.key) || 'completion-notice',
      }))
      .filter(item => item.inferred !== item.expected)
    expect(wrong).toEqual([])
    // every pinned key still exists (a renamed service must be re-reviewed, not silently fall back)
    const keys = new Set(issuing.map(service => service.key))
    expect([...expected.keys()].filter(key => !keys.has(key))).toEqual([])
  })

  it('the findings: inquiries, statements, instalments and bookings never get an allocation, clearance or appointment', () => {
    const byKey = new Map(services.map(service => [service.key, service]))
    const of = (key: string) => inferTemplateId(byKey.get(key) as Service)
    for (const key of [
      'urban-master-plan-info',
      'nas-muni-no-benefit-statement',
      're1-boundary-fix',
      're2-boundary-fix',
    ])
      expect(of(key)).not.toBe('allocation-decision')
    for (const key of ['water-bill-payment-request', 'elec-bill-payment-request'])
      expect(of(key)).toBe('completion-notice')
    expect(of('re1-lien-removal')).toBe('completion-notice')
    for (const key of ['chamber-company-name-reservation', 'youth-facility-booking', 'agri-wheat-marketing'])
      expect(of(key)).not.toBe('appointment-notice')
    expect(of('hf-construction-loan')).toBe('completion-notice')
    expect(of('antiq-project-clearance')).toBe('technical-approval')
  })

  it('legally loaded templates are never inferred from keywords for an unlisted service', () => {
    const unlisted = [
      { key: 'x-1', title: 'حجز موعد لمراجعة الدائرة' },
      { key: 'x-2', title: 'براءة ذمة مالية' },
      { key: 'x-3', title: 'رفع الحجز عن العقار' },
      { key: 'x-4', title: 'تخصيص قطعة أرض سكنية' },
      { key: 'x-5-booking', title: 'طلب جديد' },
      { key: 'x-6-clearance', title: 'طلب جديد' },
      { key: 'x-7-land-plot', title: 'طلب جديد' },
    ]
    for (const service of unlisted)
      expect(['allocation-decision', 'clearance', 'appointment-notice']).not.toContain(
        inferTemplateId({ ...service, category: '', channel: 'ONLINE_SUBMISSION', mode: 'CATALOG' })
      )
  })
})
