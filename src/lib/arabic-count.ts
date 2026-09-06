/**
 * Arabic counting with Western digits: 1 → "خدمة واحدة", 2 → "خدمتان", 3–10 → "3 خدمات", 11+ → "11 خدمة".
 * Pass the singular, dual and plural forms of the noun.
 */
export function arabicCount(
  count: number,
  forms: { one: string; two: string; few: string; many: string },
  options: { feminine?: boolean } = {}
) {
  const n = Math.max(0, Math.round(count))
  if (n === 0) return `لا ${forms.few}`
  if (n === 1) return `${forms.one} ${options.feminine === false ? 'واحد' : 'واحدة'}`
  if (n === 2) return forms.two
  const digits = n.toLocaleString('en-US')
  if (n >= 3 && n <= 10) return `${digits} ${forms.few}`
  return `${digits} ${forms.many}`
}

export const serviceCount = (count: number) =>
  arabicCount(count, { one: 'خدمة', two: 'خدمتان', few: 'خدمات', many: 'خدمة' })

export const documentCount = (count: number) =>
  arabicCount(count, { one: 'مستمسك', two: 'مستمسكان', few: 'مستمسكات', many: 'مستمسك' }, { feminine: false })

export const dayCount = (count: number) =>
  arabicCount(count, { one: 'يوم', two: 'يومان', few: 'أيام', many: 'يوماً' }, { feminine: false })

export const departmentCount = (count: number) =>
  arabicCount(count, { one: 'دائرة', two: 'دائرتان', few: 'دوائر', many: 'دائرة' })
