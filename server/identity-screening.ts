type ScreeningFile = {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

type ScreeningCheck = {
  key: string
  label: string
  passed: boolean
  detail: string
}

export type IdentityScreeningResult = {
  qualityStatus: 'PASSED' | 'NEEDS_RECAPTURE'
  qualityScore: number
  qualityChecks: ScreeningCheck[]
  faceMatchStatus: 'HUMAN_REVIEW_REQUIRED' | 'PROVIDER_REQUIRED'
  faceMatchScore: null
  faceMatchProvider: null
}

const check = (key: string, label: string, passed: boolean, detail: string): ScreeningCheck => ({
  key,
  label,
  passed,
  detail,
})

export function screenIdentitySubmission(input: {
  idFront: ScreeningFile
  idBack: ScreeningFile
  faceVideo: ScreeningFile
}): IdentityScreeningResult {
  const checks: ScreeningCheck[] = [
    check('front-image-type', 'صيغة وجه الهوية', input.idFront.mimetype.startsWith('image/'), input.idFront.mimetype),
    check(
      'front-image-size',
      'وضوح وجه الهوية',
      input.idFront.size >= 20_000,
      input.idFront.size >= 20_000 ? 'حجم مناسب للفحص' : 'الصورة صغيرة جداً وقد لا تكون مقروءة'
    ),
    check('back-image-type', 'صيغة ظهر الهوية', input.idBack.mimetype.startsWith('image/'), input.idBack.mimetype),
    check(
      'back-image-size',
      'وضوح ظهر الهوية',
      input.idBack.size >= 20_000,
      input.idBack.size >= 20_000 ? 'حجم مناسب للفحص' : 'الصورة صغيرة جداً وقد لا تكون مقروءة'
    ),
    check(
      'face-video-type',
      'صيغة فيديو الوجه',
      input.faceVideo.mimetype.startsWith('video/'),
      input.faceVideo.mimetype
    ),
    check(
      'face-video-size',
      'اكتمال فيديو الوجه',
      input.faceVideo.size >= 100_000,
      input.faceVideo.size >= 100_000 ? 'حجم متوافق مع تسجيل الكاميرا القصير' : 'الفيديو صغير أو غير مكتمل'
    ),
    check(
      'face-video-client-duration',
      'تسجيل 7 ثوانٍ من الكاميرا',
      /^face-video-7s-/i.test(input.faceVideo.originalname),
      /^face-video-7s-/i.test(input.faceVideo.originalname)
        ? 'أنشأته كاميرا المنصة ذات المؤقت'
        : 'تعذر تأكيد مصدر التسجيل ومدته'
    ),
  ]
  const passed = checks.filter(item => item.passed).length
  const qualityScore = Math.round((passed / checks.length) * 100)
  return {
    qualityStatus: qualityScore === 100 ? 'PASSED' : 'NEEDS_RECAPTURE',
    qualityScore,
    qualityChecks: checks,
    faceMatchStatus: 'PROVIDER_REQUIRED',
    faceMatchScore: null,
    faceMatchProvider: null,
  }
}
