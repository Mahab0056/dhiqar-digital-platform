import { rateLimit } from 'express-rate-limit'

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'طلبات كثيرة. انتظر دقيقة ثم أعد المحاولة.' },
})

export const sensitiveLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'تجاوزت الحد المؤقت لهذه العملية الحساسة. حاول لاحقاً.' },
})
