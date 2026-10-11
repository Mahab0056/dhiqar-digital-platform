// Citizen-side document UI:
// - the dashboard counted and listed rejection decisions / referral letters / receipts as «وثائق معتمدة»;
// - a closed (rejected / approved / cancelled) request still showed every attachment «بانتظار التدقيق» and asked the
//   citizen to re-upload;
// - the templates editor kept its green «حُفظ» message after later edits and failed saves.
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Router } from 'wouter'
import { describe, expect, it } from 'vitest'
import type { IssuedDocument } from '../src/types'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const doc = (
  id: string,
  issueEvent: IssuedDocument['issueEvent'],
  title: string,
  status: IssuedDocument['status'] = 'ACTIVE',
  issuedAt = '2026-09-01T10:00:00.000Z'
): IssuedDocument => ({
  id,
  sourceKind: 'SERVICE_REQUEST',
  serviceRequestReference: `SR-${id}`,
  serviceName: 'التقديم على الدور واطئة الكلفة',
  departmentName: 'ديوان محافظة ذي قار',
  documentTitle: title,
  documentNumber: `TQD-GOV-2026-00000${id}`,
  verificationId: `TQD1.CODE${id}`,
  status,
  issuedAt,
  revokedReason: status === 'REVOKED' ? 'أُعيد النظر في القرار' : null,
  pdfUrl: `/api/citizen/issued-documents/${id}/pdf`,
  pdfDownloadUrl: `/api/citizen/issued-documents/${id}/pdf?download=1`,
  issueEvent,
})

const archive = [
  doc('1', null, 'إجازة بناء'),
  doc('2', 'REJECTION', 'قرار رفض مسبّب'),
  doc('3', 'REFERRAL', 'كتاب إحالة', 'ACTIVE', '2026-09-03T10:00:00.000Z'),
  doc('4', 'RECEIPT', 'وصل استلام', 'ACTIVE', '2026-09-04T10:00:00.000Z'),
  doc('5', undefined, 'شهادة صحية'),
  doc('6', null, 'إجازة محل', 'REVOKED'),
  doc('7', 'REJECTION', 'قرار رفض مسبّب', 'REVOKED'),
]

