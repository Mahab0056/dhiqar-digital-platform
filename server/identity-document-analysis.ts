import { z } from 'zod'
import { analyzeIdentityDocumentLocally } from './local-identity-ocr.js'

export type IdentityDocumentType = 'NATIONAL_ID' | 'PASSPORT' | 'DRIVING_LICENSE'

const extractedSchema = z.object({
  status: z.enum(['COMPLETED', 'NO_RESULT', 'PROVIDER_UNAVAILABLE']),
  reason: z.enum(['COMPLETED', 'NOT_CONFIGURED', 'PROVIDER_UNAVAILABLE', 'NO_DOCUMENT_RESULT']).default('PROVIDER_UNAVAILABLE'),
  provider: z.string().max(120).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  fields: z.object({
    fullName: z.string().max(160).nullable(),
    documentNumber: z.string().max(64).nullable(),
    dateOfBirth: z.string().max(40).nullable(),
    nationality: z.string().max(80).nullable(),
    sex: z.string().max(40).nullable(),
    expiryDate: z.string().max(40).nullable(),
  }),
  documentTypeDetected: z.enum(['NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENSE']).nullable(),
  faceCrop: z.object({ mimeType: z.enum(['image/jpeg', 'image/png']), base64: z.string().min(32).max(2_000_000) }).nullable(),
  faceComparison: z.object({ status: z.enum(['MATCH_ASSISTED', 'NO_MATCH_ASSISTED', 'MANUAL_REVIEW_REQUIRED', 'NOT_PROVIDED']), confidence: z.number().min(0).max(1).nullable() }),
})

export type IdentityAnalysisResult = z.infer<typeof extractedSchema>

const unavailable = (status: 'NO_RESULT' | 'PROVIDER_UNAVAILABLE' = 'PROVIDER_UNAVAILABLE', reason: 'NOT_CONFIGURED' | 'PROVIDER_UNAVAILABLE' | 'NO_DOCUMENT_RESULT' = 'PROVIDER_UNAVAILABLE'): IdentityAnalysisResult => ({
  status,
  reason,
  provider: null,
  confidence: null,
  fields: { fullName: null, documentNumber: null, dateOfBirth: null, nationality: null, sex: null, expiryDate: null },
  documentTypeDetected: null,
  faceCrop: null,
  faceComparison: { status: 'MANUAL_REVIEW_REQUIRED', confidence: null },
})

export async function analyzeIdentityDocument(input: {
  documentType: IdentityDocumentType
  documentImage: { buffer: Buffer; mimeType: string }
  faceVideo?: { buffer: Buffer; mimeType: string } | null
  analysisConsent: boolean
}): Promise<IdentityAnalysisResult> {
  if (!input.analysisConsent) return unavailable('NO_RESULT', 'NO_DOCUMENT_RESULT')
  const endpoint = process.env.IDENTITY_DOCUMENT_AI_ENDPOINT?.trim()
  const apiKey = process.env.IDENTITY_DOCUMENT_AI_KEY?.trim()
  if (!endpoint || !apiKey) return analyzeIdentityDocumentLocally({ documentType: input.documentType, documentImage: input.documentImage })
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12_000)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        documentType: input.documentType,
        document: { mimeType: input.documentImage.mimeType, base64: input.documentImage.buffer.toString('base64') },
        faceVideo: input.faceVideo ? { mimeType: input.faceVideo.mimeType, base64: input.faceVideo.buffer.toString('base64') } : null,
        requestedOutputs: ['documentFields', 'documentType', 'faceCrop', 'assistedFaceComparison'],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!response.ok) return unavailable('PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE')
    return extractedSchema.parse(await response.json())
  } catch {
    return unavailable('PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE')
  }
}
