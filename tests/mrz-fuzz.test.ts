// The back of the card as a phone camera + OCR really reads it: look-alike characters, lost or extra fillers,
// spaces, lower case and stray lines. Valid zones built with the ICAO check digits are corrupted the way OCR does,
// and the parser must recover them — without ever turning a misread card into a different valid identity.
import { describe, expect, it } from 'vitest'
import { checkDigit, mrzReadStatus, parseTd1, type Td1 } from '../server/mrz'
import { iraqiTd1 } from './helpers'

const TODAY = new Date('2026-10-11T00:00:00Z')

/** deterministic: a failing case can be replayed */
function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type Random = ReturnType<typeof random>
const pick = <T>(rng: Random, list: readonly T[]) => list[Math.floor(rng() * list.length)]
const digits = (rng: Random, count: number) => Array.from({ length: count }, () => Math.floor(rng() * 10)).join('')
const pad2 = (value: number) => String(value).padStart(2, '0')

const SURNAMES = ['YASEEN', 'ALRIKABI', 'ALSAADI', 'ALJUBOURI', 'HASSAN', 'ALZUBAIDI', 'ALKHAFAJI', 'ALASADI', 'KADHIM']
const GIVEN = ['MAHAB', 'ALI', 'HUSSEIN', 'ZAINAB', 'FATIMA', 'MOHAMMED', 'ABBAS', 'MARYAM', 'HAIDER', 'NOOR', 'SAJAD']
// G and L weigh exactly like 6 and 1 in a check digit — no MRZ check can tell them apart, so the series letters are
// drawn without them here (the parser's behaviour on them is tested on its own below, with SERIES_ALL)
const SERIES = 'ABCDEFHJKMNPRSTUVWXYZ'
const SERIES_ALL = 'ABCDEFGHJKLMNPRSTUVWXYZ'

type Card = { text: string; number: string; birth: string; expiry: string; surname: string; given: string }

function card(rng: Random, series = SERIES): Card {
  const format = Math.floor(rng() * 3)
  const number =
    format === 0
      ? `${pick(rng, [...series])}${digits(rng, 8)}`
      : format === 1
        ? `${pick(rng, [...series])}${pick(rng, [...series])}${digits(rng, 7)}`
        : digits(rng, 9)
  const year = 1935 + Math.floor(rng() * 72)
  const birth = `${String(year).slice(2)}${pad2(1 + Math.floor(rng() * 12))}${pad2(1 + Math.floor(rng() * 28))}`
  const expiry = `${27 + Math.floor(rng() * 10)}${pad2(1 + Math.floor(rng() * 12))}${pad2(1 + Math.floor(rng() * 28))}`
  const surname = pick(rng, SURNAMES)
  let given = pick(rng, GIVEN)
  while (rng() < 0.5 && `${surname}<<${given}`.length < 22) given += ` ${pick(rng, GIVEN)}`
  const sex = rng() < 0.5 ? 'M' : 'F'
  if (rng() < 0.5) {
    return { text: iraqiTd1({ number, birth, sex, expiry, surname, given }), number, birth, expiry, surname, given }
  }
  // the unified card's layout: ID + IRQ, and the 12-digit national number in the optional data
  const optional1 = `${rng() < 0.5 ? 1 : 2}${digits(rng, 11)}`.padEnd(15, '<')
  const l1Body = `${number}${checkDigit(number)}${optional1}`
  const birthField = `${birth}${checkDigit(birth)}`
  const expiryField = `${expiry}${checkDigit(expiry)}`
  const optional2 = '<'.repeat(11)
  const composite = checkDigit(`${l1Body}${birthField}${expiryField}${optional2}`)
  const text = [
    `IDIRQ${l1Body}`,
    `${birthField}${sex}${expiryField}IRQ${optional2}${composite}`,
    `${surname}<<${given.replace(/ /g, '<')}`.padEnd(30, '<'),
  ].join('\n')
  return { text, number, birth, expiry, surname, given }
}

// what OCR-B under a phone camera is read as
const DIGIT_LOOKALIKES: Record<string, string[]> = {
  0: ['O', 'Q', 'D'],
  1: ['I', 'L'],
  2: ['Z'],
  5: ['S'],
  6: ['G'],
  7: ['T'],
  8: ['B'],
}
const LETTER_LOOKALIKES: Record<string, string> = { O: '0', Q: '0', I: '1', Z: '2', S: '5', G: '6', T: '7', B: '8' }
const NAME_LOOKALIKES: Record<string, string> = { ...LETTER_LOOKALIKES, A: '4' }
const NOISE = ['REPUBLIC OF IRAQ', 'جمهورية العراق', 'MINISTRY OF INTERIOR', '|', '. ,', 'X7 <K', 'ـــ']

