export type GovernmentEntityType =
  'LOCAL_GOVERNMENT' | 'FEDERAL_GOVERNMENT' | 'INDEPENDENT_AUTHORITY' | 'PUBLIC_SERVICE_ENTITY'
export type DirectoryVerification = 'VERIFIED_SOURCE' | 'DRAFT_NEEDS_VERIFICATION'
export type DigitalAvailability = 'FULLY_DIGITAL' | 'PARTIALLY_DIGITAL' | 'INFORMATION_ONLY' | 'EXTERNAL_INTEGRATION'

export type DirectoryService = {
  name: string
  description: string
  availability: DigitalAvailability
  serviceKey?: string
  keywords: string[]
}

export type GovernmentEntity = {
  id: string
  name: string
  nameEn: string
  type: GovernmentEntityType
  parentAuthority: string
  district: string
  sourceUrl: string
  verification: DirectoryVerification
  integrationStatus: 'LOCAL_WORKFLOW' | 'OFFICIAL_LINK' | 'AWAITING_OFFICIAL_INTEGRATION' | 'AWAITING_SERVICE_DATA'
  gisStatus: 'COORDINATES_VERIFIED' | 'AWAITING_OFFICIAL_COORDINATES'
  summary: string
  services: DirectoryService[]
}

const localWorkflow = 'LOCAL_WORKFLOW' as const
const officialLink = 'OFFICIAL_LINK' as const
const awaiting = 'AWAITING_OFFICIAL_INTEGRATION' as const
const draft = 'DRAFT_NEEDS_VERIFICATION' as const
const verified = 'VERIFIED_SOURCE' as const

