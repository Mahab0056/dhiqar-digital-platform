/**
 * Machine-readable zone of the Iraqi unified national ID card (back side): ICAO 9303 TD1 — three lines of 30
 * characters. OCR of this zone is far more reliable than of the Arabic front, and its check digits tell a correct
 * read (and an unaltered card) from a misread one.
 *
 *   line 1: I<IRQ  document number (9) + check  optional data (15)
 *   line 2: birth date YYMMDD + check, sex, expiry YYMMDD + check, nationality (3), optional (11), composite check
 *   line 3: SURNAME<<GIVEN<NAMES
 *
 * A phone photo read by OCR swaps look-alike characters (O/0, S/5, B/8 …), drops or adds filler '<', splits or
 * pads lines and picks up stray text around the zone. The parser undoes those per field type — digits where only
 * digits may stand, letters where only letters may — and lets the check digits choose between readings. It never
 * chooses between two readings that both pass: such a zone comes back not valid ('partial') for a retake or a
 * person to settle, so no correction of the parser turns a misread card into somebody else's valid identity.
 * (Two misreads that cancel out in one mod-10 check digit are beyond any MRZ check; they stay rare.)
 */
export type Td1Field =
  | 'documentCode'
  | 'issuingState'
  | 'documentNumber'
  | 'optional1'
  | 'birthDate'
  | 'expiryDate'
  | 'nationality'
  | 'optional2'
  | 'composite'
  | 'names'
  | 'layout'

export type Td1 = {
  documentCode: string
  issuingState: string
  documentNumber: string
  optional1: string
  birthDate: string | null
  sex: 'M' | 'F' | null
  expiryDate: string | null
  nationality: string
  optional2: string
  surname: string
  givenNames: string
  /** each ICAO check digit, and whether all of them hold */
  checks: { documentNumber: boolean; birthDate: boolean; expiryDate: boolean; composite: boolean }
  valid: boolean
  /** fields read through an OCR look-alike (O→0, 1→I …) or re-aligned ('layout'); the check digits proved them */
  corrections?: Td1Field[]
  /** fields with more than one reading that passes the check digits: left as read and not trusted */
  ambiguous?: Td1Field[]
  /** every check holds, but only through combined or corrected readings that no second reading confirmed yet */
  unconfirmed?: true
}

/** 'ok': every check digit holds · 'partial': a zone was found but not proved · 'unreadable': no zone found. */
export type MrzReadStatus = 'ok' | 'partial' | 'unreadable'
export const mrzReadStatus = (td1: Td1 | null): MrzReadStatus => (!td1 ? 'unreadable' : td1.valid ? 'ok' : 'partial')

const WEIGHTS = [7, 3, 1]
const charValue = (char: string) => {
  if (char === '<') return 0
  if (/[0-9]/.test(char)) return Number(char)
  if (/[A-Z]/.test(char)) return char.charCodeAt(0) - 55
  return -1
}

/** ICAO 9303 check digit over a field. */
export function checkDigit(field: string) {
  let sum = 0
  for (let index = 0; index < field.length; index++) {
    const value = charValue(field[index])
    if (value < 0) return -1
    sum += value * WEIGHTS[index % 3]
  }
  return sum % 10
}
const holds = (field: string, digit: string) => /^[0-9]$/.test(digit) && checkDigit(field) === Number(digit)
/** a date field holds only six digits ('<' weighs like 0 and would pass the check in a digit's place) */
const dateHolds = (field: string, digit: string) => /^[0-9]{6}$/.test(field) && holds(field, digit)

