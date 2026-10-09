// TD1 machine-readable zone (back of the Iraqi unified ID card): parsing and ICAO 9303 check digits.
import { describe, expect, it } from 'vitest'
import { iraqiCardProblems, parseTd1 } from '../server/mrz'
import { iraqiTd1 } from './helpers'

// the ICAO 9303 part 5 specimen (check digits are known to be correct)
const SPECIMEN = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
].join('\n')

describe('TD1 machine-readable zone', () => {
  it('parses the ICAO specimen with every check digit holding', () => {
    const td1 = parseTd1(SPECIMEN, new Date('2010-01-01'))!
    expect(td1.documentNumber).toBe('D23145890')
    expect(td1.birthDate).toBe('1974-08-12')
    expect(td1.expiryDate).toBe('2012-04-15')
    expect(td1.sex).toBe('F')
    expect(td1.surname).toBe('ERIKSSON')
    expect(td1.givenNames).toBe('ANNA MARIA')
    expect(td1.valid).toBe(true)
  })

  it('reads through typical OCR noise (spaces, «, O for 0 in date fields)', () => {
    const noisy =
      'REPUBLIC OF IRAQ\nI<UTOD2314589 07<<<<<<<<<<<<<<<\n74O8122F12O4159UTO«<<<<<<<<<<6\nERIKSSON<<ANNA<MARIA<<<<<<<<<<'
    expect(parseTd1(noisy, new Date('2010-01-01'))?.valid).toBe(true)
  })

  it('a single misread digit breaks the checks', () => {
    const altered = SPECIMEN.replace('7408122', '7408132')
    expect(parseTd1(altered, new Date('2010-01-01'))?.valid).toBe(false)
  })

  it('flags foreign, expired or unreadable cards', () => {
    expect(iraqiCardProblems(parseTd1(SPECIMEN, new Date('2010-01-01')), new Date('2010-01-01'))).toContain(
      'البطاقة ليست عراقية'
    )
    const card = iraqiTd1({
      number: 'A12345678',
      birth: '900101',
      sex: 'M',
      expiry: '300101',
      surname: 'ALRIKABI',
      given: 'MAHAB ALI',
    })
    expect(iraqiCardProblems(parseTd1(card))).toEqual([])
    expect(iraqiCardProblems(parseTd1(card), new Date('2031-01-01'))).toContain('البطاقة منتهية الصلاحية')
    expect(iraqiCardProblems(null)).toHaveLength(1)
  })
})
