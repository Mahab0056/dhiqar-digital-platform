import type { Citizen, CitizenFeedback, CitizenNotification, CitizenServiceRequest, DashboardStats, DepartmentWorkbench, FeedbackStatus, GovernmentApplication, GovernmentServiceDirectoryEntry, GovernmentServicePublicationStatus, IssuedDocument, PlatformServiceSettings } from './types'

const readableRequestError = (status: number, message?: string) => {
  if (status === 401) return 'انتهت جلسة الدخول أو لا تملك صلاحية الإرسال. سجّل الدخول من جديد ثم أعد المحاولة.'
  if (status === 413) return 'حجم أحد المرفقات أكبر من المسموح. صوّر الملف بدقة أقل أو اختر ملفاً أصغر ثم أعد الإرسال.'
  if (status === 429) return 'تجاوزت عدد المحاولات المسموح حالياً. انتظر دقائق قليلة ثم أعد المحاولة.'
  return message || 'تعذر تنفيذ الطلب. تحقق من البيانات ثم أعد المحاولة.'
}

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  let response: Response
  try {
    response = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      ...options,
    })
  } catch {
    throw new Error('تعذر الاتصال بالمنصة. تحقق من اتصال الإنترنت ثم أعد الإرسال؛ لم يُسجل الطلب ما لم يظهر رقم متابعة.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: '' })) as { message?: string }
    throw new Error(readableRequestError(response.status, payload.message))
  }
  return response.json() as Promise<T>
}

