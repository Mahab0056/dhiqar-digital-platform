import { rateLimit } from 'express-rate-limit'

/** Rate limits are disabled only for automated tests (never in production). */
const disabled = () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_ENABLED !== 'true'

const make = (windowMs: number, limit: number, message: string) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: disabled,
    message: { message },
  })

/** General API budget per IP. Offices share one NAT address, so this stays generous. */
export const apiLimiter = make(60 * 1000, 300, 'طلبات كثيرة. انتظر دقيقة ثم أعد المحاولة.')

/** Staff login / MFA / password: brute-force protection, independent of everything else. */
export const loginLimiter = make(10 * 60 * 1000, 25, 'محاولات دخول كثيرة. انتظر عشر دقائق ثم أعد المحاولة.')

/** OTP requests: costs money per SMS and must not be abusable. */
export const otpRequestLimiter = make(10 * 60 * 1000, 8, 'طلبت رموزاً كثيرة. انتظر عشر دقائق ثم اطلب رمزاً جديداً.')
export const otpVerifyLimiter = make(10 * 60 * 1000, 30, 'محاولات تحقق كثيرة. اطلب رمزاً جديداً بعد قليل.')

/** Heavy uploads that trigger OCR / face matching. */
export const identityUploadLimiter = make(
  10 * 60 * 1000,
  20,
  'تجاوزت الحد المؤقت لعمليات التحقق من الهوية. حاول بعد قليل.'
)

/** Kept for compatibility with older imports; same budget as identity uploads. */
export const sensitiveLimiter = identityUploadLimiter
