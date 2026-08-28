import { createHmac } from 'node:crypto'
import { ensureDemoCitizen } from '../server/db.js'

const base = process.env.QA_BASE || 'http://127.0.0.1:8799'
const secret = process.env.SESSION_SECRET || 'issued-document-qa-session-secret-long'
const citizenId = ensureDemoCitizen()
const makeCookie = (role: 'CITIZEN' | 'EMPLOYEE', sub: string) => {
  const payload = Buffer.from(JSON.stringify({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  return `dhiqar_session=${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
const citizenCookie = makeCookie('CITIZEN', String(citizenId))
const employeeCookie = makeCookie('EMPLOYEE', 'qa-employee')
const validWebm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(110_000)])
const faceVideo = () => new Blob([validWebm], { type: 'video/webm' })

const serviceForm = new FormData()
serviceForm.append('serviceKey', 'building-permit')
serviceForm.append('data', JSON.stringify({ applicantCapacity: 'مالك العقار', propertyNumber: 'QA-101', propertyAddress: 'عنوان اختبار صناعي', district: 'الناصرية', constructionType: 'سكني', floors: '1', engineerName: 'مكتب اختبار' }))
serviceForm.append('faceConsent', 'true')
serviceForm.append('faceVideo', faceVideo(), 'face-video-service.webm')
const createdResponse = await fetch(`${base}/api/service-requests`, { method: 'POST', headers: { cookie: citizenCookie }, body: serviceForm })
if (createdResponse.status !== 201) throw new Error(`service creation failed: ${createdResponse.status} ${await createdResponse.text()}`)
const created = await createdResponse.json() as { reference: string }
const approvalResponse = await fetch(`${base}/api/employee/service-requests/${created.reference}`, {
  method: 'PATCH', headers: { 'content-type': 'application/json', cookie: employeeCookie },
  body: JSON.stringify({ status: 'APPROVED', currentAction: 'اكتملت مراجعة البيانات واعتمدت المعاملة ضمن اختبار الأرشفة.' }),
})
if (approvalResponse.status !== 200) throw new Error(`approval failed: ${approvalResponse.status} ${await approvalResponse.text()}`)
const archiveResponse = await fetch(`${base}/api/citizen/issued-documents`, { headers: { cookie: citizenCookie } })
if (archiveResponse.status !== 200) throw new Error(`archive denied: ${archiveResponse.status}`)
const documents = await archiveResponse.json() as Array<{ serviceRequestReference: string; verificationId: string; pdfUrl: string }>
const document = documents.find(item => item.serviceRequestReference === created.reference)
if (!document) throw new Error('issued document was not found in citizen archive')
const protectedPdf = await fetch(`${base}${document.pdfUrl}`, { headers: { cookie: citizenCookie } })
const protectedPdfBytes = Buffer.from(await protectedPdf.arrayBuffer())
if (protectedPdf.status !== 200 || !protectedPdfBytes.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error(`citizen original PDF failed: ${protectedPdf.status}`)
const publicVerify = await fetch(`${base}/api/verify/${document.verificationId}`)
const verification = await publicVerify.json() as { pdfAvailable?: boolean; originalPdfUrl?: string }
if (publicVerify.status !== 200 || !verification.pdfAvailable || !verification.originalPdfUrl) throw new Error(`public verification failed: ${publicVerify.status}`)
const publicPdf = await fetch(`${base}${verification.originalPdfUrl}`)
const publicPdfBytes = Buffer.from(await publicPdf.arrayBuffer())
if (publicPdf.status !== 200 || !publicPdfBytes.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error(`public original PDF failed: ${publicPdf.status}`)

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==', 'base64')
const appForm = new FormData()
appForm.append('serviceKey', 'store-license'); appForm.append('serviceName', 'إجازة فتح محل'); appForm.append('department', 'مديرية بلديات ذي قار')
appForm.append('businessName', 'محل اختبار أرشفة'); appForm.append('activityType', 'متجر'); appForm.append('address', 'عنوان اختبار صناعي'); appForm.append('district', 'الناصرية'); appForm.append('ownershipType', 'rent')
appForm.append('coordinates', JSON.stringify({ lat: 31.05, lng: 46.26 })); appForm.append('fee', '0'); appForm.append('faceConsent', 'true')
appForm.append('propertyDocument', new Blob([validPng], { type: 'image/png' }), 'lease.png')
appForm.append('storefrontPhoto', new Blob([validPng], { type: 'image/png' }), 'storefront.png')
appForm.append('faceVideo', faceVideo(), 'face-video-application.webm')
const applicationResponse = await fetch(`${base}/api/applications`, { method: 'POST', headers: { cookie: citizenCookie }, body: appForm })
if (applicationResponse.status !== 201) throw new Error(`application creation failed: ${applicationResponse.status} ${await applicationResponse.text()}`)
const application = await applicationResponse.json() as { reference: string }
const appApproval = await fetch(`${base}/api/applications/${application.reference}/approve`, { method: 'POST', headers: { cookie: employeeCookie } })
if (appApproval.status !== 200) throw new Error(`application approval failed: ${appApproval.status} ${await appApproval.text()}`)
const archiveAfterApplication = await fetch(`${base}/api/citizen/issued-documents`, { headers: { cookie: citizenCookie } })
const documentsAfterApplication = await archiveAfterApplication.json() as Array<{ applicationReference: string; pdfUrl: string }>
const applicationDocument = documentsAfterApplication.find(item => item.applicationReference === application.reference)
if (!applicationDocument) throw new Error('application PDF was not archived')
const applicationPdf = await fetch(`${base}${applicationDocument.pdfUrl}`, { headers: { cookie: citizenCookie } })
if (applicationPdf.status !== 200 || !Buffer.from(await applicationPdf.arrayBuffer()).subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error('application archived PDF could not be opened')
const unauthorizedArchive = await fetch(`${base}/api/citizen/issued-documents`)
if (unauthorizedArchive.status !== 401) throw new Error(`citizen archive unexpectedly public: ${unauthorizedArchive.status}`)
console.log('issued_document_archive_qa=pass')
