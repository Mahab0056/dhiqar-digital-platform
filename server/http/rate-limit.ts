import { rateLimit } from 'express-rate-limit'

/** Rate limits are disabled only for automated tests (never in production). */
const disabled = () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_ENABLED !== 'true'

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: disabled,
  message: { message: 'طلبات كثيرة. انتظر دقيقة ثم أعد المحاولة.' },
})

export const sensitiveLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: disabled,
  message: { message: 'تجاوزت الحد المؤقت لهذه العملية الحساسة. حاول لاحقاً.' },
})
