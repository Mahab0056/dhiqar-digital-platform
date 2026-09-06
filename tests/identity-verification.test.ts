import { describe, expect, it } from 'vitest'
import { configureTestEnv } from './helpers'

configureTestEnv()

describe('identity name matching', () => {
  it('matches Arabic names with spelling variants and honorific noise', async () => {
    const { compareNames } = await import('../server/identity-verification.ts')
    const exact = compareNames('حسين علي كاظم الياسري', 'حسين علي كاظم الياسري')
    expect(exact.status).toBe('MATCH')
    const variant = compareNames('حسين علي كاظم', 'الاسم: حسين على كاظم الياسري')
    expect(variant.status).toBe('MATCH')
    const different = compareNames('حسين علي كاظم', 'محمد جاسم عبد')
    expect(different.status).toBe('NO_MATCH')
    const missing = compareNames('حسين علي كاظم', null)
    expect(missing.status).toBe('NO_NAME_ON_DOCUMENT')
  })
  it('compares an Arabic name against a passport MRZ through transliteration', async () => {
    const { compareNames, nameFromMrz } = await import('../server/identity-verification.ts')
    const mrz = 'P<IRQAL<YASEERI<<HUSSEIN<ALI<KADHIM<<<<<<<<<<<<<<<<\nB0123456<7IRQ8501011M3001019<<<<<<<<<<<<<<04'
    const name = nameFromMrz(mrz)
    expect(name).toContain('HUSSEIN')
    const result = compareNames('حسين علي كاظم الياسري', name)
    expect(result.method).toBe('TRANSLITERATED')
    expect(['MATCH', 'PARTIAL']).toContain(result.status)
    const other = compareNames('سعد فاضل عباس', name)
    expect(other.status).toBe('NO_MATCH')
  })
})

describe('face matching engine', () => {
  it('loads the on-server models and rejects images without a face', async () => {
    const { faceMatchAvailable, embedLargestFace } = await import('../server/face-match.ts')
    expect(faceMatchAvailable()).toBe(true)
    const sharp = (await import('sharp')).default
    const blank = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#7a7a7a' } })
      .jpeg()
      .toBuffer()
    expect(await embedLargestFace(blank)).toBeNull()
  }, 30_000)
})
