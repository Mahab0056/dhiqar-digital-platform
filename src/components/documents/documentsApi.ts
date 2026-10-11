/** Client for the official document templates API (server/routes/documents.ts). */

export type DocumentTemplateView = {
  id: string
  title: string
  titleEn: string
  category: string
  categoryLabel: string
  family: 'CERTIFICATE' | 'LETTER' | 'RECEIPT' | 'CARD'
  familyLabel: string
  description: string
  fields: Array<{ key: string; label: string }>
  defaultValidityDays: number | null
  defaultSignerTitle: string
  defaultConditions: string[]
  thumbnailUrl: string
  sampleUrl: string
  /** false: gallery only (never issued on approval, cannot be assigned) */
  issuable: boolean
  /** assignable only to services that require attendance */
  requiresAppointment: boolean
}

export type TemplateAssignmentRow = {
  serviceKey: string
  title: string
  category: string
  issuesDocument: boolean
  needsAttendance: boolean
  defaultTemplateId: string
  templateId: string
  documentTitle: string
  overridden: boolean
  customTitle: string | null
  customConditions: string[] | null
  validityDays: number | null
  effectiveValidityDays: number | null
  signerTitle: string | null
  effectiveSignerTitle: string
  /** named signer printed under the signer's title (optional; never the approving employee). Older API: absent */
  signerName?: string | null
  updatedBy: string | null
  updatedAt: string | null
}

export type IssuedDocumentRow = {
  id: string
  serviceName: string
  departmentName: string
  documentTitle: string
  documentNumber: string
  verificationId: string
  status: string
  issuedAt: string
  templateId: string | null
  expiresAt: string | null
  revokedAt: string | null
  revokedReason: string | null
  citizenName: string
  serviceRequestReference: string | null
  applicationReference: string | null
  pdfUrl: string
}

export type RequestDocumentPlan = {
  issuesDocument: boolean
  template: DocumentTemplateView | null
  documentTitle: string
  validityDays: number | null
  signerTitle: string
  overridden: boolean
  /** the template prints the attendance appointment: approval needs a date/time */
  appointmentRequired?: boolean
  appointment?: { date: string; time: string; place: string | null } | null
  previewUrl: string
}

/** Page size of the issued-documents register (the server searches the whole register). */
export const ISSUED_PAGE = 50

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    throw new Error('تعذر الاتصال بالمنصة. تحقق من الاتصال ثم أعد المحاولة.')
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(payload.message || 'تعذر تنفيذ الطلب.')
  }
  return response.json() as Promise<T>
}

export const documentsApi = {
  templates: () =>
    call<{ templates: DocumentTemplateView[]; categories: Array<{ id: string; label: string }> }>(
      '/api/documents/templates'
    ),
  departments: () => call<Array<{ id: string; name: string; canEdit: boolean }>>('/api/documents/departments'),
  assignments: (departmentId?: string) =>
    call<{ department: { id: string; name: string }; canEdit: boolean; services: TemplateAssignmentRow[] }>(
      `/api/documents/assignments${departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : ''}`
    ),
  saveAssignment: (
    departmentId: string,
    serviceKey: string,
    body: {
      templateId: string
      customTitle?: string | null
      customConditions?: string[] | null
      validityDays?: number | null
      signerTitle?: string | null
      /** null clears the named signer; omitted keeps the one already configured */
      signerName?: string | null
    }
  ) =>
    call(`/api/documents/assignments/${encodeURIComponent(departmentId)}/${encodeURIComponent(serviceKey)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resetAssignment: (departmentId: string, serviceKey: string) =>
    call(`/api/documents/assignments/${encodeURIComponent(departmentId)}/${encodeURIComponent(serviceKey)}`, {
      method: 'DELETE',
    }),
  issued: (options: { q?: string; offset?: number; limit?: number } = {}) => {
    const params = new URLSearchParams()
    if (options.q) params.set('q', options.q)
    params.set('limit', String(options.limit || ISSUED_PAGE))
    if (options.offset) params.set('offset', String(options.offset))
    return call<IssuedDocumentRow[]>(`/api/employee/issued-documents?${params.toString()}`)
  },
  revoke: (id: string, reason: string) =>
    call(`/api/employee/issued-documents/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  requestPlan: (reference: string) =>
    call<RequestDocumentPlan>(`/api/documents/requests/${encodeURIComponent(reference)}/plan`),
}

/** Live preview URL of an assignment being edited (sample data, watermarked). */
export function previewUrl(input: {
  templateId: string
  departmentId?: string
  serviceKey?: string
  title?: string
  conditions?: string
  validityDays?: string
  signerTitle?: string
  signerName?: string
}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') params.set(key, value)
  return `/api/documents/preview.pdf?${params.toString()}`
}
