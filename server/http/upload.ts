import multer from 'multer'

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, callback) => {
    const permitted = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/webm',
      'video/mp4',
      'video/quicktime',
      'application/pdf',
    ])
    if (!permitted.has(file.mimetype)) return callback(new Error('صيغة الملف غير مدعومة.'))
    callback(null, true)
  },
})

export function detectedMime(buffer: Buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf'
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4'
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm'
  return null
}

export function validateUploadedFile(file: Express.Multer.File, allowed: Array<'image' | 'video' | 'pdf'>) {
  const actual = detectedMime(file.buffer)
  const accepted =
    actual &&
    ((allowed.includes('image') && actual.startsWith('image/')) ||
      (allowed.includes('video') && actual.startsWith('video/')) ||
      (allowed.includes('pdf') && actual === 'application/pdf'))
  if (!accepted) throw new Error(`محتوى الملف ${file.originalname || 'المرفق'} لا يطابق صيغة آمنة ومسموحة.`)
  if (file.mimetype === 'application/pdf' && actual !== 'application/pdf') throw new Error('توقيع ملف PDF غير صحيح.')
  return actual
}
