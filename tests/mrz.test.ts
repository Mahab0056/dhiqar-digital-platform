// TD1 machine-readable zone (back of the Iraqi unified ID card): parsing and ICAO 9303 check digits.
import { describe, expect, it } from 'vitest'
import { checkDigit, foldDocumentNumber, iraqiCardProblems, mrzReadStatus, parseTd1 } from '../server/mrz'
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

describe('reading the zone as OCR returns it', () => {
  const TODAY = new Date('2026-10-11')
  const card = iraqiTd1({
    number: 'A12345678',
    birth: '900101',
    sex: 'M',
    expiry: '300101',
    surname: 'YASEEN',
    given: 'MAHAB ALI',
  })
  const [l1, l2, l3] = card.split('\n')

  it('stray text alone is not a zone: unreadable', () => {
    const noise = 'REPUBLIC OF IRAQ\nجمهورية العراق\nKJH7 23LK<B OPQ\n0 < 1UNSJRZ RIZIJ 9A905K6 <2B0S'
    expect(parseTd1(noise, TODAY)).toBeNull()
    expect(mrzReadStatus(parseTd1(noise, TODAY))).toBe('unreadable')
    expect(mrzReadStatus(parseTd1(card, TODAY))).toBe('ok')
  })

  it('a line broken in two by the OCR, or two lines run together, is put back', () => {
    const broken = [l1, `${l2.slice(0, 15)}`, `${l2.slice(15)}`, l3].join('\n')
    expect(parseTd1(broken, TODAY)?.valid).toBe(true)
    const runTogether = [`${l1} ${l2}`, l3].join('\n')
    expect(parseTd1(runTogether, TODAY)?.valid).toBe(true)
  })

  it('lines of 27–33 characters (fillers lost or added) are laid back out to 30', () => {
    const uneven = [l1.slice(0, 27), l2.replace('<<<<<<<<<<<', '<<<<<<<<<<<<<<'), `${l3}<<<`].join('\n')
    const td1 = parseTd1(uneven, TODAY)!
    expect(td1.valid).toBe(true)
    expect(td1.corrections).toContain('layout')
    expect(`${td1.givenNames} ${td1.surname}`).toBe('MAHAB ALI YASEEN')
  })

  it('line 1 not read: the dates and the name still come back, never as a valid zone', () => {
    const td1 = parseTd1(['REPUBLIC OF IRAQ', l2, l3].join('\n'), TODAY)!
    expect(td1.valid).toBe(false)
    expect(mrzReadStatus(td1)).toBe('partial')
    expect(td1.birthDate).toBe('1990-01-01')
    expect(td1.expiryDate).toBe('2030-01-01')
    expect(td1.surname).toBe('YASEEN')
  })

  it('reports what it corrected: IRQ read as 1RQ, O for 0 in a date, the name with a digit in it', () => {
    const td1 = parseTd1(
      [l1.replace('IRQ', '1RQ'), l2.replace('900101', '9OO1O1'), l3.replace('MAHAB', 'M4HAB')].join('\n'),
      TODAY
    )!
    expect(td1.valid).toBe(true)
    expect(td1.issuingState).toBe('IRQ')
    expect(td1.givenNames).toBe('MAHAB ALI')
    expect(td1.corrections).toEqual(expect.arrayContaining(['issuingState', 'birthDate', 'names']))
    expect(td1.corrections).not.toContain('documentNumber')
  })
})

