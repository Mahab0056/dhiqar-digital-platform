import type { Citizen, CitizenNotification, CitizenServiceRequest, DashboardStats, GovernmentApplication } from './types'

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: 'تعذر تنفيذ الطلب' }))
    throw new Error(payload.message || 'تعذر تنفيذ الطلب')
  }
  return response.json() as Promise<T>
}

export const api = {
  getSession: () => request<{ authenticated: true; role: 'CITIZEN' | 'EMPLOYEE' | 'IDENTITY_REVIEWER'; subject: string; expiresAt: string }>('/api/auth/session'),
  loginEmployee: (accessCode: string) => request<{ authenticated: true; role: 'EMPLOYEE'; expiresInSeconds: number }>('/api/auth/employee', { method: 'POST', body: JSON.stringify({ accessCode }) }),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  getDemoCitizen: () => request<Citizen>('/api/citizen/demo'),
  listCitizenApplications: () => request<GovernmentApplication[]>('/api/citizen/applications'),
  listCitizenServiceRequests: () => request<CitizenServiceRequest[]>('/api/citizen/service-requests'),
  createServiceRequest: (serviceKey: string, data: Record<string, string>) => request<{ id: number; reference: string; serviceKey: string; serviceName: string; department: string; status: string; currentAction: string; appointment: { id: string; preferredDate: string; preferredTime: string; status: string } | null; createdAt: string }>('/api/service-requests', { method: 'POST', body: JSON.stringify({ serviceKey, data }) }),
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
  submitIdentityReview: async (payload: { fullName: string; nationalId: string; consent: boolean; idFront: File; idBack: File; faceVideo: File }) => {
    const form = new FormData()
    form.append('fullName', payload.fullName)
    form.append('nationalId', payload.nationalId)
    form.append('consent', String(payload.consent))
    form.append('idFront', payload.idFront)
    form.append('idBack', payload.idBack)
    form.append('faceVideo', payload.faceVideo)
    const response = await fetch('/api/onboarding/identity-review', { method: 'POST', body: form, credentials: 'include' })
    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: 'تعذر رفع وسائط الهوية.' }))
      throw new Error(body.message || 'تعذر رفع وسائط الهوية.')
    }
    return response.json() as Promise<{ id: string; status: string; retentionUntil: string; files: Array<{ id: string; purpose: string; sizeBytes: number }>; screening: { qualityStatus: string; qualityScore: number; qualityChecks: Array<{ key: string; label: string; passed: boolean; detail: string }>; faceMatchStatus: string; faceMatchScore: number | null; faceMatchProvider: string | null } }>
  },
  getLatestIdentityReview: () => request<{ id: string; status: string; national_id_masked: string; submitted_at: string; reviewed_at: string | null; review_notes: string | null; retention_until: string; quality_status: string; quality_score: number | null; quality_checks: string | null; face_match_status: string; face_match_score: number | null; face_match_provider: string | null } | null>('/api/onboarding/identity-review/latest'),
  listIdentityReviews: (reviewAccessCode: string) => request<Array<{ id: string; status: string; citizenName: string; phoneMasked: string; nationalIdMasked: string; consentAt: string; submittedAt: string; reviewedAt: string | null; reviewedBy: string | null; notes: string | null; retentionUntil: string; screening: { qualityStatus: string; qualityScore: number | null; qualityChecks: Array<{ key: string; label: string; passed: boolean; detail: string }>; faceMatchStatus: string; faceMatchScore: number | null; faceMatchProvider: string | null }; media: Array<{ id: string; label: string; mimeType: string; sizeBytes: number }> }>>('/api/admin/identity-reviews', { headers: { 'x-review-access-code': reviewAccessCode } }),
  loadReviewMedia: async (mediaId: string, reviewAccessCode: string) => {
    const response = await fetch(`/api/admin/media/${mediaId}`, { credentials: 'include', headers: { 'x-review-access-code': reviewAccessCode } })
    if (!response.ok) { const body = await response.json().catch(() => ({ message: 'تعذر فتح الوسيط.' })); throw new Error(body.message || 'تعذر فتح الوسيط.') }
    const blob = await response.blob()
    return { url: URL.createObjectURL(blob), mimeType: blob.type }
  },
  decideIdentityReview: (reviewId: string, reviewAccessCode: string, payload: { decision: 'APPROVED' | 'REJECTED' | 'NEEDS_RESUBMISSION'; notes: string }) => request<{ id: string; status: string; reviewedAt: string; mediaPurged: boolean }>(`/api/admin/identity-reviews/${reviewId}/decision`, { method: 'POST', headers: { 'x-review-access-code': reviewAccessCode }, body: JSON.stringify(payload) }),
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
    const response = await fetch('/api/applications', { method: 'POST', body: form, credentials: 'include' })
    if (!response.ok) { const body = await response.json().catch(() => ({ message: 'تعذر إرسال المعاملة.' })); throw new Error(body.message || 'تعذر إرسال المعاملة.') }
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
