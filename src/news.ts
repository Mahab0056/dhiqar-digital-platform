export type NewsItem = {
  title: string
  source: string
  sourceUrl: string
  image: string
  category: string
}

// Each card keeps its publisher/source link. Titles are not rewritten as government decisions.
export const dhiqarNews: NewsItem[] = [
  { title: 'متابعة ملفات محافظة ذي قار والخدمات المحلية', source: 'Iraqi News', sourceUrl: 'https://www.iraqinews.com/iraq/dhi-qar-recovers-20-billion-iqd-anti-graft-sweep-2026/', image: '/news/dhiqar-governorate.jpg', category: 'الحكومة المحلية' },
  { title: 'مشروع المدينة الجديدة في ذي قار وخدمات البنى التحتية', source: 'إذاعة وتلفزيون الناصرية', sourceUrl: 'https://nasiriyah.tv/', image: '/news/new-city.png', category: 'مشاريع' },
  { title: 'تطوير مصفى ذي قار وتحسين الأداء الإنتاجي', source: 'وكالة الأنباء العراقية', sourceUrl: 'https://ina.iq/', image: '/news/refinery.jpg', category: 'طاقة' },
  { title: 'مشاريع مياه لتعزيز الخدمة في سوق الشيوخ', source: 'شبكة أخبار الناصرية', sourceUrl: 'https://nasiriyah.org/', image: '/news/water-project.jpg', category: 'ماء' },
  { title: 'متابعة الواقع الخدمي في بلدية الناصرية', source: 'Shafaq News', sourceUrl: 'https://shafaq.com/', image: '/news/nasiriyah-municipality.webp', category: 'بلديات' },
  { title: 'حملة خدمية لتنظيف مركز المحافظة ورفع الأنقاض', source: 'شبكة أخبار الناصرية', sourceUrl: 'https://nasiriyah.org/', image: '/news/service-campaign.jpeg', category: 'خدمات' },
  { title: 'صيانة خطوط المجاري ومحطات الرفع في ذي قار', source: 'شبكة أخبار الناصرية', sourceUrl: 'https://nasiriyah.org/', image: '/news/sewerage-maintenance.jpeg', category: 'مجاري' },
  { title: 'دخول محطة الثورة الثانوية الخدمة لتعزيز التوزيع', source: 'وكالة موازين نيوز', sourceUrl: 'https://www.mawazin.net/', image: '/news/power-station.jpg', category: 'كهرباء' },
  { title: 'مشاريع البنى التحتية للمناطق السكنية في سوق الشيوخ', source: 'شبكة أخبار الناصرية', sourceUrl: 'https://nasiriyah.org/', image: '/news/souq-shuyoukh-project.jpg', category: 'مشاريع' },
  { title: 'متابعة معوقات مشاريع الصرف الصحي في المحافظة', source: 'شبكة أخبار الناصرية', sourceUrl: 'https://nasiriyah.org/', image: '/news/sewerage-director.jpeg', category: 'مجاري' },
]

export const officialProcurementLinks = [
  { title: 'إعلانات ومناقصات محافظة ذي قار', detail: 'الصفحة الرسمية للإعلانات والمناقصات المنشورة من المحافظة.', href: 'https://thiqar.gov.iq/%D8%A5%D8%B9%D9%84%D8%A7%D9%86%D8%A7%D8%AA-%D9%88%D9%85%D9%86%D8%A7%D9%82%D8%B5%D8%A7%D8%AA', source: 'محافظة ذي قار' },
  { title: 'الفرص الاستثمارية', detail: 'إعلانات هيئة استثمار ذي قار والخارطة الاستثمارية.', href: 'https://thiqarinvest.gov.iq/', source: 'هيئة استثمار ذي قار' },
  { title: 'الخدمات والإفادات الحكومية', detail: 'مسار الخدمات المنشور عبر محافظة ذي قار والبوابة الحكومية.', href: 'https://thiqar.gov.iq/%D8%A7%D9%84%D8%A5%D9%81%D8%A7%D8%AF%D8%A7%D8%AA-%D8%A7%D9%84%D8%AD%D9%83%D9%88%D9%85%D9%8A%D8%A9', source: 'محافظة ذي قار' },
]
