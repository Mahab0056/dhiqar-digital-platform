import express from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export const errorHandler = (
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) => {
  const requestId = String(res.locals.requestId || randomUUID())
  if (error instanceof z.ZodError)
    return res.status(400).json({ message: 'تحقق من الحقول المطلوبة وصيغة البيانات قبل الإرسال.', requestId })
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE')
      return res
        .status(413)
        .json({ message: 'حجم المرفق أكبر من الحد المسموح. اختر ملفاً أصغر ثم أعد الإرسال.', requestId })
    if (error.code === 'LIMIT_UNEXPECTED_FILE')
      return res
        .status(400)
        .json({ message: 'نوع أو اسم المرفق غير متوقع لهذه المعاملة. أعد رفع المستند من الحقل المخصص له.', requestId })
    return res
      .status(400)
      .json({ message: 'تعذر قبول المرفقات بسبب العدد أو الصيغة. تحقق من الملفات ثم أعد الإرسال.', requestId })
  }
  if (error instanceof Error && error.message.includes('محتوى الملف'))
    return res
      .status(400)
      .json({ message: `${error.message} أعد تصويره أو ارفع ملفاً أصلياً بصيغة صورة أو PDF مسموح.`, requestId })
  if (error instanceof Error && error.message.includes('توقيع ملف PDF'))
    return res.status(400).json({
      message: 'ملف PDF المرفوع غير صالح أو امتداده لا يطابق محتواه. اختر ملف PDF أصلياً ثم أعد الإرسال.',
      requestId,
    })
  if (error instanceof Error && error.message.includes('Origin غير مصرح'))
    return res.status(403).json({ message: 'المصدر غير مصرح.', requestId })
  console.error(`[${requestId}]`, error)
  res.status(500).json({
    message:
      'تعذر إكمال الإرسال الآن. لم تُسجل المعاملة؛ أعد المحاولة لاحقاً، وإذا استمر الخطأ أرسل رمز المتابعة إلى الدعم.',
    requestId,
  })
}