export const governmentEntities: GovernmentEntity[] = [
  {
    id: 'dhiqar-governorate',
    name: 'ديوان محافظة ذي قار',
    nameEn: 'Dhi Qar Governorate Office',
    type: 'LOCAL_GOVERNMENT',
    parentAuthority: 'الحكومة المحلية لمحافظة ذي قار',
    district: 'الناصرية',
    sourceUrl: 'https://ur.gov.iq/index/all-orgs/',
    verification: verified,
    integrationStatus: localWorkflow,
    gisStatus: 'COORDINATES_VERIFIED',
    summary: 'بوابة للطلبات والمخاطبات والشكاوى والمواعيد ضمن الخدمات المحلية المسجلة في المنصة.',
    services: [
      {
        name: 'طلبات ومخاطبات المواطنين',
        description: 'تقديم طلب إداري أو طلب معلومات وتحويله إلى القسم المختص.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'governorate-service',
        keywords: ['ديوان', 'محافظ', 'كتاب', 'مخاطبة', 'مقابلة'],
      },
      {
        name: 'متابعة طلب سابق',
        description: 'متابعة الطلبات المحلية المسجلة عبر حساب المواطن.',
        availability: 'FULLY_DIGITAL',
        serviceKey: 'governorate-service',
        keywords: ['تابع', 'معاملة', 'كتاب', 'إحالة'],
      },
      {
        name: 'متابعة طلب قطعة أرض',
        description: 'تسجيل برنامج التقديم أو الرقم السابق لتحويل الطلب إلى قسم الأملاك والمتابعة.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'land-request',
        keywords: ['أرض', 'قطعة أرض', 'تخصيص', 'سكن', 'عقار'],
      },
      {
        name: 'شكوى أو مقترح',
        description: 'قناة ملاحظات وشكاوى مستقلة مع رقم متابعة.',
        availability: 'FULLY_DIGITAL',
        serviceKey: 'water-complaint',
        keywords: ['شكوى', 'مقترح', 'ملاحظة'],
      },
    ],
  },
  {
    id: 'dhiqar-municipalities',
    name: 'مديرية بلديات ذي قار',
    nameEn: 'Dhi Qar Municipalities Directorate',
    type: 'LOCAL_GOVERNMENT',
    parentAuthority: 'وزارة الإعمار والإسكان والبلديات والأشغال العامة',
    district: 'الناصرية',
    sourceUrl: 'https://nasiriyah-municipality.gov.iq/',
    verification: verified,
    integrationStatus: localWorkflow,
    gisStatus: 'COORDINATES_VERIFIED',
    summary: 'خدمات بلدية أولية وإحالة للمراجعة ضمن المنصة، مع بقاء الرسوم والإجراءات النهائية بقرار الجهة.',
    services: [
      {
        name: 'إجازة فتح محل',
        description: 'طلب محل تجاري مع مرفقات وموقع ومراجعة موظف.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'store-license',
        keywords: ['محل', 'مطعم', 'تجاري', 'إجازة'],
      },
      {
        name: 'إجازة بناء',
        description: 'بيانات العقار والمشروع للتدقيق الهندسي والكشف الموقعي.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'building-permit',
        keywords: ['بناء', 'بيت', 'مخطط', 'ترميم'],
      },
      {
        name: 'خدمات بلدية عامة',
        description: 'طلب صيانة أو نظافة أو استفسار بلدي مع إحالة للشعبة المختصة.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'municipality-service',
        keywords: ['نفايات', 'شارع', 'رصيف', 'إنارة', 'بلدية', 'أنقاض'],
      },
    ],
  },
  {
    id: 'nasiriyah-municipality',
    name: 'مديرية بلدية الناصرية',
    nameEn: 'Nasiriyah Municipality Directorate',
    type: 'LOCAL_GOVERNMENT',
    parentAuthority: 'مديرية بلديات ذي قار',
    district: 'الناصرية',
    sourceUrl: 'https://nasiriyah-municipality.gov.iq/',
    verification: verified,
    integrationStatus: officialLink,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary:
      'دليل الجهة ومصدر منشور لخدمات الأقسام والإيجارات وتنظيم المدن؛ لا تتطابق تفاصيلها تلقائياً مع البلديات الأخرى.',
    services: [
      {
        name: 'دليل أقسام البلدية',
        description: 'معلومات إرشادية عن الخدمات والأقسام المنشورة من الجهة.',
        availability: 'INFORMATION_ONLY',
        keywords: ['بلدية الناصرية', 'أملاك', 'إيجارات', 'تنظيم المدن'],
      },
      {
        name: 'خدمات بلدية عامة',
        description: 'ابدأ طلباً داخل المنصة ليحال بحسب موقع الخدمة والاختصاص.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'municipality-service',
        keywords: ['بلدية', 'خدمة', 'صيانة'],
      },
    ],
  },
  {
    id: 'dhiqar-water',
    name: 'مديرية ماء ذي قار',
    nameEn: 'Dhi Qar Water Directorate',
    type: 'PUBLIC_SERVICE_ENTITY',
    parentAuthority: 'وزارة الإعمار والإسكان والبلديات والأشغال العامة',
    district: 'الناصرية',
    sourceUrl: 'https://gdw.moch.gov.iq/',
    verification: verified,
    integrationStatus: localWorkflow,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'بلاغات الماء ضمن المنصة، وأي استعلام أو دفع يحتاج تكامل الجهة الرسمية.',
    services: [
      {
        name: 'بلاغ ماء أو مجارٍ',
        description: 'بلاغ انقطاع أو كسر أو تسرب مع العنوان والتفاصيل.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'water-complaint',
        keywords: ['مي', 'ماء', 'مقطوعة', 'ضعف', 'أنبوب', 'تسرب'],
      },
      {
        name: 'طلب اشتراك أو ربط ماء',
        description: 'معلومة خدمة بانتظار نشر الإجراء والتكامل الرسمي.',
        availability: 'INFORMATION_ONLY',
        keywords: ['اشتراك ماء', 'ربط ماء', 'عداد ماء'],
      },
    ],
  },
  {
    id: 'dhiqar-sewerage',
    name: 'مديرية مجاري ذي قار',
    nameEn: 'Dhi Qar Sewerage Directorate',
    type: 'PUBLIC_SERVICE_ENTITY',
    parentAuthority: 'وزارة الإعمار والإسكان والبلديات والأشغال العامة',
    district: 'الناصرية',
    sourceUrl: 'https://moch.gov.iq/',
    verification: verified,
    integrationStatus: localWorkflow,
    gisStatus: 'COORDINATES_VERIFIED',
    summary: 'قناة بلاغات مجارٍ وموقع للمشكلة، على أن تحدد الجهة الإجراء الميداني والمدة.',
    services: [
      {
        name: 'بلاغ مجارٍ أو طفح',
        description: 'إرسال بلاغ مع موقع ووصف المشكلة وتحويله للمراجعة.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'sewerage-service',
        keywords: ['مجاري', 'طفح', 'منهول', 'انسداد', 'مياه أمطار'],
      },
    ],
  },
  {
    id: 'dhiqar-electricity',
    name: 'فرع توزيع كهرباء ذي قار',
    nameEn: 'Dhi Qar Electricity Distribution Branch',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة الكهرباء',
    district: 'الناصرية',
    sourceUrl: 'https://moelc.gov.iq/',
    verification: verified,
    integrationStatus: localWorkflow,
    gisStatus: 'COORDINATES_VERIFIED',
    summary: 'طلبات وبلاغات غير طارئة مع موقعها؛ الأعطال الخطرة توجه فوراً إلى قناة الطوارئ الرسمية.',
    services: [
      {
        name: 'خدمات الكهرباء',
        description: 'بلاغ تجهيز أو عداد أو إنارة أو كشف فني بحسب الموقع.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'electricity-service',
        keywords: ['كهرباء', 'محولة', 'عمود', 'أسلاك', 'عداد', 'قطع'],
      },
      {
        name: 'بلاغ خطر كهربائي',
        description: 'لا يستبدل الاستجابة الطارئة؛ استخدم القنوات الرسمية العاجلة عند وجود خطر مباشر.',
        availability: 'INFORMATION_ONLY',
        keywords: ['خطر كهرباء', 'سلك ساقط', 'حريق'],
      },
    ],
  },
  {
    id: 'dhiqar-roads',
    name: 'مديرية طرق وجسور ذي قار',
    nameEn: 'Dhi Qar Roads and Bridges Directorate',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة الإعمار والإسكان والبلديات والأشغال العامة',
    district: 'الناصرية',
    sourceUrl: 'https://turruqjissor.moch.gov.iq/',
    verification: verified,
    integrationStatus: awaiting,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'دليل لخدمات الطرق والجسور؛ تحديد جهة الاختصاص للطريق يحتاج موقعاً ومصدراً معتمداً.',
    services: [
      {
        name: 'الإبلاغ عن طريق أو جسر متضرر',
        description: 'مسار معلوماتي بانتظار ربط رسمي للبلاغات وتحديد جهة الاختصاص.',
        availability: 'INFORMATION_ONLY',
        keywords: ['حفرة', 'طريق', 'جسر', 'عائق', 'علامة طريق'],
      },
    ],
  },
  {
    id: 'dhiqar-health',
    name: 'دائرة صحة ذي قار',
    nameEn: 'Dhi Qar Health Directorate',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة الصحة',
    district: 'الناصرية',
    sourceUrl: 'https://thiqar.moh.gov.iq/',
    verification: verified,
    integrationStatus: localWorkflow,
    gisStatus: 'COORDINATES_VERIFIED',
    summary:
      'طلبات إدارية غير طارئة وشكاوى معلوماتية؛ لا تقدم المنصة تشخيصاً أو حجزاً طبياً باسم الدائرة بلا تكامل مخول.',
    services: [
      {
        name: 'خدمات صحة ذي قار',
        description: 'طلب معلومات أو خدمة إدارية أو شكوى غير طارئة مع إحالة للمراجعة.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'health-service',
        keywords: ['صحة', 'مستشفى', 'مركز صحي', 'موعد', 'وثيقة صحية'],
      },
    ],
  },
  {
    id: 'dhiqar-education',
    name: 'المديرية العامة لتربية ذي قار',
    nameEn: 'Dhi Qar General Directorate of Education',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة التربية',
    district: 'الناصرية',
    sourceUrl: 'https://ur.gov.iq/index/all-orgs/',
    verification: draft,
    integrationStatus: localWorkflow,
    gisStatus: 'COORDINATES_VERIFIED',
    summary: 'طلبات واستفسارات مدرسية أولية؛ إجراءات النتائج والنقل والتأييدات تخضع للمنظومات والتعليمات الرسمية.',
    services: [
      {
        name: 'خدمات تربية ذي قار',
        description: 'طلب أو استفسار مدرسي يحال للشعبة المختصة.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'education-service',
        keywords: ['مدرسة', 'طالب', 'نقل', 'تربية', 'تأييد'],
      },
    ],
  },
  {
    id: 'university-of-thiqar',
    name: 'جامعة ذي قار',
    nameEn: 'University of Thi-Qar',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة التعليم العالي والبحث العلمي',
    district: 'الناصرية',
    sourceUrl: 'https://utq.edu.iq/',
    verification: verified,
    integrationStatus: officialLink,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'دليل خدمات التعليم العالي وروابط الجهة؛ لا تتبع الجامعة للحكومة المحلية إدارياً.',
    services: [
      {
        name: 'الخدمات الإلكترونية العامة',
        description: 'الانتقال إلى ما تنشره الجامعة من خدمات وتعليمات.',
        availability: 'EXTERNAL_INTEGRATION',
        keywords: ['جامعة', 'كلية', 'دراسة', 'طالب جامعي'],
      },
    ],
  },
  {
    id: 'university-of-sumer',
    name: 'جامعة سومر',
    nameEn: 'University of Sumer',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة التعليم العالي والبحث العلمي',
    district: 'الرفاعي',
    sourceUrl: 'https://www.uos.edu.iq/',
    verification: draft,
    integrationStatus: officialLink,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'جهة تعليم عالٍ اتحادية تظهر في الدليل بوصفها مساراً خارجياً حتى توثيق بيانات الخدمات المحلية.',
    services: [
      {
        name: 'الخدمات الإلكترونية العامة',
        description: 'انتقال إلى البوابة الرسمية للجامعة عند الحاجة.',
        availability: 'EXTERNAL_INTEGRATION',
        keywords: ['جامعة سومر', 'كلية', 'دراسة'],
      },
    ],
  },
  {
    id: 'dhiqar-agriculture',
    name: 'مديرية زراعة ذي قار',
    nameEn: 'Dhi Qar Agriculture Directorate',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة الزراعة',
    district: 'الناصرية',
    sourceUrl: 'https://zeraa.gov.iq/',
    verification: verified,
    integrationStatus: localWorkflow,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'تقديم طلب أو استفسار زراعي أولي؛ الاستحقاق والدعم والمستلزمات تحددها الجهة الرسمية فقط.',
    services: [
      {
        name: 'خدمات الزراعة',
        description: 'استفسار أو طلب خدمة أو شكوى زراعية يحال للشعبة المختصة.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'agriculture-service',
        keywords: ['زراعة', 'فلاح', 'بذور', 'أسمدة', 'مزرعة', 'دواجن'],
      },
    ],
  },
  {
    id: 'dhiqar-water-resources',
    name: 'مديرية الموارد المائية في ذي قار',
    nameEn: 'Dhi Qar Water Resources Directorate',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة الموارد المائية',
    district: 'الناصرية',
    sourceUrl: 'https://mowr.gov.iq/',
    verification: verified,
    integrationStatus: awaiting,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'خدمات الموارد المائية تحتاج متطلبات وإحداثيات ووثائق تحددها الجهة أو بوابة أور لكل معاملة.',
    services: [
      {
        name: 'بلاغ قناة أو مجرى مائي',
        description: 'مسار معلوماتي بانتظار اعتماد خدمات الإبلاغ وتحديد الاختصاص محلياً.',
        availability: 'INFORMATION_ONLY',
        keywords: ['نهر', 'قناة', 'مورد مائي', 'حصص مائية', 'تجاوز مائي'],
      },
    ],
  },
  {
    id: 'dhiqar-environment',
    name: 'مديرية بيئة ذي قار',
    nameEn: 'Dhi Qar Environment Directorate',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة البيئة',
    district: 'الناصرية',
    sourceUrl: 'https://moen.gov.iq/ar/citizens-affairs-service-centers-1',
    verification: verified,
    integrationStatus: localWorkflow,
    gisStatus: 'COORDINATES_VERIFIED',
    summary: 'بلاغات بيئية أولية؛ الموافقات الفنية والكشف الميداني تخضع لإجراءات الجهة.',
    services: [
      {
        name: 'خدمات البيئة',
        description: 'بلاغ تلوث أو استفسار أو طلب كشف بيئي مع موقع ووصف.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'environment-service',
        keywords: ['بيئة', 'تلوث', 'حرق نفايات', 'هواء', 'مياه ملوثة'],
      },
    ],
  },
  {
    id: 'dhiqar-planning',
    name: 'مديرية تخطيط ذي قار',
    nameEn: 'Dhi Qar Planning Directorate',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة التخطيط',
    district: 'الناصرية',
    sourceUrl: 'https://mop.gov.iq/',
    verification: verified,
    integrationStatus: localWorkflow,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'طلبات معلومات ومخاطبات أولية ضمن المنصة، مع بقاء البيانات الرسمية والكتب النهائية وفق إجراءات المديرية.',
    services: [
      {
        name: 'خدمات التخطيط',
        description: 'طلب بيانات أو مخاطبة أو استفسار عن مشروع يحال للشعبة المختصة.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'planning-service',
        keywords: ['تخطيط', 'إحصاء', 'بيانات', 'مشروع', 'مخاطبة'],
      },
    ],
  },
  {
    id: 'citizen-service-center',
    name: 'مركز خدمة المواطن',
    nameEn: 'Citizen Service Center',
    type: 'LOCAL_GOVERNMENT',
    parentAuthority: 'ديوان محافظة ذي قار',
    district: 'الناصرية',
    sourceUrl: 'https://ur.gov.iq/index/all-orgs/',
    verification: draft,
    integrationStatus: localWorkflow,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'مسار طلب موعد محلي. تأكيد الموعد مرتبط بمراجعة الدائرة المختارة ولا يعني حجزاً في نظام وطني خارجي.',
    services: [
      {
        name: 'حجز موعد أونلاين',
        description: 'اختيار الدائرة والغرض والوقت المقترح، ثم متابعة تأكيد الموعد من الحساب.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'online-appointment',
        keywords: ['موعد', 'حجز', 'زيارة', 'مراجعة دائرة'],
      },
    ],
  },
  {
    id: 'dhiqar-investment',
    name: 'هيئة استثمار ذي قار',
    nameEn: 'Dhi Qar Investment Commission',
    type: 'INDEPENDENT_AUTHORITY',
    parentAuthority: 'هيئة استثمار ذي قار',
    district: 'الناصرية',
    sourceUrl: 'https://thiqarinvest.gov.iq/',
    verification: verified,
    integrationStatus: localWorkflow,
    gisStatus: 'COORDINATES_VERIFIED',
    summary:
      'مسار للمستثمرين للاستفسار وطلب مقابلة أو عرض فكرة مشروع، مع بقاء الإجازات والموافقات النهائية ضمن نافذة الجهة.',
    services: [
      {
        name: 'خدمات الاستثمار',
        description: 'استفسار فرصة أو طلب مقابلة أو ملخص فكرة استثمارية.',
        availability: 'PARTIALLY_DIGITAL',
        serviceKey: 'investment-service',
        keywords: ['استثمار', 'مشروع', 'فرصة استثمارية', 'مستثمر', 'إجازة استثمار'],
      },
      {
        name: 'دليل المستثمر والفرص',
        description: 'الرجوع إلى الموقع الرسمي للهيئة للفرص والإعلانات المنشورة.',
        availability: 'EXTERNAL_INTEGRATION',
        keywords: ['خارطة استثمارية', 'نافذة واحدة', 'فرص'],
      },
    ],
  },
  {
    id: 'dhiqar-labor-social',
    name: 'العمل والحماية الاجتماعية في ذي قار',
    nameEn: 'Labour and Social Protection in Dhi Qar',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة العمل والشؤون الاجتماعية',
    district: 'الناصرية',
    sourceUrl: 'https://molsa.gov.iq/',
    verification: verified,
    integrationStatus: officialLink,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'دليل إلى المنصات الرسمية للعمل والحماية؛ لا يجري تقييم شمول المواطن أو أهليته داخل المنصة.',
    services: [
      {
        name: 'خدمات الباحثين عن عمل والرعاية',
        description: 'مسار خارجي إلى ما يتوفر رسمياً من خدمات العمل والحماية الاجتماعية.',
        availability: 'EXTERNAL_INTEGRATION',
        keywords: ['عمل', 'وظيفة', 'قرض', 'رعاية اجتماعية', 'إعاقة'],
      },
    ],
  },
  {
    id: 'dhiqar-youth-sports',
    name: 'مديرية شباب ورياضة ذي قار',
    nameEn: 'Dhi Qar Youth and Sports Directorate',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة الشباب والرياضة',
    district: 'الناصرية',
    sourceUrl: 'https://moys.gov.iq/',
    verification: draft,
    integrationStatus: awaiting,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'دليل منشآت وأنشطة ومبادرات محتمل؛ تظهر التفاصيل عند اعتمادها من الجهة.',
    services: [
      {
        name: 'المنشآت والبرامج الشبابية',
        description: 'معلومات خدمة بانتظار توثيق المنشآت والحجوزات الرسمية.',
        availability: 'INFORMATION_ONLY',
        keywords: ['شباب', 'رياضة', 'ملعب', 'منتدى', 'مبادرة'],
      },
    ],
  },
  {
    id: 'dhiqar-traffic',
    name: 'مديرية مرور ذي قار',
    nameEn: 'Dhi Qar Traffic Directorate',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة الداخلية العراقية',
    district: 'الناصرية',
    sourceUrl: 'https://itp.gov.iq/',
    verification: verified,
    integrationStatus: officialLink,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'دليل للمرور ضمن مسارات وزارة الداخلية؛ لا تنشئ المنصة غرامات أو حجوزات أو إجازات بديلة.',
    services: [
      {
        name: 'إجازة السياقة',
        description: 'انتقال منظم إلى التعليمات والحجز الرسمي المتاح.',
        availability: 'EXTERNAL_INTEGRATION',
        serviceKey: 'driving-license',
        keywords: ['سياقة', 'مرور', 'سيارة', 'غرامة'],
      },
    ],
  },
  {
    id: 'dhiqar-national-id',
    name: 'مديرية الجنسية والمعلومات المدنية في ذي قار',
    nameEn: 'Dhi Qar National ID Directorate',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة الداخلية العراقية',
    district: 'الناصرية',
    sourceUrl: 'https://www.nid-moi.gov.iq/',
    verification: verified,
    integrationStatus: officialLink,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'الحجز وإصدار البطاقة الوطنية يتمان ضمن المنظومة الوطنية المخولة فقط.',
    services: [
      {
        name: 'البطاقة الوطنية الموحدة',
        description: 'انتقال إلى مسار الحجز والتعليمات الرسمي.',
        availability: 'EXTERNAL_INTEGRATION',
        serviceKey: 'national-id',
        keywords: ['بطاقة وطنية', 'هوية وطنية', 'بطاقة موحدة'],
      },
    ],
  },
  {
    id: 'dhiqar-passports',
    name: 'الجوازات والإقامة في ذي قار',
    nameEn: 'Dhi Qar Passports and Residency',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة الداخلية العراقية',
    district: 'الناصرية',
    sourceUrl: 'https://epp.iq/',
    verification: verified,
    integrationStatus: officialLink,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'الحجز وإصدار الجواز يتمان في النظام الوطني؛ الدليل لا ينشئ رقم حجز موازياً.',
    services: [
      {
        name: 'الجواز الإلكتروني العراقي',
        description: 'انتقال إلى الحجز الرسمي وتعليمات الجواز.',
        availability: 'EXTERNAL_INTEGRATION',
        serviceKey: 'e-passport',
        keywords: ['جواز', 'سفر', 'إقامة'],
      },
    ],
  },
  {
    id: 'dhiqar-civil-defense',
    name: 'مديرية الدفاع المدني في ذي قار',
    nameEn: 'Dhi Qar Civil Defense Directorate',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة الداخلية العراقية',
    district: 'الناصرية',
    sourceUrl: 'https://www.moi.gov.iq/',
    verification: draft,
    integrationStatus: awaiting,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'متطلبات السلامة والكشوفات تحتاج ربطاً مع الجهة؛ الطوارئ لا تعالج عبر نموذج عادي.',
    services: [
      {
        name: 'دليل السلامة وطلبات الكشف',
        description: 'معلومات خدمة بانتظار اعتماد بيانات الجهة. في الطوارئ اتصل بالقنوات الرسمية فوراً.',
        availability: 'INFORMATION_ONLY',
        keywords: ['دفاع مدني', 'حريق', 'سلامة', 'كشف'],
      },
    ],
  },
  {
    id: 'dhiqar-police',
    name: 'قيادة شرطة محافظة ذي قار',
    nameEn: 'Dhi Qar Police Command',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة الداخلية العراقية',
    district: 'الناصرية',
    sourceUrl: 'https://www.moi.gov.iq/',
    verification: draft,
    integrationStatus: awaiting,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'دليل إرشادي للخدمات الإدارية فقط؛ المنصة ليست بديلاً عن قنوات الطوارئ.',
    services: [
      {
        name: 'الخدمات الإدارية والاستفسارات',
        description: 'معلومات بانتظار تأكيد الخدمات الرقمية المحلية. الحالات الطارئة تتجه للقنوات الرسمية.',
        availability: 'INFORMATION_ONLY',
        keywords: ['شرطة', 'طوارئ', 'مركز شرطة'],
      },
    ],
  },
  {
    id: 'dhiqar-justice',
    name: 'خدمات العدل في ذي قار',
    nameEn: 'Justice Services in Dhi Qar',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة العدل',
    district: 'الناصرية',
    sourceUrl: 'https://moj.gov.iq/',
    verification: verified,
    integrationStatus: officialLink,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'يشمل الدليل التسجيل العقاري والكاتب العدل حسب ما تنشره وزارة العدل والمنظومات المخولة.',
    services: [
      {
        name: 'دليل التسجيل العقاري والكاتب العدل',
        description: 'تعليمات ومواعيد وخدمات إلكترونية عند توافرها رسمياً فقط.',
        availability: 'EXTERNAL_INTEGRATION',
        keywords: ['عقار', 'سند', 'كاتب عدل', 'ملكية'],
      },
    ],
  },
  {
    id: 'dhiqar-finance',
    name: 'خدمات المالية في ذي قار',
    nameEn: 'Finance Services in Dhi Qar',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة المالية',
    district: 'الناصرية',
    sourceUrl: 'https://mof.gov.iq/',
    verification: verified,
    integrationStatus: officialLink,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'دليل لخدمات الضرائب والتقاعد وعقارات الدولة؛ لا تعرض البيانات المالية أو العقارية الحساسة داخل المنصة.',
    services: [
      {
        name: 'الضرائب والتقاعد وعقارات الدولة',
        description: 'الانتقال للخدمة أو التعليمات الرسمية عند توفر الربط.',
        availability: 'EXTERNAL_INTEGRATION',
        keywords: ['ضريبة', 'تقاعد', 'عقارات دولة', 'براءة'],
      },
    ],
  },
  {
    id: 'martyrs-foundation',
    name: 'مؤسسة الشهداء — مديرية ذي قار',
    nameEn: 'Martyrs Foundation — Dhi Qar',
    type: 'INDEPENDENT_AUTHORITY',
    parentAuthority: 'مؤسسة الشهداء',
    district: 'الناصرية',
    sourceUrl: 'https://alshuhadaa.gov.iq/',
    verification: verified,
    integrationStatus: officialLink,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'خدمات المشمولين والمواعيد والمتابعة حصراً وفق ما تتيحه المؤسسة رسمياً.',
    services: [
      {
        name: 'دليل خدمات مؤسسة الشهداء',
        description: 'انتقال للخدمات الرقمية والتعليمات المعتمدة للمؤسسة.',
        availability: 'EXTERNAL_INTEGRATION',
        keywords: ['شهداء', 'ذوي الشهداء', 'مشمولين'],
      },
    ],
  },
  {
    id: 'political-prisoners',
    name: 'مؤسسة السجناء السياسيين',
    nameEn: 'Political Prisoners Foundation',
    type: 'INDEPENDENT_AUTHORITY',
    parentAuthority: 'مؤسسة السجناء السياسيين',
    district: 'الناصرية',
    sourceUrl: 'https://ur.gov.iq/index/all-orgs/',
    verification: verified,
    integrationStatus: awaiting,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'دليل للمسارات الرسمية الخاصة بالمشمولين؛ تفاصيل الخدمات المحلية بانتظار مصدر الجهة.',
    services: [
      {
        name: 'خدمات المشمولين',
        description: 'معلومات ومسارات خارجية بانتظار اعتماد خدمة أو تكامل رسمي.',
        availability: 'INFORMATION_ONLY',
        keywords: ['سجناء سياسيين', 'مشمولين', 'مؤسسة'],
      },
    ],
  },
  {
    id: 'dhiqar-oil',
    name: 'القطاع النفطي في ذي قار',
    nameEn: 'Dhi Qar Oil Sector',
    type: 'PUBLIC_SERVICE_ENTITY',
    parentAuthority: 'وزارة النفط',
    district: 'الناصرية',
    sourceUrl: 'https://oil.gov.iq/',
    verification: draft,
    integrationStatus: awaiting,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'يعرض الدليل المعلومات العامة والفرص المنشورة فقط، ولا يكشف أي نظام تشغيلي داخلي.',
    services: [
      {
        name: 'إعلانات وخدمات مجتمعية عامة',
        description: 'محتوى بانتظار مصدر منشور وتفويض الجهة المالكة.',
        availability: 'INFORMATION_ONLY',
        keywords: ['نفط', 'شركة نفط', 'فرص عمل'],
      },
    ],
  },
  {
    id: 'dhiqar-communications',
    name: 'الاتصالات والبريد في ذي قار',
    nameEn: 'Communications and Post in Dhi Qar',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة الاتصالات',
    district: 'الناصرية',
    sourceUrl: 'https://moc.gov.iq/',
    verification: draft,
    integrationStatus: awaiting,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'دليل مكاتب وخدمات بانتظار اعتماد بيانات اتصال وخدمات محلية من الجهة.',
    services: [
      {
        name: 'دليل الخدمات البريدية والاتصالات',
        description: 'معلومات خدمة بانتظار اعتماد جهة الاختصاص وربطها.',
        availability: 'INFORMATION_ONLY',
        keywords: ['بريد', 'اتصالات', 'انترنت', 'كابل ضوئي'],
      },
    ],
  },
  {
    id: 'dhiqar-tourism',
    name: 'السياحة والآثار في ذي قار',
    nameEn: 'Dhi Qar Tourism and Antiquities',
    type: 'FEDERAL_GOVERNMENT',
    parentAuthority: 'وزارة الثقافة والسياحة والآثار',
    district: 'الناصرية',
    sourceUrl: 'https://mocul.gov.iq/',
    verification: draft,
    integrationStatus: awaiting,
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    summary: 'دليل حكومي للمواقع والتصاريح والخدمات المنشورة، وليس موقعاً سياحياً تجارياً.',
    services: [
      {
        name: 'دليل المواقع والتصاريح',
        description: 'معلومات بانتظار توثيق خدمات الزيارة أو التصاريح من الجهة.',
        availability: 'INFORMATION_ONLY',
        keywords: ['سياحة', 'آثار', 'أور', 'زيقورة', 'تصريح'],
      },
    ],
  },
]