describe('a misread card never becomes another valid identity through a correction', () => {
  const TODAY = new Date('2026-10-11')
  const zone = (number: string) =>
    iraqiTd1({ number, birth: '900101', sex: 'M', expiry: '300101', surname: 'YASEEN', given: 'MAHAB ALI' })
  /** the unified card: ID + IRQ and the national number in the optional data */
  const unified = (number: string) => {
    const l1Body = `${number}${checkDigit(number)}${'199012345678'.padEnd(15, '<')}`
    const birth = `900101${checkDigit('900101')}`
    const expiry = `300101${checkDigit('300101')}`
    const composite = checkDigit(`${l1Body}${birth}${expiry}${'<'.repeat(11)}`)
    return [
      `IDIRQ${l1Body}`,
      `${birth}M${expiry}IRQ${'<'.repeat(11)}${composite}`,
      'YASEEN<<MAHAB<ALI'.padEnd(30, '<'),
    ].join('\n')
  }

  it('two look-alikes in the number that cancel out are not undone (both 3s read as B)', () => {
    // B→8 for a real 3 moves each digit by 5, and every weight is odd: the two errors cancel in the check digit
    expect(checkDigit('A12848678')).toBe(checkDigit('A12343678'))
    const td1 = parseTd1(zone('A12343678').replace('A12343678', 'A12B4B678'), TODAY)!
    expect(td1.valid).toBe(false)
    expect(td1.documentNumber).toBe('A12B4B678')
    expect(mrzReadStatus(td1)).toBe('partial')
    expect(iraqiCardProblems(td1, TODAY)).toContain('أرقام التحقق في المنطقة المقروءة آلياً غير متطابقة')
  })

  it('… nor on the unified card (both 7s read as Z)', () => {
    expect(checkDigit('AB1242567')).toBe(checkDigit('AB1747567'))
    const td1 = parseTd1(unified('AB1747567').replace('AB1747567', 'AB1Z4Z567'), TODAY)!
    expect(td1.valid).toBe(false)
    expect(td1.documentNumber).not.toBe('AB1242567')
  })

  it('L/1 at the edge of the series is not settled by the check digit: undecided, not guessed', () => {
    // "L095I4853": with L as the series letter one look-alike (I→1) passes; read as 1 (the real number) two do
    expect(checkDigit('L09514853')).toBe(checkDigit('109514853'))
    const td1 = parseTd1(zone('109514853').replace('109514853', 'L095I4853'), TODAY)!
    expect(td1.valid).toBe(false)
    expect(td1.ambiguous).toContain('documentNumber')
  })

  it('a letter after the digits that resembles no digit is not proved by a passing check digit', () => {
    // a 0 read as U: U weighs 30, like 0, so the check digit still passes
    expect(checkDigit('A1203U567')).toBe(checkDigit('A12030567'))
    const td1 = parseTd1(zone('A12030567').replace('A12030567', 'A1203U567'), TODAY)!
    expect(td1.valid).toBe(false)
    expect(td1.checks.documentNumber).toBe(false)
  })

  it('look-alikes that weigh the same fold to one key, so a misread cannot pass a duplicate check', () => {
    // "S12345678" for 812345678 passes every check as read — no MRZ reader can tell; the folded key can
    expect(checkDigit('S12345678')).toBe(checkDigit('812345678'))
    expect(parseTd1(zone('812345678').replace('812345678', 'S12345678'), TODAY)?.valid).toBe(true)
    expect(foldDocumentNumber('S12345678')).toBe(foldDocumentNumber('812345678'))
    expect(foldDocumentNumber('G81956698')).toBe(foldDocumentNumber('681956698'))
    expect(foldDocumentNumber('NL2961463')).toBe(foldDocumentNumber('N12961463'))
    expect(foldDocumentNumber('A1203U567<')).toBe(foldDocumentNumber('A12030567'))
    expect(foldDocumentNumber('A12345678')).not.toBe(foldDocumentNumber('A12345679'))
  })

  it('dates that cannot be real are not proved, even when their check digit passes', () => {
    // expiry 300123 read "B0012B": both B→8 cancel out — a card valid until 2080
    expect(checkDigit('800128')).toBe(checkDigit('300123'))
    const card = iraqiTd1({
      number: 'A12345678',
      birth: '900101',
      sex: 'M',
      expiry: '300123',
      surname: 'X',
      given: 'Y',
    })
    const [l1, l2, l3] = card.split('\n')
    const misread = parseTd1([l1, `${l2.slice(0, 8)}B0012B${l2.slice(14)}`, l3].join('\n'), TODAY)!
    expect(misread.expiryDate).toBe('2080-01-28')
    expect(misread.checks.expiryDate).toBe(false)
    expect(misread.valid).toBe(false)
    // born in the future, or after the card expires
    const future = iraqiTd1({
      number: 'A12345678',
      birth: '261231',
      sex: 'M',
      expiry: '300101',
      surname: 'X',
      given: 'Y',
    })
    expect(parseTd1(future, TODAY)?.checks.birthDate).toBe(false)
    const reversed = iraqiTd1({
      number: 'A12345678',
      birth: '010101',
      sex: 'M',
      expiry: '280101',
      surname: 'X',
      given: 'Y',
    })
    expect(parseTd1(reversed, new Date('2000-06-01'))?.valid).toBe(false)
    expect(parseTd1(zone('A12345678'), TODAY)?.valid).toBe(true)
  })
})

