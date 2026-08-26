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