export const entityTypeLabels: Record<GovernmentEntityType, string> = {
  LOCAL_GOVERNMENT: 'حكومة محلية',
  FEDERAL_GOVERNMENT: 'جهة اتحادية',
  INDEPENDENT_AUTHORITY: 'هيئة مستقلة',
  PUBLIC_SERVICE_ENTITY: 'خدمة عامة',
}

export const integrationStatusLabels: Record<GovernmentEntity['integrationStatus'], string> = {
  LOCAL_WORKFLOW: 'يستقبل طلباً داخل المنصة',
  OFFICIAL_LINK: 'مسار رسمي خارجي',
  AWAITING_OFFICIAL_INTEGRATION: 'بانتظار ربط رسمي',
  AWAITING_SERVICE_DATA: 'بانتظار اعتماد بيانات الخدمة',
}

export const availabilityLabels: Record<DigitalAvailability, string> = {
  FULLY_DIGITAL: 'رقمية داخل المنصة',
  PARTIALLY_DIGITAL: 'رقمية جزئياً',
  INFORMATION_ONLY: 'دليل معلوماتي',
  EXTERNAL_INTEGRATION: 'بوابة رسمية خارجية',
}

export const searchGovernmentDirectory = (query: string) => {
  const term = query.trim().toLowerCase()
  if (!term) return governmentEntities
  return governmentEntities.filter(entity =>
    `${entity.name} ${entity.nameEn} ${entity.parentAuthority} ${entity.district} ${entity.summary} ${entity.services.flatMap(service => [service.name, service.description, ...service.keywords]).join(' ')}`
      .toLowerCase()
      .includes(term)
  )
}
