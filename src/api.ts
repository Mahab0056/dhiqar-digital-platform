import type { Citizen, DashboardStats, GovernmentApplication } from './types'

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
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
  getDemoCitizen: () => request<Citizen>('/api/citizen/demo'),
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
    const response = await fetch('/api/onboarding/identity-review', { method: 'POST', body: form })
    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: 'تعذر رفع وسائط الهوية.' }))
      throw new Error(body.message || 'تعذر رفع وسائط الهوية.')
    }
    return response.json() as Promise<{ id: string; status: string; retentionUntil: string; files: Array<{ id: string; purpose: string; sizeBytes: number }> }>
  },
  getLatestIdentityReview: () => request<{ id: string; status: string; national_id_masked: string; submitted_at: string; reviewed_at: string | null; review_notes: string | null; retention_until: string } | null>('/api/onboarding/identity-review/latest'),
  listIdentityReviews: (reviewAccessCode: string) => request<Array<{ id: string; status: string; citizenName: string; phoneMasked: string; nationalIdMasked: string; consentAt: string; submittedAt: string; reviewedAt: string | null; reviewedBy: string | null; notes: string | null; retentionUntil: string; media: Array<{ id: string; label: string; mimeType: string; sizeBytes: number }> }>>('/api/admin/identity-reviews', { headers: { 'x-review-access-code': reviewAccessCode } }),
  loadReviewMedia: async (mediaId: string, reviewAccessCode: string) => {
    const response = await fetch(`/api/admin/media/${mediaId}`, { headers: { 'x-review-access-code': reviewAccessCode } })
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
  requestDocument: (reference: string, documentName: string) =>
    request<GovernmentApplication>(`/api/applications/${reference}/request-document`, {
      method: 'POST',
      body: JSON.stringify({ documentName }),
    }),
  uploadMissingDocument: (reference: string, documentName: string) =>
    request<GovernmentApplication>(`/api/applications/${reference}/upload-document`, {
      method: 'POST',
      body: JSON.stringify({ documentName }),
    }),
  approveApplication: (reference: string) =>
    request<GovernmentApplication>(`/api/applications/${reference}/approve`, { method: 'POST' }),
  getStats: () => request<DashboardStats>('/api/dashboard/stats'),
  verifyDocument: (verificationId: string) =>
    request<GovernmentApplication>(`/api/verify/${verificationId}`),
  resetDemo: () => request<{ success: boolean }>('/api/demo/reset', { method: 'POST' }),
}