describe('citizen archive: «الوثائق المعتمدة» apart from «قرارات ومراسلات»', () => {
  it('groups by what the document records; only approval documents in force count as certified', async () => {
    const { groupCitizenDocuments, citizenDocumentKind } =
      await import('../src/components/citizen/citizen-documents.ts')
    const groups = groupCitizenDocuments(archive)
    expect(groups.approvals.map(item => item.id)).toEqual(['1', '5'])
    // the decision first, then the referral, then the receipt
    expect(groups.correspondence.map(item => item.id)).toEqual(['2', '3', '4'])
    expect(groups.revoked.map(item => item.id)).toEqual(['6', '7'])
    expect(groups.approvals.length + groups.correspondence.length + groups.revoked.length).toBe(archive.length)
    // an older API without issueEvent: those were all approvals
    expect(citizenDocumentKind({ issueEvent: undefined })).toBe('APPROVAL')
  })

  it('renders the two groups with counts that match their lists', async () => {
    const { groupCitizenDocuments } = await import('../src/components/citizen/citizen-documents.ts')
    const { CitizenDocumentArchive } = await import('../src/components/citizen/CitizenDocumentArchive.tsx')
    const html = renderToStaticMarkup(
      createElement(
        Router,
        { ssrPath: '/citizen' },
        createElement(CitizenDocumentArchive, { groups: groupCitizenDocuments(archive) })
      )
    )
    const approvedAt = html.indexOf('الوثائق المعتمدة')
    const decisionsAt = html.indexOf('قرارات ومراسلات')
    const revokedAt = html.indexOf('وثائق ملغاة')
    expect(approvedAt).toBeGreaterThan(-1)
    expect(decisionsAt).toBeGreaterThan(approvedAt)
    expect(revokedAt).toBeGreaterThan(decisionsAt)
    const approvedBlock = html.slice(approvedAt, decisionsAt)
    const decisionsBlock = html.slice(decisionsAt, revokedAt)
    expect(approvedBlock).toMatch(/is-success">2</)
    expect(approvedBlock).toContain('إجازة بناء')
    expect(approvedBlock).toContain('شهادة صحية')
    // the regression: a rejection decision listed (and counted) among the certified documents
    expect(approvedBlock).not.toContain('قرار رفض')
    expect(approvedBlock).not.toContain('كتاب إحالة')
    expect(approvedBlock).not.toContain('وصل استلام')
    expect(decisionsBlock).toMatch(/is-info">3</)
    for (const label of ['قرار رفض', 'كتاب إحالة', 'وصل استلام']) expect(decisionsBlock).toContain(label)
    expect(decisionsBlock).toContain('ليست وثائق اعتماد')
    // revoked: passive wording, no feminine verb
    expect(html).toContain('أُلغيت هذه الوثيقة من قِبل ديوان محافظة ذي قار')
    expect(html).not.toContain('ألغت')
    // nothing calls the whole archive «المعتمدة» any more
    expect(html).not.toContain('وثائقي المعتمدة')
    expect(html).not.toContain('بعد اعتماد الدائرة')
  })

  it('no decisions yet: the decisions group is not shown, the approvals group says there are none', async () => {
    const { groupCitizenDocuments } = await import('../src/components/citizen/citizen-documents.ts')
    const { CitizenDocumentArchive } = await import('../src/components/citizen/CitizenDocumentArchive.tsx')
    const html = renderToStaticMarkup(
      createElement(
        Router,
        { ssrPath: '/citizen' },
        createElement(CitizenDocumentArchive, { groups: groupCitizenDocuments([doc('9', 'REJECTION', 'قرار رفض')]) })
      )
    )
    expect(html).toContain('لا توجد وثائق معتمدة بعد')
    expect(html).toContain('قرارات ومراسلات')
  })

  it('the dashboard stat and the archive read the same groups', () => {
    const page = read('src/pages/citizen/CitizenDashboard.tsx')
    expect(page).toContain('groupCitizenDocuments(issuedDocuments)')
    expect(page).toMatch(/<dt>وثائق معتمدة<\/dt>\s*<dd>\{documentGroups\.approvals\.length/)
    expect(page).toContain('<CitizenDocumentArchive groups={documentGroups} />')
    expect(page).not.toContain('activeDocuments')
    expect(page).not.toContain('وثائقي المعتمدة')
  })
})

type Attachment = {
  key: string
  label: string
  required: boolean
  status: 'MISSING' | 'UPLOADED' | 'VERIFIED' | 'REJECTED'
  rejectionReason: string | null
  updatedAt: string | null
  accepts: Array<'image' | 'pdf'>
}

const attachments: Attachment[] = [
  {
    key: 'id',
    label: 'البطاقة الوطنية',
    required: true,
    status: 'UPLOADED',
    rejectionReason: null,
    updatedAt: null,
    accepts: ['image', 'pdf'],
  },
  {
    key: 'res',
    label: 'بطاقة السكن',
    required: true,
    status: 'UPLOADED',
    rejectionReason: null,
    updatedAt: null,
    accepts: ['image', 'pdf'],
  },
  {
    key: 'photo',
    label: 'صورة شخصية',
    required: true,
    status: 'REJECTED',
    rejectionReason: 'غير واضحة',
    updatedAt: null,
    accepts: ['image'],
  },
  {
    key: 'extra',
    label: 'مستند إضافي',
    required: false,
    status: 'MISSING',
    rejectionReason: null,
    updatedAt: null,
    accepts: ['image', 'pdf'],
  },
  {
    key: 'ok',
    label: 'عقد الزواج',
    required: true,
    status: 'VERIFIED',
    rejectionReason: null,
    updatedAt: null,
    accepts: ['image', 'pdf'],
  },
]

async function renderAttachments(status: string, requiredDocument: string | null = null) {
  const { RequestAttachmentsCard } = await import('../src/components/citizen/RequestAttachmentsCard.tsx')
  return renderToStaticMarkup(
    createElement(RequestAttachmentsCard, {
      status,
      documents: attachments,
      requiredDocument,
      uploading: null,
      onUpload: () => {},
    })
  )
}

describe('attachments of a closed request', () => {
  it.each(['REJECTED', 'CANCELLED', 'APPROVED'])(
    '%s: «أُغلق الطلب», no «بانتظار التدقيق», no re-upload instruction or control',
    async status => {
      const html = await renderAttachments(status, 'كتاب تأييد')
      expect(html).toContain('أُغلق الطلب')
      expect(html).not.toContain('بانتظار التدقيق')
      expect(html).not.toContain('أعد الرفع')
      expect(html).not.toContain('أعد رفع')
      expect(html).not.toContain('إعادة الرفع')
      expect(html).not.toContain('type="file"')
      // the department's last request for an extra document is no longer actionable either
      expect(html).not.toContain('طلبت الدائرة منك')
      // where each attachment ended: verified stays verified, a refused one stays refused
      expect(html).toContain('>مدقق<')
      expect(html).toContain('>مرفوض<')
      expect(html).toContain('سبب الرفض: غير واضحة')
    }
  )

  it('a rejected request says why nothing can be uploaded', async () => {
    expect(await renderAttachments('REJECTED')).toContain('قدّم طلباً جديداً')
  })

  it('an open request keeps the review states and the upload controls', async () => {
    const html = await renderAttachments('ACTION_REQUIRED')
    expect(html).toContain('بانتظار التدقيق')
    expect(html).toContain('مرفوض — أعد الرفع')
    expect(html).toContain('أعد رفع أي مستمسك مرفوض')
    expect(html).toContain('إعادة الرفع')
    expect(html).toContain('type="file"')
    expect(html).not.toContain('أُغلق الطلب')
  })

  it('the request page treats every terminal status as closed', async () => {
    const { attachmentBadge, isClosedRequest } = await import('../src/components/citizen/request-attachments.ts')
    for (const status of ['APPROVED', 'REJECTED', 'CANCELLED']) expect(isClosedRequest(status)).toBe(true)
    for (const status of ['SUBMITTED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'PAYMENT_PENDING'])
      expect(isClosedRequest(status)).toBe(false)
    expect(attachmentBadge('UPLOADED', true, true)).toEqual({ label: 'أُغلق الطلب', tone: 'closed' })
    expect(attachmentBadge('MISSING', true, true)).toEqual({ label: 'أُغلق الطلب', tone: 'closed' })
    const page = read('src/pages/citizen/ServiceRequestPage.tsx')
    expect(page).toContain('const closed = isClosedRequest(request.status)')
    expect(page).toContain('<RequestAttachmentsCard')
    expect(page).not.toContain("'بانتظار التدقيق'")
  })
})

describe('templates editor: the green success message', () => {
  const panel = read('src/components/documents/DocumentTemplatesPanel.tsx')
  const body = (name: string) => {
    const start = panel.indexOf(`const ${name} = async () => {`)
    expect(start).toBeGreaterThan(-1)
    return panel.slice(start, panel.indexOf('\n  }\n', start))
  }

  it('is cleared on entry to save() and reset(), before the request (a failed save never shows it)', () => {
    for (const name of ['save', 'reset']) {
      const code = body(name)
      const cleared = code.indexOf("setMessage('')")
      expect(cleared).toBeGreaterThan(-1)
      expect(cleared).toBeLessThan(code.indexOf('await documentsApi.'))
      // success is announced only after the request resolved
      expect(code.indexOf('setMessage(', cleared + 1)).toBeGreaterThan(code.indexOf('await documentsApi.'))
    }
  })

  it('is cleared by every field edit', () => {
    const edit = panel.slice(panel.indexOf('const edit = (patch: Partial<Draft>) => {'))
    expect(edit.slice(0, edit.indexOf('\n  }\n'))).toContain("setMessage('')")
    const editor = panel.slice(panel.indexOf('<fieldset disabled'), panel.indexOf('</fieldset>'))
    // the function each field's onChange calls: template, title, validity, signer title, signer name, conditions
    const handlers = [...editor.matchAll(/onChange=\{event =>\s*([A-Za-z]+)\(/g)].map(match => match[1])
    expect(handlers).toEqual(['edit', 'edit', 'edit', 'edit', 'edit', 'edit'])
    expect(editor.match(/onChange=/g)).toHaveLength(6)
    expect(editor).not.toContain('setDraft(')
  })
})