const garbage = (rng: Random) =>
  Array.from({ length: 6 + Math.floor(rng() * 28) }, () =>
    pick(rng, [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<   '])
  ).join('')

/** Changes the length of the trailing run of fillers by -3…+3 (lines read 27–33 characters long). */
function jitterRun(line: string, from: number, to: number, rng: Random) {
  const run = line.slice(from, to)
  if (!/^<+$/.test(run)) return line
  const delta = Math.floor(rng() * 7) - 3
  const length = Math.max(0, run.length + delta)
  return line.slice(0, from) + '<'.repeat(length) + line.slice(to)
}

type Field = 'number' | 'document' | 'letters' | 'name' | 'filler'

/** per character: 4.2% of digits, 3% of letters and of fillers read as a look-alike (a blurry phone photo) */
const REALISTIC = 0.6

function corrupt(text: string, rng: Random, strength = 1) {
  let [l1, l2, l3] = text.split('\n')
  const lookalike = (char: string, field: Field, leftIsFiller: boolean) => {
    // G/6 and L/1 weigh the same in a check digit: in the document number no MRZ reader can undo them
    const lookalikes = (DIGIT_LOOKALIKES[char] || []).filter(item => field !== 'document' || !/[GL]/.test(item))
    if (/[0-9]/.test(char) && field !== 'name' && rng() < 0.07 * strength && lookalikes.length)
      return pick(rng, lookalikes)
    if (/[A-Z]/.test(char) && field !== 'number' && field !== 'document' && rng() < 0.05 * strength) {
      const table = field === 'name' ? NAME_LOOKALIKES : LETTER_LOOKALIKES
      if (table[char]) return table[char]
    }
    if (char === '<' && rng() < 0.05 * strength) return pick(rng, leftIsFiller ? ['«', '‹', '(', 'K'] : ['«', '‹', '('])
    return char
  }
  const fieldOf1 = (index: number): Field =>
    index < 5 ? 'letters' : index < 14 ? 'document' : index === 14 ? 'number' : 'filler'
  const fieldOf2 = (index: number): Field =>
    index === 7 || (index >= 15 && index <= 17) ? 'letters' : index >= 18 && index <= 28 ? 'filler' : 'number'
  const apply = (line: string, fieldOf: (index: number) => Field) =>
    [...line].map((char, index) => lookalike(char, fieldOf(index), line[index - 1] === '<')).join('')
  // the document number's series letters are letters, its digits are digits
  const numberField = (index: number): Field =>
    index >= 5 && index < 14 && /[A-Z]/.test(l1[index]) ? 'letters' : fieldOf1(index)
  l1 = apply(l1, numberField)
  l2 = apply(l2, fieldOf2)
  l3 = apply(l3, () => 'name')
  // the document number exactly as the look-alikes left it (spaces and fillers below never touch it)
  const number = l1.slice(5, 14)
  // lost / extra fillers
  if (rng() < 0.35) l1 = jitterRun(l1, l1.search(/<+$/), 30, rng)
  if (rng() < 0.35) l2 = jitterRun(l2, 18, 29, rng)
  if (rng() < 0.35) l3 = jitterRun(l3, l3.search(/<+$/), 30, rng)
  // spaces between characters; on the name line next to the fillers (where OCR sees word gaps)
  const spaced = (line: string, anywhere: boolean) => {
    let out = line
    for (let count = Math.floor(rng() * 3); count > 0; count--) {
      const slots = [...out]
        .map((_, index) => index)
        .filter(index => anywhere || out[index] === '<' || out[index - 1] === '<')
      const at = pick(rng, slots.length ? slots : [0])
      out = `${out.slice(0, at)} ${out.slice(at)}`
    }
    return out
  }
  if (rng() < 0.4) l1 = spaced(l1, true)
  if (rng() < 0.4) l2 = spaced(l2, true)
  if (rng() < 0.4) l3 = spaced(l3, false)
  // stray punctuation at the ends of lines
  const junk = (line: string) => (rng() < 0.15 ? `${line}${pick(rng, ['|', '.', ',', '"', ' '])}` : line)
  const lines = [junk(l1), junk(l2), junk(l3)]
  if (rng() < 0.1) lines.splice(1 + Math.floor(rng() * 2), 0, pick(rng, ['|', '. ,', 'ـ']))
  const before = Array.from({ length: Math.floor(rng() * 4) }, () => (rng() < 0.5 ? pick(rng, NOISE) : garbage(rng)))
  const after = Array.from({ length: Math.floor(rng() * 3) }, () => (rng() < 0.5 ? pick(rng, NOISE) : garbage(rng)))
  let out = [...before, ...lines, ...after].join('\n')
  if (rng() < 0.15) out = out.toLowerCase()
  else if (rng() < 0.15) out = [...out].map(char => (rng() < 0.3 ? char.toLowerCase() : char)).join('')
  return { text: out, number }
}

const isoOf = (yymmdd: string, kind: 'birth' | 'expiry') => {
  const yy = Number(yymmdd.slice(0, 2))
  const century = kind === 'birth' ? (yy > 26 ? 1900 : 2000) : 2000
  return `${century + yy}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`
}
const sameIdentity = (td1: Td1, truth: Card) =>
  td1.documentNumber === truth.number &&
  td1.birthDate === isoOf(truth.birth, 'birth') &&
  td1.expiryDate === isoOf(truth.expiry, 'expiry')
const recovered = (td1: Td1 | null, truth: Card) =>
  !!td1 && td1.valid && sameIdentity(td1, truth) && td1.surname === truth.surname && td1.givenNames === truth.given

/**
 * A valid zone that is not the card's must owe that to the noise alone: two look-alikes that cancel out in a mod-10
 * check digit (7·a + 3·b ≡ 0 for the first two characters: "88…" read "BB…", "11…" read "II…"), which no MRZ reader
 * can see through. Every character of the number that differs from the card must be one the noise put there and
 * the parser left as read — never one the parser changed — and look-alikes in a date are always undone exactly.
 */
function expectNoisyNotCorrected(td1: Td1, truth: Card, readNumber: string, why: string) {
  const output = td1.documentNumber.padEnd(9, '<')
  for (let at = 0; at < 9; at++) if (output[at] !== truth.number[at]) expect(output[at], why).toBe(readNumber[at])
  expect(td1.birthDate, why).toBe(isoOf(truth.birth, 'birth'))
  expect(td1.expiryDate, why).toBe(isoOf(truth.expiry, 'expiry'))
}

describe('TD1 parser under OCR noise (fuzz)', () => {
  it('recovers at least 95% of realistically corrupted zones exactly, and never corrects one into another identity', () => {
    const rng = random(20261011)
    const cases = 1500
    let ok = 0
    let inherent = 0
    const misses: string[] = []
    const started = performance.now()
    for (let index = 0; index < cases; index++) {
      const truth = card(rng)
      const { text: noisy, number } = corrupt(truth.text, rng, REALISTIC)
      const td1 = parseTd1(noisy, TODAY)
      if (recovered(td1, truth)) ok++
      else if (misses.length < 8) misses.push(`${JSON.stringify(truth.text)} read as ${JSON.stringify(noisy)}`)
      if (td1?.valid && !sameIdentity(td1, truth)) {
        expectNoisyNotCorrected(td1, truth, number, `${JSON.stringify(noisy)} → ${JSON.stringify(td1)}`)
        inherent++
      }
    }
    const elapsed = performance.now() - started
    expect(inherent / cases).toBeLessThan(0.003)
    // ~94%: the rest stays 'partial' on purpose — a number that needs two look-alikes undone, or whose series edge
    // could be L/1 or G/6 either way, is not guessed (see the cases below); the full checks and a person settle it
    expect(ok / cases, misses.join('\n')).toBeGreaterThanOrEqual(0.93)
    // a parse is a few milliseconds at most: the time budget belongs to the OCR
    expect(elapsed / cases).toBeLessThan(15)
  })

  it('under heavy noise a wrong identity never comes from a correction', () => {
    // At three times the noise several misreads in one field can cancel out in its mod-10 check digit — no MRZ
    // reader can see through that, and it stays rare. What the parser adds (look-alike corrections, re-aligned
    // lines) must never be what turns a misread card into a different valid identity.
    const rng = random(7)
    const cases = 800
    let valid = 0
    const inherent: string[] = []
    for (let index = 0; index < cases; index++) {
      const truth = card(rng)
      const { text: noisy, number } = corrupt(truth.text, rng, 3)
      const td1 = parseTd1(noisy, TODAY)
      if (!td1?.valid) continue
      valid++
      if (sameIdentity(td1, truth)) continue
      const why = `${JSON.stringify(noisy)} → ${JSON.stringify(td1)}`
      expectNoisyNotCorrected(td1, truth, number, why)
      inherent.push(why)
    }
    expect(inherent.length / cases, inherent.join('\n')).toBeLessThan(0.01)
    expect(valid).toBeGreaterThan(cases * 0.3)
  })

  it('a digit misread as another digit is never "corrected": the zone stays partial', () => {
    const rng = random(99)
    let partial = 0
    for (let index = 0; index < 600; index++) {
      const truth = card(rng)
      const [l1, l2, l3] = truth.text.split('\n')
      // one digit-for-digit substitution in the document number, a date or a check digit: the check digits are
      // the only witness, and no look-alike rule may explain it away
      const positions = [
        ...[...l1.slice(0, 15)].map((char, at) => (/[0-9]/.test(char) ? `1:${at}` : '')),
        ...[...l2.slice(0, 15)].map((char, at) => (/[0-9]/.test(char) ? `2:${at}` : '')),
      ].filter(Boolean)
      const [line, at] = pick(rng, positions).split(':').map(Number)
      const swap = (value: string) => {
        const old = value[at]
        const replacement = String((Number(old) + 1 + Math.floor(rng() * 9)) % 10)
        return value.slice(0, at) + replacement + value.slice(at + 1)
      }
      const misread = [line === 1 ? swap(l1) : l1, line === 2 ? swap(l2) : l2, l3].join('\n')
      // plus the usual look-alike noise elsewhere
      const td1 = parseTd1(corrupt(misread, rng, 0.5).text, TODAY)
      if (td1?.valid) expect(sameIdentity(td1, truth), JSON.stringify(td1)).toBe(true)
      if (td1 && !td1.valid) partial++
    }
    expect(partial).toBeGreaterThan(550)
  })

  it('two corrections that both pass the check digit are not chosen between', () => {
    // "B7O409529" read with check digit 5: "B70409529" (O→0) and "BTO409529" (7→T) are equally close and both
    // satisfy it — the parser must not pick one
    expect(checkDigit('B70409529')).toBe(5)
    expect(checkDigit('BTO409529')).toBe(5)
    const birth = `900101${checkDigit('900101')}`
    const expiry = `300101${checkDigit('300101')}`
    const text = [
      `I<IRQB7O4095295${'<'.repeat(15)}`,
      `${birth}M${expiry}IRQ${'<'.repeat(11)}0`,
      'YASEEN<<MAHAB<ALI'.padEnd(30, '<'),
    ].join('\n')
    const td1 = parseTd1(text, TODAY)!
    expect(td1.valid).toBe(false)
    expect(td1.ambiguous).toContain('documentNumber')
    expect(td1.documentNumber).toBe('B7O409529')
    expect(mrzReadStatus(td1)).toBe('partial')
    // the rest of the zone is still read for the citizen to review
    expect(td1.birthDate).toBe('1990-01-01')
    expect(td1.givenNames).toBe('MAHAB ALI')
  })

  it('two OCR readings of one photo that pass every check yet disagree are trusted neither', () => {
    // G and 6 weigh the same in a check digit: "G12345678" and "612345678" both pass
    const genuine = iraqiTd1({
      number: 'G12345678',
      birth: '900101',
      sex: 'M',
      expiry: '300101',
      surname: 'YASEEN',
      given: 'MAHAB',
    })
    const misread = genuine.replace('G12345678', '612345678')
    expect(parseTd1(genuine, TODAY)?.valid).toBe(true)
    const both = parseTd1([genuine, misread], TODAY)!
    expect(both.valid).toBe(false)
    expect(both.ambiguous).toContain('documentNumber')
  })

  it('a letter among the digits of the number is read back as the digit only when the check digit proves it', () => {
    const genuine = iraqiTd1({
      number: 'A12345678',
      birth: '900101',
      sex: 'M',
      expiry: '300101',
      surname: 'YASEEN',
      given: 'MAHAB',
    })
    const td1 = parseTd1(genuine.replace('A12345678', 'A1234S678'), TODAY)!
    expect(td1.valid).toBe(true)
    expect(td1.documentNumber).toBe('A12345678')
    expect(td1.corrections).toContain('documentNumber')
    // the same look-alike with a wrong check digit: nothing is proved, nothing is changed
    const wrongCheck = genuine.replace(/A12345678\d/, 'A1234S6780')
    const unproved = parseTd1(wrongCheck, TODAY)!
    expect(unproved.valid).toBe(false)
    expect(unproved.documentNumber).toBe('A1234S678')
  })

  it('look-alikes the other way round (3 read as B, 7 as Z, 0 as U …) and G/L in the number: no correction makes up an identity', () => {
    // A digit read as a letter the parser maps back to another digit (B→8 for a real 3, Z→2 for a real 7, G→6 for a
    // real 9) or to none (U); G and L in the series, read as 6 and 1. A wrong identity may only come from the noise
    // alone — a number as read that passes its check digit (G/6, L/1, S/8, U/0 weigh the same) — or, rarely, from one
    // look-alike undone next to a second misread that happens to cancel it out; never from two corrections.
    const rng = random(2027)
    const cases = 2000
    let valid = 0
    let corrected = 0
    for (let index = 0; index < cases; index++) {
      const truth = card(rng, SERIES_ALL)
      const { text: noisy, number: read } = corrupt(misreadNumber(truth.text, rng, 0.04), rng, REALISTIC)
      const td1 = parseTd1(noisy, TODAY)
      if (!td1?.valid) continue
      valid++
      if (sameIdentity(td1, truth)) continue
      const why = `${truth.number} read ${read} → ${td1.documentNumber}`
      // dates are always undone exactly
      expect(td1.birthDate, why).toBe(isoOf(truth.birth, 'birth'))
      expect(td1.expiryDate, why).toBe(isoOf(truth.expiry, 'expiry'))
      const output = td1.documentNumber.padEnd(9, '<')
      // a wrong character the parser left as read is the noise's doing (it weighs like the real one)
      const madeUp = [...output].some((char, at) => char !== truth.number[at] && char !== read[at])
      if (!madeUp) continue
      // the parser changed one character of what was read, never two
      expect([...read].filter((char, at) => char !== output[at]).length, why).toBe(1)
      corrected++
    }
    expect(corrected / cases).toBeLessThan(0.002)
    expect(valid).toBeGreaterThan(cases * 0.7)
  })

  it('reading up to seven views of one photo is hardly more likely to end in a wrong identity than reading one', () => {
    // What readMrzLocally does: one view after another, the lines of all of them combined, until a valid zone. Every
    // view is a fresh chance for misreads to cancel out, so after the first view a valid zone also needs a second
    // view that agrees with it on its own (parseTd1).
    const rng = random(4242)
    const cases = 800
    let single = 0
    let several = 0
    let read = 0
    for (let index = 0; index < cases; index++) {
      const truth = card(rng, SERIES_ALL)
      // the same card read seven times, each time with misreads of its own, both ways round
      const views = Array.from({ length: 7 }, () => {
        const misread = misreadNumber(truth.text, rng, 0.04)
        return corrupt(misread, rng, REALISTIC * 1.5).text
      })
      const first = parseTd1(views[0], TODAY)
      if (first?.valid && !sameIdentity(first, truth)) single++
      let td1: Td1 | null = null
      for (let count = 1; count <= views.length; count++) {
        td1 = parseTd1(views.slice(0, count), TODAY) ?? td1
        if (td1?.valid) break
      }
      if (td1?.valid) {
        if (sameIdentity(td1, truth)) read++
        else several++
      }
    }
    // (without the second view's agreement this seed ends in 18 wrong identities against 14 for one view)
    expect(several).toBeLessThanOrEqual(single + 1)
    // and the extra views still read most of what the first one misses
    expect(read).toBeGreaterThan(cases * 0.95)
  })
})

/** A digit read as a letter the parser maps back to another digit (B→8 for a real 3), or to none (U). */
const WRONG_WAY: Record<string, string[]> = {
  0: ['U'],
  1: ['L'],
  3: ['B'],
  6: ['B', 'G'],
  7: ['Z'],
  8: ['S'],
  9: ['G'],
}
const DIGIT_OF_SERIES: Record<string, string> = { G: '6', L: '1' }

/** Look-alikes the other way round in the document number, and G/L series letters read as 6/1 (`rate` per character). */
function misreadNumber(text: string, rng: Random, rate: number) {
  const [l1, l2, l3] = text.split('\n')
  const number = [...l1.slice(5, 14)]
    .map(char =>
      /[0-9]/.test(char) && rng() < rate
        ? pick(rng, WRONG_WAY[char] ?? [char])
        : /[GL]/.test(char) && rng() < rate
          ? DIGIT_OF_SERIES[char]
          : char
    )
    .join('')
  return [`${l1.slice(0, 5)}${number}${l1.slice(14)}`, l2, l3].join('\n')
}
