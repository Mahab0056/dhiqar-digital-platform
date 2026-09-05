import type express from 'express'
import { param } from '../http/params.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { upload, validateUploadedFile } from '../http/upload.js'
import { setSession, requireSession, currentCitizen, requireReviewAccess } from '../auth/session.js'
import { notifyCitizen, employeeWorkQueueRealtime } from '../realtime.js'
import { addAudit, db, getCitizenById, getOrCreateCitizen } from '../db.js'
import { createOtpChallenge, processOtpDeliveryWebhook, verifyOtpChallenge } from '../otp.js'
import { readDecryptedMedia, storeEncryptedMedia } from '../media.js'
import { screenIdentitySubmission } from '../identity-screening.js'
import { analyzeIdentityDocument } from '../identity-document-analysis.js'

export function registerOnboardingRoutes(app: express.Express) {
  app.post('/api/onboarding/request-otp', async (req, res) => {
    try {
      const payload = z.object({ phone: z.string().min(10).max(20) }).parse(req.body)
      const challenge = await createOtpChallenge({
        phone: payload.phone,
        requesterIp: req.ip || req.socket.remoteAddress || 'unknown',
      })
      addAudit({
        actor: 'مواطن',
        role: 'CITIZEN',
        action: 'PHONE_OTP_REQUESTED',
        entityType: 'PhoneVerification',
        entityId: challenge.challengeId,
        metadata: { phoneMasked: challenge.phoneMasked, provider: 'OTPIQ' },
      })
      res.status(201).json(challenge)
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? 'أدخل رقم هاتف عراقي صحيحاً بصيغة 07XXXXXXXXX.'
          : error instanceof Error
            ? error.message
            : 'تعذر إرسال رمز التحقق.'
      res.status(400).json({ message })
    }
  })

  app.post('/api/onboarding/verify-phone', (req, res) => {
    try {
      const payload = z
        .object({
          phone: z.string().min(10).max(20),
          challengeId: z.string().startsWith('otp_'),
          otp: z.string().regex(/^\d{6}$/),
        })
        .parse(req.body)
      const result = verifyOtpChallenge(payload)
      const citizen = getOrCreateCitizen(result.accountKey, result.phoneMasked)
      setSession(res, String(citizen.id), 'CITIZEN')
      addAudit({
        actor: citizen.fullName,
        role: 'CITIZEN',
        action: 'PHONE_OTP_VERIFIED',
        entityType: 'PhoneVerification',
        entityId: payload.challengeId,
        metadata: { phoneMasked: result.phoneMasked, citizenId: citizen.id, provider: 'OTPIQ' },
      })
      res.json({ success: result.success, phoneMasked: result.phoneMasked, verifiedAt: result.verifiedAt })
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? 'أدخل رقم الهاتف ومعرّف الطلب ورمز التحقق المكوّن من 6 أرقام بصورة صحيحة.'
          : error instanceof Error
            ? error.message
            : 'تعذر التحقق من الرمز.'
      res.status(400).json({ message })
    }
  })

  app.post('/api/webhooks/otpiq', (req, res) => {
    try {
      const result = processOtpDeliveryWebhook({
        secret: req.header('x-otpiq-webhook-secret'),
        payload: req.body,
      })
      res.json(result)
    } catch {
      res.status(401).json({ message: 'Webhook غير مصرح.' })
    }
  })

  app.post('/api/onboarding/complete-identity', requireSession('CITIZEN'), (req, res) => {
    const payload = z
      .object({ fullName: z.string().min(3), consent: z.literal(true), livenessPassed: z.boolean() })
      .parse(req.body)
    const citizen = currentCitizen(res)
    if (!citizen) return
    const timestamp = new Date().toISOString()
    db.prepare(
      'UPDATE citizens SET full_name = ?, verification_status = ?, consent_at = ?, updated_at = ? WHERE id = ?'
    ).run(payload.fullName, 'MANUAL_REVIEW', timestamp, timestamp, citizen.id)
    addAudit({
      actor: payload.fullName,
      role: 'CITIZEN',
      action: 'IDENTITY_REVIEW_REQUESTED',
      entityType: 'CitizenIdentity',
      entityId: String(citizen.id),
      newValue: { status: 'MANUAL_REVIEW' },
      metadata: { livenessClaimed: payload.livenessPassed, mediaPersisted: false },
    })
    res.json(getCitizenById(citizen.id))
  })

  app.post(
    '/api/onboarding/identity-extract-preview',
    requireSession('CITIZEN'),
    upload.single('document'),
    async (req, res) => {
      try {
        const payload = z
          .object({
            documentType: z.enum(['NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENSE']),
            analysisConsent: z.literal('true'),
          })
          .parse(req.body)
        if (!req.file) return res.status(400).json({ message: 'ارفع أو التقط صورة المستند أولاً.' })
        validateUploadedFile(req.file, ['image'])
        const analysis = await analyzeIdentityDocument({
          documentType: payload.documentType,
          documentImage: { buffer: req.file.buffer, mimeType: req.file.mimetype },
          analysisConsent: true,
        })
        const documentNumber = analysis.fields.documentNumber || ''
        res.json({
          status: analysis.status,
          reason: analysis.reason,
          provider: analysis.provider,
          confidence: analysis.confidence,
          documentTypeDetected: analysis.documentTypeDetected,
          fields: analysis.fields,
          documentNumberMasked: documentNumber ? `********${documentNumber.replace(/\s/g, '').slice(-4)}` : null,
          message:
            analysis.reason === 'NOT_CONFIGURED'
              ? 'التحليل التلقائي متوقف لأن مزود قراءة المستندات غير مهيأ في بيئة المنصة. لا تُخمن أي بيانات؛ سيعاد التحليل تلقائياً بعد تهيئة المزود.'
              : analysis.reason === 'PROVIDER_UNAVAILABLE'
                ? 'تعذر الاتصال بمزود التحليل الآن. احتفظ بالمستند وحاول مرة أخرى خلال قليل.'
                : undefined,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر تحليل صورة المستند.'
        res.status(400).json({ message })
      }
    }
  )

  app.post(
    '/api/onboarding/identity-review',
    requireSession('CITIZEN'),
    upload.fields([
      { name: 'idFront', maxCount: 1 },
      { name: 'idBack', maxCount: 1 },
      { name: 'faceVideo', maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const payload = z
          .object({
            fullName: z.string().min(3).max(120),
            documentNumber: z.string().min(4).max(40),
            documentType: z.enum(['NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENSE']).default('NATIONAL_ID'),
            consent: z.literal('true'),
            retainMedia: z.literal('true'),
            analysisConsent: z.literal('true'),
            profilePhotoConsent: z.literal('true'),
            locationConsent: z.enum(['true', 'false']).default('false'),
            locationLat: z.coerce.number().min(-90).max(90).optional(),
            locationLng: z.coerce.number().min(-180).max(180).optional(),
            locationAccuracyM: z.coerce.number().min(0).max(50_000).optional(),
          })
          .parse(req.body)
        const files = req.files as Record<string, Express.Multer.File[]> | undefined
        const idFront = files?.idFront?.[0]
        const idBack = files?.idBack?.[0]
        const faceVideo = files?.faceVideo?.[0]
        if (!idFront || !faceVideo || (payload.documentType !== 'PASSPORT' && !idBack))
          return res.status(400).json({
            message:
              payload.documentType === 'PASSPORT'
                ? 'صوّر صفحة البيانات في جواز السفر وفيديو الوجه القصير لإرسال طلب المراجعة.'
                : 'صوّر وجهي المستند وفيديو الوجه القصير لإرسال طلب المراجعة.',
          })
        validateUploadedFile(idFront, ['image'])
        if (idBack) validateUploadedFile(idBack, ['image'])
        validateUploadedFile(faceVideo, ['video'])
        const screening = screenIdentitySubmission({ idFront, idBack: idBack || idFront, faceVideo })
        if (screening.qualityStatus === 'NEEDS_RECAPTURE')
          return res
            .status(422)
            .json({ message: 'فحص الجودة الآلي طلب إعادة التصوير قبل حفظ بيانات الهوية.', screening })

        const citizen = currentCitizen(res)
        if (!citizen) return
        const citizenId = citizen.id
        const now = new Date()
        const retentionUntil = '9999-12-31T23:59:59.999Z'
        const mediaRetention = {
          retentionPolicy: 'RETAINED_WITH_CONSENT' as const,
          retentionConsentAt: now.toISOString(),
        }
        const front = storeEncryptedMedia({
          citizenId,
          purpose: 'IDENTITY_DOCUMENT_FRONT',
          originalName: idFront.originalname || 'identity-document-front',
          mimeType: idFront.mimetype,
          buffer: idFront.buffer,
          ...mediaRetention,
        })
        const back = idBack
          ? storeEncryptedMedia({
              citizenId,
              purpose: 'IDENTITY_DOCUMENT_BACK',
              originalName: idBack.originalname || 'identity-document-back',
              mimeType: idBack.mimetype,
              buffer: idBack.buffer,
              ...mediaRetention,
            })
          : null
        const video = storeEncryptedMedia({
          citizenId,
          purpose: 'FACE_VIDEO',
          originalName: faceVideo.originalname || 'face-video',
          mimeType: faceVideo.mimetype,
          buffer: faceVideo.buffer,
          ...mediaRetention,
        })
        const analysis = await analyzeIdentityDocument({
          documentType: payload.documentType,
          documentImage: { buffer: idFront.buffer, mimeType: idFront.mimetype },
          faceVideo: { buffer: faceVideo.buffer, mimeType: faceVideo.mimetype },
          analysisConsent: true,
        })
        const profilePhoto =
          analysis.faceCrop && analysis.confidence !== null && analysis.confidence >= 0.75
            ? storeEncryptedMedia({
                citizenId,
                purpose: 'PROFILE_PHOTO',
                originalName: 'identity-derived-profile-photo.jpg',
                mimeType: analysis.faceCrop.mimeType,
                buffer: Buffer.from(analysis.faceCrop.base64, 'base64'),
                ...mediaRetention,
              })
            : null
        const reviewId = `idv_${randomUUID().replaceAll('-', '')}`
        const maskedNationalId = `********${payload.documentNumber.replace(/\s/g, '').slice(-4)}`
        const locationAllowed =
          payload.locationConsent === 'true' && payload.locationLat !== undefined && payload.locationLng !== undefined
        const extractionSummary = JSON.stringify({
          status: analysis.status,
          provider: analysis.provider,
          confidence: analysis.confidence,
          documentTypeDetected: analysis.documentTypeDetected,
          fields: analysis.fields,
          fieldsPresent: Object.fromEntries(
            Object.entries(analysis.fields).map(([key, value]) => [key, Boolean(value)])
          ),
          faceComparison: analysis.faceComparison.status,
        })

        db.prepare(
          `
        INSERT INTO identity_reviews (
          id, citizen_id, status, national_id_masked, id_front_media_id, id_back_media_id,
          face_video_media_id, quality_status, quality_score, quality_checks, face_match_status, face_match_score, face_match_provider,
          document_type, retention_consent_at, analysis_consent_at, analysis_status, extracted_data, extraction_provider, extraction_confidence, profile_photo_media_id, location_lat, location_lng, location_accuracy_m, location_consent_at,
          consent_at, submitted_at, retention_until, created_at, updated_at
        ) VALUES (?, ?, 'PENDING_REVIEW', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        ).run(
          reviewId,
          citizenId,
          maskedNationalId,
          front.id,
          back?.id || null,
          video.id,
          screening.qualityStatus,
          screening.qualityScore,
          JSON.stringify(screening.qualityChecks),
          analysis.faceComparison.status,
          analysis.faceComparison.confidence,
          analysis.provider,
          payload.documentType,
          now.toISOString(),
          now.toISOString(),
          analysis.status,
          extractionSummary,
          analysis.provider,
          analysis.confidence,
          profilePhoto?.id || null,
          locationAllowed ? (payload.locationLat ?? null) : null,
          locationAllowed ? (payload.locationLng ?? null) : null,
          locationAllowed ? (payload.locationAccuracyM ?? null) : null,
          locationAllowed ? now.toISOString() : null,
          now.toISOString(),
          now.toISOString(),
          retentionUntil,
          now.toISOString(),
          now.toISOString()
        )
        db.prepare(
          'UPDATE citizens SET full_name = ?, national_id_masked = ?, document_type = ?, profile_media_id = COALESCE(?, profile_media_id), verification_status = ?, consent_at = ?, location_lat = ?, location_lng = ?, location_accuracy_m = ?, location_updated_at = ?, location_consent_at = ?, updated_at = ? WHERE id = ?'
        ).run(
          payload.fullName,
          maskedNationalId,
          payload.documentType,
          profilePhoto?.id || null,
          'MANUAL_REVIEW',
          now.toISOString(),
          locationAllowed ? (payload.locationLat ?? null) : null,
          locationAllowed ? (payload.locationLng ?? null) : null,
          locationAllowed ? (payload.locationAccuracyM ?? null) : null,
          locationAllowed ? now.toISOString() : null,
          locationAllowed ? now.toISOString() : null,
          now.toISOString(),
          citizenId
        )
        notifyCitizen({
          citizenId,
          type: 'IDENTITY_REVIEW',
          title: 'تم استلام طلب توثيق الهوية',
          message: 'وصلت صور الهوية وفيديو الوجه إلى قائمة المراجعة. ستصلك نتيجة القرار هنا.',
          link: '/citizen',
        })
        employeeWorkQueueRealtime.publish({ entity: 'IDENTITY_REVIEW', action: 'CREATED', reference: reviewId })
        addAudit({
          actor: payload.fullName,
          role: 'CITIZEN',
          action: 'IDENTITY_MEDIA_SUBMITTED',
          entityType: 'IdentityReview',
          entityId: reviewId,
          newValue: {
            status: 'PENDING_REVIEW',
            media: [front.id, back?.id, video.id].filter(Boolean),
            documentType: payload.documentType,
          },
          metadata: {
            consent: true,
            retentionPolicy: 'RETAINED_WITH_CONSENT',
            retentionUntil,
            analysisRequested: true,
            analysisStatus: analysis.status,
            profilePhotoStored: Boolean(profilePhoto),
            locationProvided: locationAllowed,
            rawDocumentNumberStored: false,
            qualityScore: screening.qualityScore,
            faceMatchStatus: analysis.faceComparison.status,
          },
        })
        res.status(201).json({
          id: reviewId,
          status: 'PENDING_REVIEW',
          retentionUntil,
          documentType: payload.documentType,
          analysis: {
            status: analysis.status,
            provider: analysis.provider,
            confidence: analysis.confidence,
            fields: analysis.fields,
            documentTypeDetected: analysis.documentTypeDetected,
            profilePhotoStored: Boolean(profilePhoto),
            faceComparison: analysis.faceComparison,
          },
          files: [front, back, video, profilePhoto]
            .filter(file => file != null)
            .map(file => ({
              id: file.id,
              purpose: file.purpose,
              sizeBytes: file.sizeBytes,
              retentionPolicy: file.retentionPolicy,
            })),
          screening,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر حفظ طلب مراجعة الهوية.'
        res.status(400).json({ message })
      }
    }
  )

  app.get('/api/onboarding/identity-review/latest', requireSession('CITIZEN'), (_req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    const review = db
      .prepare(
        `
      SELECT id, status, national_id_masked, submitted_at, reviewed_at, review_notes, retention_until, quality_status, quality_score, quality_checks, face_match_status, face_match_score, face_match_provider
      FROM identity_reviews WHERE citizen_id = ? ORDER BY created_at DESC LIMIT 1
    `
      )
      .get(citizen.id)
    res.json(review || null)
  })

  app.get(
    '/api/admin/identity-reviews',
    requireSession('EMPLOYEE', 'IDENTITY_REVIEWER', 'SUPER_ADMIN'),
    requireReviewAccess,
    (_req, res) => {
      const rows = db
        .prepare(
          `
      SELECT r.id, r.status, r.national_id_masked, r.consent_at, r.submitted_at, r.reviewed_at, r.reviewed_by, r.review_notes, r.retention_until,
             r.quality_status, r.quality_score, r.quality_checks, r.face_match_status, r.face_match_score, r.face_match_provider, r.extracted_data,
             c.full_name, c.phone_masked, c.location_lat, c.location_lng, c.location_accuracy_m, c.location_updated_at,
             front.id AS front_id, front.mime_type AS front_mime, front.size_bytes AS front_size,
             back.id AS back_id, back.mime_type AS back_mime, back.size_bytes AS back_size,
             face.id AS face_id, face.mime_type AS face_mime, face.size_bytes AS face_size
      FROM identity_reviews r
      JOIN citizens c ON c.id = r.citizen_id
      LEFT JOIN media_objects front ON front.id = r.id_front_media_id
      LEFT JOIN media_objects back ON back.id = r.id_back_media_id
      LEFT JOIN media_objects face ON face.id = r.face_video_media_id
      ORDER BY CASE r.status WHEN 'PENDING_REVIEW' THEN 0 ELSE 1 END, r.submitted_at DESC
    `
        )
        .all() as Array<Record<string, unknown>>
      addAudit({
        actor: 'Identity Reviewer',
        role: 'IDENTITY_REVIEWER',
        action: 'IDENTITY_REVIEW_QUEUE_VIEWED',
        entityType: 'IdentityReviewQueue',
        entityId: 'all',
        metadata: { count: rows.length },
      })
      res.json(
        rows.map(row => ({
          id: row.id,
          status: row.status,
          citizenName: row.full_name,
          phoneMasked: row.phone_masked,
          nationalIdMasked: row.national_id_masked,
          consentAt: row.consent_at,
          submittedAt: row.submitted_at,
          reviewedAt: row.reviewed_at,
          reviewedBy: row.reviewed_by,
          notes: row.review_notes,
          retentionUntil: row.retention_until,
          location:
            typeof row.location_lat === 'number' && typeof row.location_lng === 'number'
              ? {
                  lat: row.location_lat,
                  lng: row.location_lng,
                  accuracyM: typeof row.location_accuracy_m === 'number' ? row.location_accuracy_m : null,
                  updatedAt: row.location_updated_at || null,
                }
              : null,
          extractedFields: (() => {
            try {
              const extracted = row.extracted_data
                ? (JSON.parse(String(row.extracted_data)) as {
                    fields?: Record<string, unknown>
                    documentTypeDetected?: string | null
                  })
                : null
              const fields = extracted?.fields
              return fields
                ? {
                    documentTypeDetected: extracted?.documentTypeDetected || null,
                    fullName: typeof fields.fullName === 'string' ? fields.fullName : null,
                    documentNumber: typeof fields.documentNumber === 'string' ? fields.documentNumber : null,
                    dateOfBirth: typeof fields.dateOfBirth === 'string' ? fields.dateOfBirth : null,
                    nationality: typeof fields.nationality === 'string' ? fields.nationality : null,
                    sex: typeof fields.sex === 'string' ? fields.sex : null,
                    expiryDate: typeof fields.expiryDate === 'string' ? fields.expiryDate : null,
                  }
                : null
            } catch {
              return null
            }
          })(),
          screening: {
            qualityStatus: row.quality_status,
            qualityScore: row.quality_score,
            qualityChecks: row.quality_checks ? JSON.parse(String(row.quality_checks)) : [],
            faceMatchStatus: row.face_match_status,
            faceMatchScore: row.face_match_score,
            faceMatchProvider: row.face_match_provider,
          },
          media: [
            { id: row.front_id, label: 'وجه الهوية', mimeType: row.front_mime, sizeBytes: row.front_size },
            { id: row.back_id, label: 'ظهر الهوية', mimeType: row.back_mime, sizeBytes: row.back_size },
            { id: row.face_id, label: 'فيديو الوجه', mimeType: row.face_mime, sizeBytes: row.face_size },
          ].filter(item => typeof item.id === 'string'),
        }))
      )
    }
  )

  app.get(
    '/api/admin/media/:id',
    requireSession('EMPLOYEE', 'IDENTITY_REVIEWER', 'SUPER_ADMIN'),
    requireReviewAccess,
    (req, res) => {
      try {
        const media = readDecryptedMedia(param(req, 'id'))
        if (!media) return res.status(404).json({ message: 'الوسيط غير متاح أو انتهت مدة الاحتفاظ.' })
        addAudit({
          actor: 'Identity Reviewer',
          role: 'IDENTITY_REVIEWER',
          action: 'IDENTITY_MEDIA_VIEWED',
          entityType: 'MediaObject',
          entityId: param(req, 'id'),
          metadata: { purpose: 'identity-review' },
        })
        res.setHeader('Content-Type', media.mimeType)
        res.setHeader('Content-Disposition', 'inline')
        res.setHeader('Cache-Control', 'private, no-store')
        res.send(media.buffer)
      } catch {
        res.status(500).json({ message: 'تعذر فتح الوسيط المشفر.' })
      }
    }
  )

  app.post(
    '/api/admin/identity-reviews/:id/decision',
    requireSession('EMPLOYEE', 'IDENTITY_REVIEWER', 'SUPER_ADMIN'),
    requireReviewAccess,
    (req, res) => {
      try {
        const payload = z
          .object({
            decision: z.enum(['APPROVED', 'REJECTED', 'NEEDS_RESUBMISSION']),
            notes: z.string().max(1000).default(''),
          })
          .parse(req.body)
        const review = db.prepare('SELECT * FROM identity_reviews WHERE id = ?').get(param(req, 'id')) as
          Record<string, unknown> | undefined
        if (!review) return res.status(404).json({ message: 'طلب المراجعة غير موجود.' })
        if (review.status !== 'PENDING_REVIEW')
          return res.status(409).json({ message: 'تم اتخاذ قرار سابق لهذا الطلب.' })
        const timestamp = new Date().toISOString()
        db.exec('BEGIN')
        try {
          db.prepare(
            `UPDATE identity_reviews SET status = ?, reviewed_at = ?, reviewed_by = ?, review_notes = ?, updated_at = ? WHERE id = ?`
          ).run(payload.decision, timestamp, 'موظف مراجعة الهوية', payload.notes, timestamp, param(req, 'id'))
          const citizenStatus = payload.decision === 'APPROVED' ? 'VERIFIED_MANUAL' : payload.decision
          db.prepare('UPDATE citizens SET verification_status = ?, updated_at = ? WHERE id = ?').run(
            citizenStatus,
            timestamp,
            review.citizen_id as number
          )
          notifyCitizen({
            citizenId: Number(review.citizen_id),
            type: 'IDENTITY_DECISION',
            title:
              payload.decision === 'APPROVED'
                ? 'تم اعتماد مراجعة الهوية'
                : payload.decision === 'NEEDS_RESUBMISSION'
                  ? 'مطلوب إعادة رفع الهوية'
                  : 'تعذر اعتماد مراجعة الهوية',
            message:
              payload.notes ||
              (payload.decision === 'APPROVED'
                ? 'اكتملت المراجعة البشرية ويمكنك متابعة الخدمات المتاحة.'
                : 'راجع الملاحظة وأعد تقديم البيانات المطلوبة.'),
            link: '/citizen',
          })
          addAudit({
            actor: 'موظف مراجعة الهوية',
            role: 'IDENTITY_REVIEWER',
            action: 'IDENTITY_REVIEW_DECIDED',
            entityType: 'IdentityReview',
            entityId: param(req, 'id'),
            previousValue: { status: review.status },
            newValue: { status: payload.decision },
            metadata: { notesLength: payload.notes.length },
          })
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
        addAudit({
          actor: 'موظف مراجعة الهوية',
          role: 'IDENTITY_REVIEWER',
          action: 'IDENTITY_MEDIA_RETAINED_AFTER_DECISION',
          entityType: 'IdentityReview',
          entityId: param(req, 'id'),
          metadata: { retained: true, decision: payload.decision },
        })
        res.json({
          id: param(req, 'id'),
          status: payload.decision,
          reviewedAt: timestamp,
          mediaPurged: false,
          mediaRetained: true,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر حفظ قرار المراجعة.'
        res.status(400).json({ message })
      }
    }
  )

  app.post('/api/citizen/location', requireSession('CITIZEN'), (req, res) => {
    try {
      const payload = z
        .object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          accuracyM: z.number().min(0).max(50_000).optional(),
          consent: z.literal(true),
        })
        .parse(req.body)
      const citizen = currentCitizen(res)
      if (!citizen) return
      const timestamp = new Date().toISOString()
      db.prepare(
        'UPDATE citizens SET location_lat = ?, location_lng = ?, location_accuracy_m = ?, location_updated_at = ?, location_consent_at = ?, updated_at = ? WHERE id = ?'
      ).run(payload.lat, payload.lng, payload.accuracyM || null, timestamp, timestamp, timestamp, citizen.id)
      addAudit({
        actor: citizen.fullName,
        role: 'CITIZEN',
        action: 'CITIZEN_LOCATION_UPDATED',
        entityType: 'Citizen',
        entityId: String(citizen.id),
        metadata: { consent: true, accuracyM: payload.accuracyM || null },
      })
      res.json(getCitizenById(citizen.id))
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : 'تعذر حفظ الموقع.' })
    }
  })

  app.get('/api/citizen/profile-photo', requireSession('CITIZEN'), (_req, res) => {
    try {
      const citizen = currentCitizen(res)
      if (!citizen?.profileMediaId) return res.status(404).json({ message: 'لا توجد صورة ملف مشتقة بعد.' })
      const media = readDecryptedMedia(citizen.profileMediaId)
      if (!media) return res.status(404).json({ message: 'صورة الملف غير متاحة.' })
      addAudit({
        actor: citizen.fullName,
        role: 'CITIZEN',
        action: 'CITIZEN_PROFILE_PHOTO_VIEWED',
        entityType: 'MediaObject',
        entityId: citizen.profileMediaId,
        metadata: { purpose: 'profile-photo' },
      })
      res.setHeader('Content-Type', media.mimeType)
      res.setHeader('Content-Disposition', 'inline')
      res.setHeader('Cache-Control', 'private, no-store')
      res.send(media.buffer)
    } catch {
      res.status(500).json({ message: 'تعذر فتح صورة الملف.' })
    }
  })
}