export const api = {
  getSession: () => request<{ authenticated: true; role: 'CITIZEN' | 'EMPLOYEE' | 'IDENTITY_REVIEWER' | 'OPERATIONS' | 'SUPER_ADMIN'; subject: string; expiresAt: string }>('/api/auth/session'),
  listGovernmentServices: (params: { query?: string; dhiQarOnly?: boolean } = {}) => { const search = new URLSearchParams(); if (params.query) search.set('q', params.query); if (params.dhiQarOnly) search.set('dhiQar', 'true'); return request<GovernmentServiceDirectoryEntry[]>(`/api/government-services${search.size ? `?${search}` : ''}`) },
  getGovernmentService: (id: string) => request<GovernmentServiceDirectoryEntry>(`/api/government-services/${encodeURIComponent(id)}`),
  listGovernmentServicesForAdmin: (status?: GovernmentServicePublicationStatus) => request<{ services: GovernmentServiceDirectoryEntry[]; stats: { total: number; approved: number; needsReview: number; verified: number } }>(`/api/super-admin/government-services${status ? `?status=${status}` : ''}`),
  setGovernmentServicePublication: (id: string, publicationStatus: GovernmentServicePublicationStatus, reason?: string) => request<GovernmentServiceDirectoryEntry>(`/api/super-admin/government-services/${encodeURIComponent(id)}/publication`, { method: 'PATCH', body: JSON.stringify({ publicationStatus, reason }) }),
  loginEmployee: (accessCode: string) => request<{ authenticated: true; role: 'EMPLOYEE'; expiresInSeconds: number }>('/api/auth/employee', { method: 'POST', body: JSON.stringify({ accessCode }) }),
  loginOperations: (accessCode: string) => request<{ authenticated: true; role: 'OPERATIONS'; expiresInSeconds: number }>('/api/auth/operations', { method: 'POST', body: JSON.stringify({ accessCode }) }),
  loginSuperAdmin: (accessCode: string) => request<{ authenticated: true; role: 'SUPER_ADMIN'; expiresInSeconds: number }>('/api/auth/super-admin', { method: 'POST', body: JSON.stringify({ accessCode }) }),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  heartbeatPresence: () => request<{ activeWindowSeconds: number }>('/api/presence/heartbeat', { method: 'POST' }),
  getPlatformServiceSettings: (serviceKey: string) => request<PlatformServiceSettings>(`/api/platform-services/${encodeURIComponent(serviceKey)}`),
  getDepartmentWorkbench: () => request<{ departments: DepartmentWorkbench[] }>('/api/super-admin/department-workbench'),
  updatePlatformService: (serviceKey: string, payload: { requiredDocuments?: string[]; active?: boolean }) => request<{ success: true; updatedAt: string }>(`/api/super-admin/platform-services/${encodeURIComponent(serviceKey)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  getNewRequestAlerts: () => request<{ alerts: Array<{ reference: string; serviceName: string; department: string; status: string; createdAt: string; updatedAt: string }>; generatedAt: string }>('/api/operations/new-request-alerts'),
  getSuperAdminOverview: () => request<{ system: { pendingIdentity: number; openApplications: number; verifiedDepartments: number; gisLocations: number }; recentAudit: Array<{ actor: string; role: string; action: string; entityType: string; entityId: string; createdAt: string }> }>('/api/super-admin/overview'),
  getDemoCitizen: () => request<Citizen>('/api/citizen/demo'),
  listCitizenApplications: () => request<GovernmentApplication[]>('/api/citizen/applications'),
  listIssuedDocuments: () => request<IssuedDocument[]>('/api/citizen/issued-documents'),
  listEmployeeIssuedDocuments: () => request<IssuedDocument[]>('/api/employee/issued-documents'),
  listCitizenServiceRequests: () => request<CitizenServiceRequest[]>('/api/citizen/service-requests'),
  listEmployeeServiceRequests: () => request<CitizenServiceRequest[]>('/api/employee/service-requests'),
  updateEmployeeServiceRequest: (reference: string, payload: { status: 'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED'; currentAction: string; decisionNote?: string; requiredDocument?: string }) => request<CitizenServiceRequest>(`/api/employee/service-requests/${reference}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  createServiceRequest: (serviceKey: string, data: Record<string, string>) => request<{ id: number; reference: string; serviceKey: string; serviceName: string; department: string; status: string; currentAction: string; appointment: { id: string; preferredDate: string; preferredTime: string; status: string } | null; createdAt: string }>('/api/service-requests', { method: 'POST', body: JSON.stringify({ serviceKey, data }) }),
  uploadServiceRequestDocument: async (reference: string, documentName: string, document: File) => {
    const form = new FormData(); form.append('documentName', documentName); form.append('document', document)
    const response = await fetch(`/api/citizen/service-requests/${reference}/upload-document`, { method: 'POST', credentials: 'include', body: form })
    if (!response.ok) { const body = await response.json().catch(() => ({ message: 'تعذر رفع المستند المطلوب.' })); throw new Error(body.message || 'تعذر رفع المستند المطلوب.') }
    return response.json() as Promise<CitizenServiceRequest>
  },
  listFeedback: () => request<CitizenFeedback[]>('/api/citizen/feedback'),
  getFeedback: (reference: string) => request<CitizenFeedback>(`/api/citizen/feedback/${reference}`),
  createFeedback: async (payload: { kind: 'COMPLAINT' | 'SUGGESTION'; category: string; departmentId?: string; subject: string; description: string; district?: string; lat?: number; lng?: number; attachments: File[] }) => {
    const form = new FormData()
    form.append('kind', payload.kind)
    form.append('category', payload.category)
    if (payload.departmentId) form.append('departmentId', payload.departmentId)
    form.append('subject', payload.subject)
    form.append('description', payload.description)
    if (payload.district) form.append('district', payload.district)
    if (payload.lat !== undefined && payload.lng !== undefined) { form.append('lat', String(payload.lat)); form.append('lng', String(payload.lng)) }
    payload.attachments.slice(0, 3).forEach(file => form.append('attachments', file))
    const response = await fetch('/api/citizen/feedback', { method: 'POST', credentials: 'include', body: form })
    if (!response.ok) { const body = await response.json().catch(() => ({ message: 'تعذر تسجيل الطلب.' })); throw new Error(body.message || 'تعذر تسجيل الطلب.') }
    return response.json() as Promise<CitizenFeedback>
  },
  loadFeedbackMedia: async (reference: string, mediaId: string) => {
    const response = await fetch(`/api/citizen/feedback/${reference}/media/${mediaId}`, { credentials: 'include' })
    if (!response.ok) { const body = await response.json().catch(() => ({ message: 'تعذر فتح المرفق.' })); throw new Error(body.message || 'تعذر فتح المرفق.') }
    const blob = await response.blob()
    return { url: URL.createObjectURL(blob), mimeType: blob.type }
  },
  listFeedbackForAdmin: () => request<CitizenFeedback[]>('/api/admin/feedback'),
  updateFeedback: (reference: string, payload: { status: Exclude<FeedbackStatus, 'RECEIVED'>; currentAction: string; adminNote?: string }) => request<CitizenFeedback>(`/api/admin/feedback/${reference}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  getNotifications: () => request<{ unread: number; items: CitizenNotification[] }>('/api/citizen/notifications'),
  markNotificationRead: (id: string) => request<{ unread: number; items: CitizenNotification[] }>(`/api/citizen/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () => request<{ unread: number; items: CitizenNotification[] }>('/api/citizen/notifications/read-all', { method: 'POST' }),
  requestOtp: (phone: string) =>
    request<{ challengeId: string; phoneMasked: string; expiresInSeconds: number; deliveryStatus: string }>('/api/onboarding/request-otp', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),
  verifyPhone: (phone: string, challengeId: string, otp: string) =>
    request<{ success: boolean; phoneMasked: string; verifiedAt: string }>('/api/onboarding/verify-phone', {
      method: 'POST',
      body: JSON.stringify({ phone, challengeId, otp }),
    }),
  completeIdentity: (payload: { fullName: string; consent: boolean; livenessPassed: boolean }) =>
    request<Citizen>('/api/onboarding/complete-identity', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  previewIdentityDocument: async (payload: { documentType: 'NATIONAL_ID' | 'PASSPORT' | 'DRIVING_LICENSE'; document: File }) => {
    const form = new FormData()
    form.append('documentType', payload.documentType)
    form.append('analysisConsent', 'true')
    form.append('document', payload.document)
    const response = await fetch('/api/onboarding/identity-extract-preview', { method: 'POST', body: form, credentials: 'include' })
    if (!response.ok) { const body = await response.json().catch(() => ({ message: 'تعذر تحليل صورة المستند.' })); throw new Error(body.message || 'تعذر تحليل صورة المستند.') }
    return response.json() as Promise<{ status: string; provider: string | null; confidence: number | null; documentTypeDetected: string | null; fields: { fullName: string | null; documentNumber: string | null; dateOfBirth: string | null; nationality: string | null; sex: string | null; expiryDate: string | null }; documentNumberMasked: string | null; message?: string }>
  },
  updateCitizenLocation: (payload: { lat: number; lng: number; accuracyM?: number; consent: true }) => request<Citizen>('/api/citizen/location', { method: 'POST', body: JSON.stringify(payload) }),
  submitIdentityReview: async (payload: { fullName: string; documentNumber: string; documentType: 'NATIONAL_ID' | 'PASSPORT' | 'DRIVING_LICENSE'; consent: boolean; retainMedia: boolean; analysisConsent: boolean; profilePhotoConsent: boolean; location?: { lat: number; lng: number; accuracyM?: number } | null; idFront: File; idBack?: File | null; faceVideo: File }) => {
    const form = new FormData()
    form.append('fullName', payload.fullName)
    form.append('documentNumber', payload.documentNumber)
    form.append('documentType', payload.documentType)
    form.append('consent', String(payload.consent))
    form.append('retainMedia', String(payload.retainMedia))
    form.append('analysisConsent', String(payload.analysisConsent))
    form.append('profilePhotoConsent', String(payload.profilePhotoConsent))
    form.append('locationConsent', String(Boolean(payload.location)))
    if (payload.location) { form.append('locationLat', String(payload.location.lat)); form.append('locationLng', String(payload.location.lng)); if (payload.location.accuracyM !== undefined) form.append('locationAccuracyM', String(payload.location.accuracyM)) }
    form.append('idFront', payload.idFront)
    if (payload.idBack) form.append('idBack', payload.idBack)
    form.append('faceVideo', payload.faceVideo)
    const response = await fetch('/api/onboarding/identity-review', { method: 'POST', body: form, credentials: 'include' })
    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: 'تعذر رفع وسائط الهوية.' }))
      throw new Error(body.message || 'تعذر رفع وسائط الهوية.')
    }
    return response.json() as Promise<{ id: string; status: string; retentionUntil: string; documentType: string; analysis: { status: string; provider: string | null; confidence: number | null; fields: { fullName: string | null; documentNumber: string | null; dateOfBirth: string | null; nationality: string | null; sex: string | null; expiryDate: string | null }; documentTypeDetected: string | null; profilePhotoStored: boolean; faceComparison: { status: string; confidence: number | null } }; files: Array<{ id: string; purpose: string; sizeBytes: number; retentionPolicy: string }>; screening: { qualityStatus: string; qualityScore: number; qualityChecks: Array<{ key: string; label: string; passed: boolean; detail: string }>; faceMatchStatus: string; faceMatchScore: number | null; faceMatchProvider: string | null } }>
  },
  getLatestIdentityReview: () => request<{ id: string; status: string; national_id_masked: string; submitted_at: string; reviewed_at: string | null; review_notes: string | null; retention_until: string; quality_status: string; quality_score: number | null; quality_checks: string | null; face_match_status: string; face_match_score: number | null; face_match_provider: string | null } | null>('/api/onboarding/identity-review/latest'),
  listIdentityReviews: (reviewAccessCode: string) => request<Array<{ id: string; status: string; citizenName: string; phoneMasked: string; nationalIdMasked: string; consentAt: string; submittedAt: string; reviewedAt: string | null; reviewedBy: string | null; notes: string | null; retentionUntil: string; location: { lat: number; lng: number; accuracyM: number | null; updatedAt: string | null } | null; screening: { qualityStatus: string; qualityScore: number | null; qualityChecks: Array<{ key: string; label: string; passed: boolean; detail: string }>; faceMatchStatus: string; faceMatchScore: number | null; faceMatchProvider: string | null }; media: Array<{ id: string; label: string; mimeType: string; sizeBytes: number }> }>>('/api/admin/identity-reviews', { headers: { 'x-review-access-code': reviewAccessCode } }),
  loadReviewMedia: async (mediaId: string, reviewAccessCode: string) => {
    const response = await fetch(`/api/admin/media/${mediaId}`, { credentials: 'include', headers: { 'x-review-access-code': reviewAccessCode } })
    if (!response.ok) { const body = await response.json().catch(() => ({ message: 'تعذر فتح الوسيط.' })); throw new Error(body.message || 'تعذر فتح الوسيط.') }
    const blob = await response.blob()
    return { url: URL.createObjectURL(blob), mimeType: blob.type }
  },
  decideIdentityReview: (reviewId: string, reviewAccessCode: string, payload: { decision: 'APPROVED' | 'REJECTED' | 'NEEDS_RESUBMISSION'; notes: string }) => request<{ id: string; status: string; reviewedAt: string; mediaPurged: boolean; mediaRetained: boolean }>(`/api/admin/identity-reviews/${reviewId}/decision`, { method: 'POST', headers: { 'x-review-access-code': reviewAccessCode }, body: JSON.stringify(payload) }),
  listApplications: () => request<GovernmentApplication[]>('/api/applications'),
  getApplication: (reference: string) => request<GovernmentApplication>(`/api/applications/${reference}`),
  createApplication: (payload: Record<string, unknown>) =>
    request<GovernmentApplication>('/api/applications', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createApplicationWithFiles: async (payload: Record<string, unknown> & { coordinates: { lat: number; lng: number }; propertyDocument?: File | null; storefrontPhoto?: File | null }) => {
    const form = new FormData()
    Object.entries(payload).forEach(([key, value]) => {
      if (key === 'propertyDocument' || key === 'storefrontPhoto' || key === 'coordinates') return
      form.append(key, String(value))
    })
    form.append('coordinates', JSON.stringify(payload.coordinates))
    if (payload.propertyDocument) form.append('propertyDocument', payload.propertyDocument)
    if (payload.storefrontPhoto) form.append('storefrontPhoto', payload.storefrontPhoto)
    let response: Response
    try { response = await fetch('/api/applications', { method: 'POST', body: form, credentials: 'include' }) }
    catch { throw new Error('تعذر الاتصال بالمنصة. تحقق من الإنترنت ثم أعد الإرسال؛ لم تُسجل المعاملة ما لم يظهر رقم متابعة.') }
    if (!response.ok) { const body = await response.json().catch(() => ({ message: '' })) as { message?: string }; throw new Error(readableRequestError(response.status, body.message)) }
    return response.json() as Promise<GovernmentApplication>
  },
  requestDocument: (reference: string, documentName: string) =>
    request<GovernmentApplication>(`/api/applications/${reference}/request-document`, {
      method: 'POST',
      body: JSON.stringify({ documentName }),
    }),
  uploadMissingDocument: async (reference: string, documentName: string, document: File) => {
    const form = new FormData()
    form.append('documentName', documentName)
    form.append('document', document)
    const response = await fetch(`/api/applications/${reference}/upload-document`, { method: 'POST', body: form, credentials: 'include' })
    if (!response.ok) { const body = await response.json().catch(() => ({ message: 'تعذر رفع المستند.' })); throw new Error(body.message || 'تعذر رفع المستند.') }
    return response.json() as Promise<GovernmentApplication>
  },
  approveApplication: (reference: string) =>
    request<GovernmentApplication>(`/api/applications/${reference}/approve`, { method: 'POST' }),
  getStats: () => request<DashboardStats>('/api/dashboard/stats'),
  verifyDocument: (verificationId: string) =>
    request<GovernmentApplication>(`/api/verify/${verificationId}`),
}
