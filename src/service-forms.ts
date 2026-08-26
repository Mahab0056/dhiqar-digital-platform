export type ServiceFieldType = 'text' | 'textarea' | 'select' | 'date' | 'time' | 'tel'

export interface ServiceFormField {
  key: string
  label: string
  type: ServiceFieldType
  required: boolean
  placeholder?: string
  options?: string[]
  maxLength?: number
}

export interface DigitalServiceDefinition {
  key: string
  title: string
  department: string
  category: string
  description: string
  estimatedTime: string
  fee: number
  feeNote: string
  requirements: string[]
  mode: 'SPECIALIZED' | 'GENERIC' | 'APPOINTMENT' | 'EXTERNAL'
  fields: ServiceFormField[]
  officialLinks?: Array<{ label: string; url: string }>
  boundaryNote?: string
}

const districts = ['الناصرية', 'الشطرة', 'سوق الشيوخ', 'الرفاعي', 'الجبايش', 'قلعة سكر', 'الفهود', 'الغراف', 'الكرمة', 'الدواية']

export const serviceDefinitions: DigitalServiceDefinition[] = [
  {
    key: 'store-license', title: 'إجازة فتح محل', department: 'مديرية بلديات ذي قار', category: 'المحلات والأعمال',
    description: 'تقديم طلب إجازة لمحل تجاري جديد مع المرفقات والموقع ومسار مراجعة الموظف.',
    estimatedTime: 'تحددها الدائرة بعد التدقيق', fee: 0, feeNote: 'يحدد الرسم من الجهة المختصة بعد التدقيق وربط بوابة الدفع.',
    requirements: ['عقد إيجار أو سند ملكية', 'صورة واجهة المحل', 'تحديد الموقع'], mode: 'SPECIALIZED', fields: [],
  },
  {
    key: 'building-permit', title: 'طلب إجازة بناء', department: 'مديرية بلديات ذي قار', category: 'البناء والبلديات',
    description: 'تسجيل بيانات العقار ونوع المشروع لإحالتها إلى التدقيق الهندسي والكشف الموقعي.',
    estimatedTime: 'تحددها الدائرة بعد اكتمال المخططات', fee: 0, feeNote: 'لا يسجل رسم قبل تسعير الجهة المختصة.',
    requirements: ['سند العقار', 'المخططات الهندسية', 'هوية مقدم الطلب'], mode: 'GENERIC',
    fields: [
      { key: 'applicantCapacity', label: 'صفة مقدم الطلب', type: 'select', required: true, options: ['مالك العقار', 'وكيل قانوني', 'مستثمر'] },
      { key: 'propertyNumber', label: 'رقم العقار', type: 'text', required: true, maxLength: 60 },
      { key: 'propertyAddress', label: 'عنوان العقار', type: 'textarea', required: true, maxLength: 300 },
      { key: 'district', label: 'القضاء', type: 'select', required: true, options: districts },
      { key: 'constructionType', label: 'نوع الإنشاء', type: 'select', required: true, options: ['سكني', 'تجاري', 'مختلط', 'إضافة بناء'] },
      { key: 'floors', label: 'عدد الطوابق المقترح', type: 'select', required: true, options: ['1', '2', '3', '4 أو أكثر'] },
      { key: 'engineerName', label: 'اسم المهندس أو المكتب المصمم', type: 'text', required: false, maxLength: 120 },
    ],
  },
  {
    key: 'water-complaint', title: 'بلاغ ماء أو مجارٍ', department: 'مديرية ماء ذي قار', category: 'الماء والمجاري',
    description: 'إرسال بلاغ خدمي بعنوان واضح ووصف للمشكلة لتحويله إلى الفريق المختص.',
    estimatedTime: 'بحسب درجة الخطورة وخطة الفريق', fee: 0, feeNote: 'الخدمة بلا رسم داخل المنصة.',
    requirements: ['العنوان', 'وصف واضح للمشكلة'], mode: 'GENERIC',
    fields: [
      { key: 'problemType', label: 'نوع البلاغ', type: 'select', required: true, options: ['انقطاع ماء', 'كسر أنبوب', 'طفح مجارٍ', 'تسرب', 'مشكلة أخرى'] },
      { key: 'district', label: 'القضاء', type: 'select', required: true, options: districts },
      { key: 'address', label: 'العنوان وأقرب نقطة دالة', type: 'textarea', required: true, maxLength: 350 },
      { key: 'description', label: 'وصف المشكلة', type: 'textarea', required: true, maxLength: 800 },
      { key: 'contactPhone', label: 'هاتف التواصل', type: 'tel', required: true, maxLength: 20 },
    ],
  },
  {
    key: 'land-request', title: 'متابعة طلب قطعة أرض', department: 'ديوان محافظة ذي قار', category: 'السكن والأراضي',
    description: 'تسجيل بيانات الطلب السابق أو برنامج التخصيص وإرسالها إلى قسم الأملاك للمتابعة.',
    estimatedTime: 'بحسب البرنامج وقرار التخصيص', fee: 0, feeNote: 'لا يسجل رسم لهذه المتابعة داخل المنصة.',
    requirements: ['رقم الطلب السابق إن وجد', 'بيانات السكن والأسرة'], mode: 'GENERIC',
    fields: [
      { key: 'programName', label: 'برنامج أو فئة التقديم', type: 'text', required: true, maxLength: 120 },
      { key: 'previousReference', label: 'رقم الطلب السابق', type: 'text', required: false, maxLength: 80 },
      { key: 'district', label: 'القضاء', type: 'select', required: true, options: districts },
      { key: 'housingStatus', label: 'حالة السكن الحالية', type: 'select', required: true, options: ['إيجار', 'مع العائلة', 'سكن مؤقت', 'أخرى'] },
      { key: 'familyMembers', label: 'عدد أفراد الأسرة', type: 'text', required: true, maxLength: 3 },
      { key: 'notes', label: 'ملاحظات إضافية', type: 'textarea', required: false, maxLength: 600 },
    ],
  },
  {
    key: 'e-passport', title: 'الجواز الإلكتروني العراقي', department: 'وزارة الداخلية — مديرية شؤون الجوازات', category: 'الوثائق الحكومية',
    description: 'الانتقال المنظم إلى نظام الحجز الوطني للجواز الإلكتروني مع قائمة متطلبات ومراكز ذي قار المنشورة رسمياً.',
    estimatedTime: 'الحجز والتوقيت يحددهما النظام الوطني', fee: 0, feeNote: 'الرسوم تحددها مديرية شؤون الجوازات وتدفع ضمن المسار الرسمي.',
    requirements: ['البطاقة الوطنية الأصلية', 'بطاقة دفع إلكتروني', 'وثائق ولي الأمر لمن هم دون 18 سنة', 'وثائق إضافية لبدل الفاقد أو التالف'], mode: 'EXTERNAL', fields: [],
    officialLinks: [
      { label: 'فتح حجز الجواز الرسمي', url: 'https://appointment.epp.iq/p/p/reservation' },
      { label: 'التعليمات على بوابة أور', url: 'https://ur.gov.iq/index/show-eservice/50850/10042/cat' },
      { label: 'مراكز الجواز في ذي قار', url: 'https://epp.iq/' },
    ],
    boundaryNote: 'الحجز وOTP وQR تصدر من نظام الجواز الوطني. لا تنشئ منصة ذي قار حجزاً بديلاً أو رقماً موازياً.',
  },
  {
    key: 'national-id', title: 'البطاقة الوطنية الموحدة', department: 'وزارة الداخلية — مديرية الجنسية والمعلومات المدنية', category: 'الوثائق الحكومية',
    description: 'الوصول إلى الحجز الرسمي للبطاقة الوطنية مع عرض خطوات الحضور والتقاط المعرفات الحياتية داخل الدائرة.',
    estimatedTime: 'الموعد تحدده منظومة وزارة الداخلية', fee: 6000, feeNote: 'رسوم منشورة في بوابة أور؛ الدفع يتم في المسار الرسمي وبطاقة الدفع.',
    requirements: ['هوية الأحوال المدنية', 'شهادة الجنسية العراقية', 'بطاقة السكن', 'استمارة التقديم'], mode: 'EXTERNAL', fields: [],
    officialLinks: [
      { label: 'خدمة البطاقة الوطنية في أور', url: 'https://ur.gov.iq/index/show-eservice/62015/10042/cat' },
      { label: 'تنزيل تطبيق عين العراق', url: 'https://play.google.com/store/apps/details?id=com.moi.ayniq&hl=ar' },
      { label: 'تعليمات تطبيق البطاقة الوطنية', url: 'https://ur.gov.iq/index/show-eservice/51434/10042/cat' },
    ],
    boundaryNote: 'الصورة وقزحية العين والبصمات تؤخذ داخل دائرة البطاقة الوطنية. المنصة لا تحاكي هذه الإجراءات ولا تصدر موعداً وطنياً دون تكامل رسمي.',
  },
  {
    key: 'driving-license', title: 'إجازة السياقة', department: 'وزارة الداخلية — مديرية المرور العامة', category: 'الوثائق الحكومية',
    description: 'مسار إرشادي رسمي يربط حجز الفحص الطبي وتعليمات إصدار إجازة السياقة لأول مرة.',
    estimatedTime: 'الفحص الطبي يوم عمل؛ إنجاز المرور حسب الموعد', fee: 0, feeNote: 'رسوم الإجازة يحددها القانون؛ الفحص الطبي له رسم منشور في بوابة أور.',
    requirements: ['البطاقة الوطنية', 'بطاقة السكن', 'وثيقة الفحص الطبي', 'استمارة الحجز الإلكتروني'], mode: 'EXTERNAL', fields: [],
    officialLinks: [
      { label: 'حجز الفحص الطبي في أور', url: 'https://eservice.ur.gov.iq/customer/applyService/10457' },
      { label: 'إجراءات الإصدار لأول مرة', url: 'https://ur.gov.iq/index/show-eservice/40305/10044/cat' },
      { label: 'خدمة حجز المرور الوطنية', url: 'https://ur.gov.iq/index/show-eservice/51530/18/org' },
    ],
    boundaryNote: 'صفحة أور المنشورة لخدمة حجز المرور تذكر نطاقاً متاحاً في بغداد؛ لذلك لا يظهر حجز مرور ذي قار مؤكداً قبل تأكيد مديرية المرور أو التكامل معها.',
  },
  {
    key: 'online-appointment', title: 'حجز موعد أونلاين', department: 'مركز خدمة المواطن', category: 'الوثائق الحكومية',
    description: 'إرسال طلب موعد إلى الدائرة المختارة ومتابعة تأكيده من حساب المواطن.',
    estimatedTime: 'يؤكد الموعد بعد مراجعة الدائرة', fee: 0, feeNote: 'حجز الموعد بلا رسم داخل المنصة.',
    requirements: ['تحديد الدائرة والغرض', 'اختيار تاريخ ووقت مفضلين'], mode: 'APPOINTMENT',
    fields: [
      { key: 'department', label: 'الدائرة المطلوبة', type: 'select', required: true, options: ['ديوان محافظة ذي قار', 'مديرية بلديات ذي قار', 'مديرية ماء ذي قار', 'مديرية مجاري ذي قار', 'دائرة صحة ذي قار', 'مديرية زراعة ذي قار', 'هيئة استثمار ذي قار'] },
      { key: 'purpose', label: 'غرض الموعد', type: 'textarea', required: true, maxLength: 400 },
      { key: 'preferredDate', label: 'التاريخ المفضل', type: 'date', required: true },
      { key: 'preferredTime', label: 'الوقت المفضل', type: 'time', required: true },
      { key: 'contactPhone', label: 'هاتف التواصل', type: 'tel', required: true, maxLength: 20 },
    ],
  },
]

export const getServiceDefinition = (key: string) => serviceDefinitions.find(service => service.key === key)