/** YYMMDD → ISO date; births are in the past, expiries within the next 20 years. */
function mrzDate(value: string, kind: 'birth' | 'expiry', today = new Date()) {
  if (!/^\d{6}$/.test(value)) return null
  const yy = Number(value.slice(0, 2))
  const mm = Number(value.slice(2, 4))
  const dd = Number(value.slice(4, 6))
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const currentYY = today.getUTCFullYear() % 100
  const century = kind === 'birth' ? (yy > currentYY ? 1900 : 2000) : yy < currentYY - 30 ? 2100 : 2000
  const iso = `${century + yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  // 31 February parses as 3 March: only a date that comes back as itself is real
  const parsed = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso
}

/** Cards are issued for ten years at most (eleven leaves room for a renewal ahead of time). */
const MAX_VALIDITY_YEARS = 11

/** Dates a real card can carry: born in the past (after 1900), expiring within the validity span, birth first. */
function plausibleDates(birth: string | null, expiry: string | null, today: Date) {
  const born = birth ? Date.parse(birth) : NaN
  const ends = expiry ? Date.parse(expiry) : NaN
  const latestExpiry = Date.UTC(today.getUTCFullYear() + MAX_VALIDITY_YEARS, today.getUTCMonth(), today.getUTCDate())
  const ordered = Number.isNaN(born) || Number.isNaN(ends) || born < ends
  return {
    birth: !Number.isNaN(born) && born <= today.getTime() && born >= Date.UTC(1900, 0, 1) && ordered,
    expiry: !Number.isNaN(ends) && ends <= latestExpiry && ordered,
  }
}

// ---- look-alikes, per field type ---------------------------------------------------------------------------
// G/6 and L/1 weigh the same in a check digit (16 ≡ 6, 21 ≡ 1 mod 10): no check can tell them apart

const DIGIT_FOR: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  Z: '2',
  S: '5',
  B: '8',
  G: '6',
  T: '7',
}
const LETTER_FOR: Record<string, string> = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 6: 'G', 7: 'T', 8: 'B' }
const NAME_LETTER_FOR: Record<string, string> = { ...LETTER_FOR, 4: 'A' }
/** a field that can only hold digits (dates, check digits) */
const asDigits = (value: string) => value.replace(/[A-Z]/g, char => DIGIT_FOR[char] ?? char)
/** a field that can only hold letters (country codes, names) */
const asLetters = (value: string, table = LETTER_FOR) => value.replace(/[0-9]/g, char => table[char] ?? char)
const isDigitLike = (char: string | undefined) => !!char && (/[0-9]/.test(char) || char in DIGIT_FOR)

/** '<' misread as K, L or C inside a run of fillers (between two '<', or a '<' and the end). */
function restoreFillers(value: string) {
  let previous
  do {
    previous = value
    value = value.replace(/<[KLC]+(?=<|$)/g, run => '<'.repeat(run.length))
  } while (value !== previous)
  return value
}

/** An Iraqi code read with one look-alike (1RQ, IR0, LRQ, IRD …); no other ISO 3166 code has this shape. */
const snapIraq = (code: string) => (/^[IL1][RP][QOD0]$/.test(code) ? 'IRQ' : code)

// ---- raw OCR text → candidate lines ---------------------------------------------------------------------------

const upper = (raw: string) => raw.toUpperCase().replace(/[«‹＜〈≤([{]/g, '<')
const mrzChars = (value: string) => value.replace(/[^A-Z0-9<]/g, '')
/** spaces the OCR put between characters are noise … */
const withoutSpaces = (raw: string) => mrzChars(upper(raw).replace(/\s+/g, ''))
/** … unless each run of spaces stood for a filler */
const spacesAsFillers = (raw: string) => mrzChars(upper(raw).trim().replace(/\s+/g, '<'))
/** names: a space next to a filler is noise, a space between two letters was the '<' between two names */
const nameLine = (raw: string) =>
  mrzChars(
    upper(raw)
      .trim()
      .replace(/[\s<]*<[\s<]*/g, run => run.replace(/\s+/g, ''))
      .replace(/\s+/g, '<')
  )
const fit = (line: string) => line.slice(0, 30).padEnd(30, '<')

/** Cleans raw OCR text into candidate MRZ lines (uppercase, no spaces, « and similar read as <). */
export function mrzCandidateLines(text: string) {
  return text
    .split(/\r?\n/)
    .map(withoutSpaces)
    .filter(line => line.length >= 26 && (line.match(/</g) || []).length >= 2)
}

// how much a cleaned line looks like line 1, 2 or 3 of a zone (0…1); stray text scores low on all three
function roleFirst(line: string) {
  if (line.length < 20 || line.length > 40) return 0
  let score = 0
  if (/[IAC]/.test(line[0])) score += 0.3
  else if (/[1L]/.test(line[0])) score += 0.2
  if (snapIraq(asLetters(line.slice(2, 5))) === 'IRQ') score += 0.25
  else if (/IRQ|[IL1][RP][QOD0]/.test(line.slice(0, 8))) score += 0.15
  else if (/^[A-Z<]{3}$/.test(asLetters(line.slice(2, 5)))) score += 0.1
  if (line.includes('<')) score += 0.1
  if (/<{3}/.test(line)) score += 0.05
  if ([...line.slice(5, 15)].filter(isDigitLike).length >= 5) score += 0.1
  if (line.length >= 27 && line.length <= 33) score += 0.2
  return score
}

function roleSecond(line: string) {
  if (line.length < 20 || line.length > 40) return 0
  const dates = line.slice(0, 7) + line.slice(8, 15)
  const digits = [...dates].reduce((sum, char) => sum + (/[0-9]/.test(char) ? 1 : char in DIGIT_FOR ? 0.5 : 0), 0)
  let score = (digits / 14) * 0.5
  if (/[MFX<]/.test(line[7])) score += 0.15
  if (/^[A-Z<]{3}$/.test(asLetters(line.slice(15, 18)))) score += 0.1
  if (isDigitLike(line[line.length - 1])) score += 0.1
  if (line.length >= 27 && line.length <= 33) score += 0.15
  return score
}

function roleThird(line: string) {
  if (line.length < 8 || line.length > 40) return 0
  const letters = (line.match(/[A-Z<]/g) || []).length / line.length
  const digits = (line.match(/[0-9]/g) || []).length / line.length
  let score = letters * 0.4 - digits * 0.4
  if (/[A-Z]{2}<<[A-Z]/.test(line)) score += 0.3
  if (/^[A-Z]{2}/.test(line)) score += 0.1
  if (line.length >= 27 && line.length <= 33) score += 0.2
  return score
}

type Candidate = {
  source: number
  /** position in the OCR text (fractional for a line split in parts); used to keep the three lines in order */
  first: number
  last: number
  raw: string
  first1: number
  second: number
  third: number
}

/** One OCR line that holds two zone lines (the line break was lost) is cut back into its parts. */
function splitRow(raw: string) {
  const parts: string[] = []
  let current = ''
  for (const token of upper(raw).trim().split(/\s+/)) {
    if (mrzChars(current).length >= 26) {
      parts.push(current)
      current = ''
    }
    current += current ? ` ${token}` : token
  }
  if (current) parts.push(current)
  if (parts.length > 1 && parts.every(part => mrzChars(part).length >= 20 && mrzChars(part).length <= 40)) return parts
  return withoutSpaces(raw).match(/.{1,30}/g) ?? []
}

function candidatesOf(text: string, source: number): Candidate[] {
  const rows = text.split(/\r?\n/)
  const pieces: Array<{ first: number; last: number; raw: string }> = []
  rows.forEach((raw, index) => {
    const length = withoutSpaces(raw).length
    if (length >= 54)
      splitRow(raw).forEach((part, at) => pieces.push({ first: index + at / 4, last: index + at / 4, raw: part }))
    else if (length >= 8) pieces.push({ first: index, last: index, raw })
    // one zone line broken in two by the OCR
    const next = rows[index + 1]
    const nextLength = next === undefined ? 0 : withoutSpaces(next).length
    if (length >= 6 && nextLength >= 6 && length < 26 && nextLength < 26 && length + nextLength >= 26)
      if (length + nextLength <= 34) pieces.push({ first: index, last: index + 1, raw: `${raw}${next}` })
  })
  return pieces
    .map(piece => {
      const plain = withoutSpaces(piece.raw)
      return {
        ...piece,
        source,
        first1: roleFirst(plain),
        second: roleSecond(plain),
        third: roleThird(nameLine(piece.raw)),
      }
    })
    .filter(candidate => candidate.first1 >= 0.4 || candidate.second >= 0.45 || candidate.third >= 0.35)
}

type Layout = { line: string; edits: number }

/** spaces dropped — and, when that leaves the line short of 30, spaces read as fillers */
const spacings = (raw: string) => {
  const plain = withoutSpaces(raw)
  const filled = spacesAsFillers(raw)
  return Math.abs(filled.length - 30) < Math.abs(plain.length - 30) ? [plain, filled] : [plain]
}

/** Line 1 laid out to 30 characters; the issuing state anchors it when characters were lost or added before it. */
function firstLayouts(raw: string): Layout[] {
  const layouts: Layout[] = []
  for (const line of spacings(raw)) {
    layouts.push({ line: fit(line), edits: line.length === 30 ? 0 : 1 })
    for (const at of [1, 3, 4]) {
      if (snapIraq(asLetters(line.slice(at, at + 3))) !== 'IRQ') continue
      const prefix = line.slice(0, at)
      const code =
        at >= 2 && /[IAC]/.test(prefix[at - 2]) ? prefix.slice(at - 2) : `${/[AC]/.test(prefix[0]) ? prefix[0] : 'I'}<`
      layouts.push({ line: fit(code + line.slice(at)), edits: 1 })
    }
    if (line.length > 30 && !/[IAC1L]/.test(line[0]) && /[IAC1L]/.test(line[1]))
      layouts.push({ line: fit(line.slice(1)), edits: 1 })
  }
  return layouts
}

const fitFillers = (value: string, length: number) => {
  const content = restoreFillers(value).replace(/<+$/, '')
  return content.length <= length ? content.padEnd(length, '<') : value.slice(0, length)
}

/** Line 2 laid out to 30 characters; dates are anchored at the start and the composite digit at the end. */
function secondLayouts(raw: string): Layout[] {
  const layouts: Layout[] = []
  const anchored = (line: string) => line.slice(0, 18) + fitFillers(line.slice(18, -1), 11) + line.slice(-1)
  for (const line of spacings(raw)) {
    layouts.push({ line: fit(line), edits: line.length === 30 ? 0 : 1 })
    if (line.length !== 30 && line.length >= 24) layouts.push({ line: anchored(line), edits: 1 })
    if (line.length > 30 && !isDigitLike(line[0]) && isDigitLike(line[1]))
      layouts.push({ line: anchored(line.slice(1)), edits: 2 })
  }
  return layouts
}

// ---- decoding one laid-out zone -------------------------------------------------------------------------------

/** Document numbers are a short letter series then digits (D23145890, A12345678, AB1234567). */
const NUMBER_SHAPE = /^[A-Z]{0,3}[0-9]+<*$/

function conform(content: string, letters: number) {
  if (content.length <= letters || content.includes('<')) return null
  let value = ''
  let changes = 0
  for (let index = 0; index < content.length; index++) {
    const char = content[index]
    const wanted =
      index < letters ? (/[A-Z]/.test(char) ? char : LETTER_FOR[char]) : /[0-9]/.test(char) ? char : DIGIT_FOR[char]
    if (!wanted) return null
    if (wanted !== char) changes++
    value += wanted
  }
  return { value, changes }
}

/** At most this many look-alikes are undone in a document number (see resolveDocumentNumber). */
const MAX_NUMBER_CORRECTIONS = 1
/** A reading with another series length that passes with this many look-alikes or fewer makes the number ambiguous. */
const RIVAL_CHANGES = 2

/**
 * The document number may hold letters and digits, so look-alikes are only undone when the number as read breaks
 * the usual shape: one letter read after its digits started is read back as the digit it resembles. One, never two:
 * a single wrong mapping always breaks the check digit (the weights 7, 3 and 1 share no factor with 10), but two can
 * cancel out — B read for a real 3 and Z for a real 7 each move a digit by 5, and every weight is odd. That reading is
 * taken only when it passes the check digit and no reading with another series length passes too (with up to two
 * look-alikes: L/1 and G/6 at the edge of the series weigh the same and only the reader's guess tells them apart).
 * A number read in shape is kept as read: whether "AI2…" is "A12…" is exactly what the check digit cannot settle on
 * its own. A number with a letter after its digits that resembles no digit is not proved by anything.
 */
function resolveDocumentNumber(raw: string, check: string) {
  const asRead = { value: raw, holds: holds(raw, check), corrected: false, ambiguous: false }
  if (NUMBER_SHAPE.test(raw)) return asRead
  const content = raw.replace(/<+$/, '')
  const series = /^[A-Z]*/.exec(content)![0].length
  const unproved = { ...asRead, holds: false }
  // fillers only ever pad the end of a number
  if (content.includes('<')) return unproved
  const forced = series <= 3 ? conform(content, series) : null
  // a letter with no digit look-alike after the digits started (a 0 read as U weighs like 0 and passes by luck):
  // an unusual number, or no number — nothing proves it
  if (!forced || forced.changes > MAX_NUMBER_CORRECTIONS) return unproved
  const value = forced.value + raw.slice(content.length)
  if (!holds(value, check)) return unproved
  // at the edge of the series a letter and its digit can weigh the same (L and 1, G and 6): a reading with another
  // series length that passes as well leaves the number undecided, whichever of the two the OCR returned
  let rivals = 0
  for (let letters = 0; letters <= 3; letters++) {
    if (letters === series) continue
    const option = conform(content, letters)
    if (option && option.changes <= RIVAL_CHANGES && holds(option.value + raw.slice(content.length), check)) rivals++
  }
  if (rivals) return { ...unproved, ambiguous: true }
  return { value, holds: true, corrected: true, ambiguous: false }
}

/**
 * Look-alikes the check digit cannot tell apart (G/6, L/1, S/8, U/0 weigh the same mod 10) or that OCR confuses
 * folded into one class: two readings of one card fold to the same key. Meant for duplicate-card checks next to the
 * exact number, so a misread that passed the check digits by luck cannot register the same card twice.
 */
export function foldDocumentNumber(value: string) {
  const FOLD: Record<string, string> = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', Z: '2', S: '8', B: '8' }
  return value
    .toUpperCase()
    .replace(/<+$/, '')
    .replace(/[A-Z]/g, char => FOLD[char] ?? DIGIT_FOR[char] ?? char)
}

/** Optional data: fillers restored; a numeric field (e.g. the national number) may be read back as digits. */
function optionalReadings(raw: string) {
  const base = restoreFillers(raw)
  const readings = [{ value: base, changes: 0 }]
  const content = base.replace(/<+$/, '')
  const digits = (content.match(/[0-9]/g) || []).length
  if (content && digits >= 0.6 * content.length && content.length - digits <= 4) {
    const numeric = asDigits(content) + base.slice(content.length)
    if (numeric !== base) readings.push({ value: numeric, changes: 1 })
  }
  return readings
}

type Core = Omit<Td1, 'surname' | 'givenNames'> & { corrections: Td1Field[]; ambiguous: Td1Field[]; passed: number }

/** One laid-out zone (line 1 null when it was not read) decoded field by field. */
function decodeCore(first: string | null, l2: string, today: Date): Core {
  // without line 1 the composite digit proves nothing
  const lost = first === null
  const l1 = first ?? '<'.repeat(30)
  const corrections = new Set<Td1Field>()
  const ambiguous = new Set<Td1Field>()
  const changed = (field: Td1Field, before: string, after: string) => {
    if (before !== after) corrections.add(field)
  }

  const lead = /[1L]/.test(l1[0]) ? 'I' : l1[0]
  const documentCode = `${lead}${l1[1] === 'K' ? '<' : asLetters(l1[1])}`.replace(/<+$/, '')
  changed('documentCode', l1.slice(0, 2), `${lead}${l1[1]}`)
  const issuingState = snapIraq(asLetters(l1.slice(2, 5)))
  changed('issuingState', l1.slice(2, 5), issuingState)

  const documentCheck = asDigits(l1[14])
  // a number longer than 9 characters continues in the optional data, its check digit after it (ICAO 9303-5 4.2.2)
  const extended = l1[14] === '<' && /[A-Z0-9]/.test(l1[15])
  let number = { value: l1.slice(5, 14), holds: false, corrected: false, ambiguous: false }
  if (extended) {
    const tail = l1.slice(15).replace(/<.*$/, '')
    const full = `${l1.slice(5, 14)}${tail.slice(0, -1)}`
    number = { value: full, holds: holds(full, asDigits(tail.slice(-1))), corrected: false, ambiguous: false }
  } else {
    number = resolveDocumentNumber(l1.slice(5, 14), documentCheck)
    changed('documentNumber', l1[14], documentCheck)
  }
  if (number.corrected) corrections.add('documentNumber')
  if (number.ambiguous) ambiguous.add('documentNumber')

  const birth = asDigits(l2.slice(0, 6))
  const birthCheck = asDigits(l2[6])
  changed('birthDate', l2.slice(0, 7), `${birth}${birthCheck}`)
  const expiry = asDigits(l2.slice(8, 14))
  const expiryCheck = asDigits(l2[14])
  changed('expiryDate', l2.slice(8, 15), `${expiry}${expiryCheck}`)
  const nationality = snapIraq(asLetters(l2.slice(15, 18)))
  changed('nationality', l2.slice(15, 18), nationality)
  const compositeCheck = asDigits(l2[29])
  changed('composite', l2[29], compositeCheck)
  const sexChar = l2[7]

  const zoneNumber = extended ? l1.slice(5, 15) : `${number.value}${documentCheck}`
  const zone = (optional1: string, optional2: string) =>
    `${zoneNumber}${optional1}${birth}${birthCheck}${expiry}${expiryCheck}${optional2}`
  const options1 = extended ? [{ value: l1.slice(15, 30), changes: 0 }] : optionalReadings(l1.slice(15, 30))
  const options2 = optionalReadings(l2.slice(18, 29))
  let [optional1, optional2] = [options1[0], options2[0]]
  let composite = !lost && holds(zone(optional1.value, optional2.value), compositeCheck)
  if (!composite && !lost) {
    const passing = options1.flatMap(first =>
      options2
        .filter(second => holds(zone(first.value, second.value), compositeCheck))
        .map(second => ({ first, second, changes: first.changes + second.changes }))
    )
    const fewest = Math.min(...passing.map(item => item.changes))
    const best = passing.filter(item => item.changes === fewest)
    if (best.length === 1) {
      ;[optional1, optional2] = [best[0].first, best[0].second]
      composite = true
    } else if (best.length > 1) ambiguous.add('composite')
  }
  changed('optional1', l1.slice(15, 30), optional1.value)
  changed('optional2', l2.slice(18, 29), optional2.value)

  // a line laid out off by a character still has letters where the codes belong; digits or '<' there mean the
  // layout is wrong, and checks that pass on it pass by luck
  const firstAligned = !lost && /[IAC]/.test(lead) && /^[A-Z]{3}$/.test(issuingState)
  const secondAligned = /^[A-Z]{3}$/.test(nationality)
  const birthDate = mrzDate(birth, 'birth', today)
  const expiryDate = mrzDate(expiry, 'expiry', today)
  // a date that cannot be real passed its check digit by luck (two misreads that cancel out)
  const plausible = plausibleDates(birthDate, expiryDate, today)
  const checks = {
    documentNumber: firstAligned && number.holds,
    birthDate: dateHolds(birth, birthCheck) && plausible.birth,
    expiryDate: dateHolds(expiry, expiryCheck) && plausible.expiry,
    composite: firstAligned && secondAligned && composite,
  }
  const documentNumber = number.value.replace(/<+$/, '')
  return {
    documentCode,
    issuingState,
    documentNumber,
    optional1: optional1.value.replace(/<+$/, ''),
    birthDate,
    sex: sexChar === 'M' || sexChar === 'F' ? sexChar : null,
    expiryDate,
    nationality,
    optional2: optional2.value.replace(/<+$/, ''),
    checks,
    valid: Object.values(checks).every(Boolean) && /[A-Z0-9]/.test(documentNumber),
    corrections: [...corrections],
    ambiguous: [...ambiguous],
    passed: Object.values(checks).filter(Boolean).length,
  }
}

function decodeNames(raw: string | null) {
  if (raw === null) return { surname: '', givenNames: '', corrected: false, quality: 0 }
  const line = fit(nameLine(raw))
  let letters = restoreFillers(asLetters(line, NAME_LETTER_FOR))
  // no given names after the first '<<': its second '<' was lost or misread (as K, the usual OCR slip) — the
  // first single '<' is the separator then
  const firstRun = letters.indexOf('<<')
  if ((firstRun < 0 || !/[A-Z]/.test(letters.slice(firstRun))) && /^[A-Z]+<[A-Z]/.test(letters))
    letters = letters.replace(/^([A-Z]+)<K?/, '$1<<')
  const separator = letters.indexOf('<<')
  const surname = (separator < 0 ? letters : letters.slice(0, separator)).replace(/<+/g, ' ').trim()
  const givenNames =
    separator < 0
      ? ''
      : letters
          .slice(separator + 2)
          .replace(/^<+/, '')
          .split(/<{2,}/)[0]
          .replace(/<+/g, ' ')
          .trim()
  return {
    surname,
    givenNames,
    corrected: letters !== line,
    quality: separator > 0 && /[A-Z]{2}/.test(surname) ? 1 : 0,
  }
}

const outranks = (a: number[], b: number[]) => {
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] > b[index]
  return false
}

const identityOf = (zone: { documentNumber: string; birthDate: string | null; expiryDate: string | null }) =>
  `${zone.documentNumber}|${zone.birthDate}|${zone.expiryDate}`

/**
 * Finds and parses a TD1 zone in OCR text — or in several OCR readings of the same photo, whose lines are then
 * combined. Picks the line layout and look-alike readings that make the most check digits hold; null when no
 * plausible zone is there.
 *
 * Several readings are read one after another until one is valid, and every further reading is a fresh chance for
 * misreads to cancel out in the check digits — more so when lines of different readings are combined (line 1 of one,
 * line 2 of another). So once there is more than one reading, a valid zone also needs a second reading that on its
 * own gives the same number and dates (`unconfirmed` until then). A single reading needs no second one.
 */
export function parseTd1(text: string | readonly string[], today = new Date()): Td1 | null {
  const texts = typeof text === 'string' ? [text] : [...text]
  const read = readZone(texts, today)
  if (!read) return null
  const { core, names, edits, conflicting } = read
  const corrections = new Set(core.corrections)
  if (names.corrected) corrections.add('names')
  if (edits) corrections.add('layout')
  const ambiguous = new Set(core.ambiguous)
  if (conflicting) ambiguous.add('documentNumber')
  const confirmed =
    texts.length < 2 ||
    !core.valid ||
    texts.filter(item => {
      const single = readZone([item], today)
      return single !== null && identityOf(single.core) === identityOf(core)
    }).length >= 2
  return {
    documentCode: core.documentCode,
    issuingState: core.issuingState,
    documentNumber: core.documentNumber,
    optional1: core.optional1,
    birthDate: core.birthDate,
    sex: core.sex,
    expiryDate: core.expiryDate,
    nationality: core.nationality,
    optional2: core.optional2,
    surname: names.surname,
    givenNames: names.givenNames,
    checks: core.checks,
    valid: core.valid && !conflicting && confirmed,
    corrections: [...corrections],
    ambiguous: [...ambiguous],
    ...(confirmed ? {} : { unconfirmed: true }),
  }
}

function readZone(texts: string[], today: Date) {
  const candidates = texts.flatMap((item, source) => candidatesOf(item, source))
  const firsts = candidates.filter(candidate => candidate.first1 >= 0.4)
  const seconds = candidates.filter(candidate => candidate.second >= 0.45)
  const thirds = candidates.filter(candidate => candidate.third >= 0.35)
  const gap = (before: Candidate, after: Candidate) =>
    after.source === before.source && after.first > before.last ? after.first - before.last : Infinity
  // the zone's lines follow one another: a line further away is only tried when the next one does not look like
  // the zone at all (a stray line read in between) — stray text must not get a chance to pass the checks by luck
  const closest = (list: Candidate[], role: 'first1' | 'third', distance: (candidate: Candidate) => number) => {
    const near = list.filter(candidate => distance(candidate) <= 2)
    const adjacent = near.filter(candidate => distance(candidate) <= 1)
    return adjacent.some(candidate => candidate[role] >= 0.6) ? adjacent : near
  }
  const closeness = (distance: number) => (distance <= 1 ? 2 : 1)

  // [line 1, line 2, line 3, how well they hang together]
  const triples: Array<[Candidate | null, Candidate, Candidate | null, number]> = []
  for (const second of seconds) {
    const thirdsAfter = closest(thirds, 'third', third => gap(second, third))
    for (const first of closest(firsts, 'first1', first => gap(first, second))) {
      const together = closeness(gap(first, second))
      for (const third of thirdsAfter) triples.push([first, second, third, together + closeness(gap(second, third))])
      triples.push([first, second, null, together])
    }
    // line 1 lost: the dates and the name still help the citizen review their details
    if (second.second >= 0.7) for (const third of thirdsAfter) triples.push([null, second, third, 0])
  }
  if (texts.length > 1) {
    // several readings of one photo: the best line of each kind may come from different ones
    const top = (list: Candidate[], key: 'first1' | 'second' | 'third') =>
      list
        .filter(candidate => candidate[key] >= 0.7)
        .sort((a, b) => b[key] - a[key])
        .slice(0, 3)
    for (const first of top(firsts, 'first1'))
      for (const second of top(seconds, 'second'))
        for (const third of top(thirds, 'third')) triples.push([first, second, third, 0])
  }

  const cores = new Map<string, Core>()
  const validIdentities = new Set<string>()
  let best: { core: Core; names: ReturnType<typeof decodeNames>; rank: number[]; edits: number } | null = null
  for (const [first, second, third, together] of triples) {
    const names = decodeNames(third?.raw ?? null)
    const roles = (first?.first1 ?? 0) + second.second + (third?.third ?? 0)
    for (const l1 of first ? firstLayouts(first.raw) : [{ line: null, edits: 0 }])
      for (const l2 of secondLayouts(second.raw)) {
        const key = `${l1.line}${l2.line}`
        let core = cores.get(key)
        if (!core) cores.set(key, (core = decodeCore(l1.line, l2.line, today)))
        if (core.valid) validIdentities.add(identityOf(core))
        const edits = l1.edits + l2.edits
        const rank = [core.passed, core.valid ? 1 : 0, together, names.quality, roles, -edits]
        if (!best || outranks(rank, best.rank)) best = { core, names, rank, edits }
      }
  }
  if (!best) return null
  const { core, names, edits } = best
  // nothing proved and no dates either: stray text, not a zone
  if (!core.passed && !core.birthDate && !core.expiryDate) return null
  // two readings of the photo that each pass every check yet disagree: trust neither
  return { core, names, edits, conflicting: validIdentities.size > 1 }
}

/** Whether a parsed zone describes a valid, unexpired Iraqi identity card. */
export function iraqiCardProblems(td1: Td1 | null, today = new Date()) {
  if (!td1) return ['لم تُقرأ المنطقة المقروءة آلياً في ظهر البطاقة']
  const problems: string[] = []
  if (!td1.valid)
    problems.push(
      td1.unconfirmed
        ? 'قراءة المنطقة المقروءة آلياً لم تتأكد بقراءة ثانية'
        : 'أرقام التحقق في المنطقة المقروءة آلياً غير متطابقة'
    )
  if (td1.documentCode[0] !== 'I') problems.push('المستند ليس بطاقة هوية')
  if (td1.issuingState !== 'IRQ' || td1.nationality !== 'IRQ') problems.push('البطاقة ليست عراقية')
  if (!td1.expiryDate) problems.push('تاريخ انتهاء البطاقة غير مقروء')
  else if (Date.parse(td1.expiryDate) < today.getTime()) problems.push('البطاقة منتهية الصلاحية')
  if (!td1.birthDate) problems.push('تاريخ الميلاد غير مقروء')
  return problems
}
