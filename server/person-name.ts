/**
 * Whether a string can be a person's full name as typed or read from an Iraqi ID/passport.
 * OCR of Arabic cards often drops letters and leaves fragments like «ار ا وا ل لحر اه ا»; a real name has at least two
 * words and no word shorter than two letters (Arabic or Latin letters only, plus spaces, hyphen and apostrophe).
 */
export function plausiblePersonName(value: string | null | undefined) {
  const name = (value || '').replace(/\s+/g, ' ').trim()
  if (name.length < 5 || name.length > 120) return false
  if (!/^[\p{Script=Arabic}A-Za-z' -]+$/u.test(name)) return false
  const words = name.split(' ').filter(Boolean)
  if (words.length < 2) return false
  // tatweel and diacritics don't count as letters
  return words.every(word => word.replace(/[ـً-ٟ'-]/g, '').length >= 2)
}
