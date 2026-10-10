/**
 * Population of Dhi Qar's districts (أقضية) from the Iraq general population census of 2024
 * (Central Statistical Organization). The 15 figures sum exactly to the governorate total that the
 * local government announced (2,499,468). A district missing here is shown as «غير متوفر» — never estimated.
 */
export type DistrictFact = { population: number; year: number; source: string; sourceUrl: string }

const CSO_2024 = {
  year: 2024,
  source: 'التعداد العام للسكان 2024 — الجهاز المركزي للإحصاء (كما نشرته شبكة الساعة، 2 كانون الأول 2025)',
  sourceUrl: 'https://alssaa.com/post/show/43032-iraq-2024-population-census-results-for-the-governorates',
}
const LOCAL_GOV_2024 = {
  year: 2024,
  source: 'التعداد العام للسكان 2024 — إعلان الحكومة المحلية في ذي قار (قناة الأهوار، 24 تشرين الثاني 2025)',
  sourceUrl:
    'https://alahwar-tv.com/news/%D8%B0%D9%8A-%D9%82%D8%A7%D8%B1-%D8%AA%D8%B9%D9%84%D9%86-%D8%B1%D8%B3%D9%85%D9%8A%D8%A7-%D8%AA%D8%AC%D8%A7%D9%88%D8%B2-%D9%86%D9%81%D9%88%D8%B3%D9%87%D8%A7-%D8%AD%D8%A7%D8%AC%D8%B2-%D8%A7%D9%84%D9%85%D9%84%D9%8A%D9%88%D9%86%D9%8A-%D9%88499-%D8%A3%D9%84%D9%81-%D9%86%D8%B3%D9%85%D8%A9-%D9%88%D9%81%D9%82-%D8%AA%D8%B9%D8%AF%D8%A7%D8%AF-2024',
}

export const GOVERNORATE_POPULATION_2024 = 2_499_468

export const DISTRICT_FACTS: Record<string, DistrictFact> = {
  الناصرية: { population: 789_847, ...CSO_2024 },
  الشطرة: { population: 292_930, ...CSO_2024 },
  'سوق الشيوخ': { population: 279_085, ...CSO_2024 },
  الرفاعي: { population: 194_946, ...CSO_2024 },
  الغراف: { population: 145_659, ...CSO_2024 },
  'قلعة سكر': { population: 124_104, ...CSO_2024 },
  النصر: { population: 113_587, ...CSO_2024 },
  'كرمة بني سعد': { population: 94_293, ...CSO_2024 },
  الدواية: { population: 90_742, ...CSO_2024 },
  الفجر: { population: 76_168, ...CSO_2024 },
  'سيد دخيل': { population: 72_891, ...CSO_2024 },
  الجبايش: { population: 63_204, ...CSO_2024 },
  الفهود: { population: 55_987, ...CSO_2024 },
  البطحاء: { population: 55_429, ...CSO_2024 },
  الإصلاح: { population: 50_596, ...LOCAL_GOV_2024 },
}

/** registry spellings / sub-district names → the district polygon they sit in */
const ALIASES: Record<string, string> = {
  أور: 'الناصرية',
  'سوق الشيخ': 'سوق الشيوخ',
  الاصلاح: 'الإصلاح',
  'قلعة سكّر': 'قلعة سكر',
  'كرمة بني سعيد': 'كرمة بني سعد',
}
export const districtKey = (name: string | null | undefined) => {
  const trimmed = (name || '').trim()
  return ALIASES[trimmed] || trimmed
}
