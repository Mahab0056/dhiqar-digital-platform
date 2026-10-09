/**
 * Machine-readable zone of the Iraqi unified national ID card (back side): ICAO 9303 TD1 — three lines of 30
 * characters. OCR of this zone is far more reliable than of the Arabic front, and its check digits tell a correct
 * read (and an unaltered card) from a misread one.
 *
 *   line 1: I<IRQ  document number (9) + check  optional data (15)
 *   line 2: birth date YYMMDD + check, sex, expiry YYMMDD + check, nationality (3), optional (11), composite check
 *   line 3: SURNAME<<GIVEN<NAMES
 */
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
}

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
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

// OCR confusions inside fields that can only hold digits
const toDigits = (value: string) =>
  value
    .replace(/O|Q|D/g, '0')
    .replace(/I|L/g, '1')
    .replace(/Z/g, '2')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/G/g, '6')

/** Cleans raw OCR text into candidate MRZ lines (uppercase, no spaces, « and similar read as <). */
export function mrzCandidateLines(text: string) {
  return text
    .toUpperCase()
    .replace(/[«‹＜]/g, '<')
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, ''))
    .filter(line => line.length >= 26 && (line.match(/</g) || []).length >= 2)
}

/** Finds and parses a TD1 zone in OCR text; null when three plausible lines are not there. */
export function parseTd1(text: string, today = new Date()): Td1 | null {
  const lines = mrzCandidateLines(text).map(line => line.padEnd(30, '<').slice(0, 30))
  for (let index = 0; index + 2 < lines.length; index++) {
    const [l1, l2, l3] = lines.slice(index, index + 3)
    if (!/^[IAC]/.test(l1)) continue
    const documentNumber = l1.slice(5, 14)
    const documentCheck = toDigits(l1[14])
    const birth = toDigits(l2.slice(0, 6))
    const birthCheck = toDigits(l2[6])
    const sexChar = l2[7]
    const expiry = toDigits(l2.slice(8, 14))
    const expiryCheck = toDigits(l2[14])
    const compositeCheck = toDigits(l2[29])
    const composite = `${l1.slice(5, 30)}${birth}${birthCheck}${expiry}${expiryCheck}${l2.slice(18, 29)}`
    const checks = {
      documentNumber: holds(documentNumber, documentCheck),
      birthDate: holds(birth, birthCheck),
      expiryDate: holds(expiry, expiryCheck),
      composite: holds(composite, compositeCheck),
    }
    const [surname = '', given = ''] = l3.split('<<')
    return {
      documentCode: l1.slice(0, 2).replace(/<+$/, ''),
      issuingState: l1.slice(2, 5),
      documentNumber: documentNumber.replace(/<+$/, ''),
      optional1: l1.slice(15, 30).replace(/<+$/, ''),
      birthDate: mrzDate(birth, 'birth', today),
      sex: sexChar === 'M' || sexChar === 'F' ? sexChar : null,
      expiryDate: mrzDate(expiry, 'expiry', today),
      nationality: l2.slice(15, 18),
      optional2: l2.slice(18, 29).replace(/<+$/, ''),
      surname: surname.replace(/<+/g, ' ').trim(),
      givenNames: given.replace(/<+/g, ' ').trim(),
      checks,
      valid: Object.values(checks).every(Boolean),
    }
  }
  return null
}

/** Whether a parsed zone describes a valid, unexpired Iraqi identity card. */
export function iraqiCardProblems(td1: Td1 | null, today = new Date()) {
  if (!td1) return ['لم تُقرأ المنطقة المقروءة آلياً في ظهر البطاقة']
  const problems: string[] = []
  if (!td1.valid) problems.push('أرقام التحقق في المنطقة المقروءة آلياً غير متطابقة')
  if (td1.documentCode[0] !== 'I') problems.push('المستند ليس بطاقة هوية')
  if (td1.issuingState !== 'IRQ' || td1.nationality !== 'IRQ') problems.push('البطاقة ليست عراقية')
  if (!td1.expiryDate) problems.push('تاريخ انتهاء البطاقة غير مقروء')
  else if (Date.parse(td1.expiryDate) < today.getTime()) problems.push('البطاقة منتهية الصلاحية')
  if (!td1.birthDate) problems.push('تاريخ الميلاد غير مقروء')
  return problems
}