describe('several readings of one photo', () => {
  const TODAY = new Date('2026-10-11')
  const card = iraqiTd1({
    number: 'A12345678',
    birth: '900101',
    sex: 'M',
    expiry: '300101',
    surname: 'YASEEN',
    given: 'MAHAB ALI',
  })
  const [l1, l2, l3] = card.split('\n')
  const lines = (...parts: string[]) => parts.join('\n')
  /** line 2 with one check digit (6: birth, 14: expiry) misread digit-for-digit */
  const wrongCheck = (at: number) => `${l2.slice(0, at)}${(Number(l2[at]) + 3) % 10}${l2.slice(at + 1)}`

  it('lines combined from different readings wait for a second reading of the same number and dates', () => {
    // each reading misreads one digit for another (nothing a look-alike rule may undo), never on the same line
    const first = lines(l1, wrongCheck(6), l3)
    const second = lines(l1.replace('A12345678', 'A12345679'), l2, l3)
    const combined = parseTd1([first, second], TODAY)!
    expect(Object.values(combined.checks).every(Boolean)).toBe(true)
    expect(combined.valid).toBe(false)
    expect(combined.unconfirmed).toBe(true)
    expect(mrzReadStatus(combined)).toBe('partial')
    expect(iraqiCardProblems(combined, TODAY)).toContain('قراءة المنطقة المقروءة آلياً لم تتأكد بقراءة ثانية')
    // a third reading that, on its own, reads the same number and dates (its own expiry check digit misread)
    // agrees with the first one: two readings now confirm what the combined lines prove
    const third = lines(l1, wrongCheck(14), l3)
    expect(parseTd1(third, TODAY)?.valid).toBe(false)
    const confirmed = parseTd1([first, second, third], TODAY)!
    expect(confirmed.valid).toBe(true)
    expect(confirmed.unconfirmed).toBeUndefined()
    expect(confirmed.documentNumber).toBe('A12345678')
  })

  it('a misread line 1 that passes by luck does not become an identity next to a clean line 2 from another reading', () => {
    // the real number is A12343678; one reading sees both 3s as 8 (they cancel out in the check digit, and the
    // composite repeats the number's weights) but misreads its birth date, the other misreads the number
    const real = iraqiTd1({
      number: 'A12343678',
      birth: '900101',
      sex: 'M',
      expiry: '300101',
      surname: 'YASEEN',
      given: 'MAHAB ALI',
    })
    const [r1, r2, r3] = real.split('\n')
    const lucky = lines(r1.replace('A12343678', 'A12848678'), r2.replace('900101', '900131'), r3)
    const other = lines(r1.replace('A12343678', 'A12343698'), r2, r3)
    expect(parseTd1(lucky, TODAY)?.valid).toBe(false)
    expect(parseTd1(other, TODAY)?.valid).toBe(false)
    const combined = parseTd1([lucky, other], TODAY)!
    expect(combined.documentNumber).toBe('A12848678')
    expect(Object.values(combined.checks).every(Boolean)).toBe(true)
    expect(combined.valid).toBe(false)
    expect(combined.unconfirmed).toBe(true)
  })

  it('a later reading valid on its own is still confirmed by another one', () => {
    expect(parseTd1(card, TODAY)?.valid).toBe(true)
    expect(parseTd1(['REPUBLIC OF IRAQ', card], TODAY)?.valid).toBe(false)
    expect(parseTd1(['REPUBLIC OF IRAQ', card, card], TODAY)?.valid).toBe(true)
  })
})
