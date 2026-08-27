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

  {
    key: 'municipality-service', title: 'خدمات البلدية العامة', department: 'مديرية بلديات ذي قار', category: 'البناء والبلديات',
    description: 'تسجيل طلب خدمي أو إداري للبلدية وتحويله إلى الشعبة المختصة للمراجعة.', estimatedTime: 'تحددها الدائرة بعد فرز الطلب', fee: 0, feeNote: 'لا يثبت رسم قبل التسعير الرسمي من الدائرة.', requirements: ['عنوان موقع الخدمة', 'تفاصيل واضحة', 'مرفقات عند الحاجة'], mode: 'GENERIC',
    fields: [
      { key: 'serviceType', label: 'نوع خدمة البلدية', type: 'select', required: true, options: ['طلب رفع أنقاض', 'طلب صيانة شارع', 'طلب إنارة موقع', 'استفسار معاملات بلدية', 'طلب آخر'] },
      { key: 'district', label: 'القضاء', type: 'select', required: true, options: districts },
      { key: 'area', label: 'الحي أو المنطقة', type: 'text', required: true, maxLength: 120 },
      { key: 'address', label: 'العنوان وأقرب نقطة دالة', type: 'textarea', required: true, maxLength: 350 },
      { key: 'details', label: 'تفاصيل الطلب', type: 'textarea', required: true, maxLength: 1200 },
      { key: 'contactPhone', label: 'هاتف التواصل', type: 'tel', required: true, maxLength: 20 },
    ],
  },
  {
    key: 'electricity-service', title: 'خدمات الكهرباء', department: 'فرع توزيع كهرباء ذي قار', category: 'الكهرباء',
    description: 'طلب خدمي للكهرباء يحال إلى القسم المختص مع بيانات الاشتراك والموقع.', estimatedTime: 'تحدد الأولوية حسب الحالة والموقع', fee: 0, feeNote: 'لا يثبت رسم قبل قرار الدائرة.', requirements: ['رقم الاشتراك إن وجد', 'عنوان الموقع', 'صور للمشكلة عند الحاجة'], mode: 'GENERIC',
    fields: [
      { key: 'serviceType', label: 'نوع خدمة الكهرباء', type: 'select', required: true, options: ['انقطاع أو ضعف تجهيز', 'طلب كشف فني', 'مشكلة عداد', 'إنارة شارع', 'طلب آخر'] },
      { key: 'accountNumber', label: 'رقم اشتراك الكهرباء', type: 'text', required: false, maxLength: 60 },
      { key: 'district', label: 'القضاء', type: 'select', required: true, options: districts },
      { key: 'address', label: 'العنوان وأقرب نقطة دالة', type: 'textarea', required: true, maxLength: 350 },
      { key: 'details', label: 'تفاصيل المشكلة أو الطلب', type: 'textarea', required: true, maxLength: 1200 },
      { key: 'contactPhone', label: 'هاتف التواصل', type: 'tel', required: true, maxLength: 20 },
    ],
  },
  {
    key: 'sewerage-service', title: 'خدمات المجاري', department: 'مديرية مجاري ذي قار', category: 'الماء والمجاري',
    description: 'بلاغ أو طلب خدمة لمتابعة شبكة المجاري وتحويله إلى فريق الدائرة.', estimatedTime: 'بحسب الخطورة وخطة الفريق', fee: 0, feeNote: 'الخدمة لا تسجل رسماً داخل المنصة.', requirements: ['عنوان موقع المشكلة', 'وصف واضح', 'صورة عند الحاجة'], mode: 'GENERIC',
    fields: [
      { key: 'serviceType', label: 'نوع خدمة المجاري', type: 'select', required: true, options: ['طفح مجارٍ', 'انسداد خط', 'تسرب أو كسر', 'طلب كشف', 'طلب آخر'] },
      { key: 'district', label: 'القضاء', type: 'select', required: true, options: districts },
      { key: 'address', label: 'العنوان وأقرب نقطة دالة', type: 'textarea', required: true, maxLength: 350 },
      { key: 'impact', label: 'درجة تأثير المشكلة', type: 'select', required: true, options: ['منزل واحد', 'عدة منازل', 'شارع أو منطقة', 'حالة طارئة'] },
      { key: 'details', label: 'تفاصيل المشكلة', type: 'textarea', required: true, maxLength: 1200 },
      { key: 'contactPhone', label: 'هاتف التواصل', type: 'tel', required: true, maxLength: 20 },
    ],
  },
  {
    key: 'health-service', title: 'خدمات صحة ذي قار', department: 'دائرة صحة ذي قار', category: 'الصحة',
    description: 'تسجيل طلب إداري أو خدمي غير طارئ وتحويله إلى جهة الصحة المختصة.', estimatedTime: 'حسب نوع الطلب والدائرة المعنية', fee: 0, feeNote: 'الرسوم تحددها دائرة الصحة عند وجودها.', requirements: ['بيانات التواصل', 'تفاصيل الطلب', 'المرفقات عند الحاجة'], mode: 'GENERIC',
    fields: [
      { key: 'serviceType', label: 'نوع الخدمة الصحية', type: 'select', required: true, options: ['طلب موعد إداري', 'استفسار وثيقة صحية', 'شكوى على خدمة', 'طلب معلومات', 'طلب آخر'] },
      { key: 'facility', label: 'المؤسسة أو المركز إن وجد', type: 'text', required: false, maxLength: 120 },
      { key: 'district', label: 'القضاء', type: 'select', required: true, options: districts },
      { key: 'subject', label: 'عنوان الطلب', type: 'text', required: true, maxLength: 160 },
      { key: 'details', label: 'تفاصيل الطلب', type: 'textarea', required: true, maxLength: 1200 },
      { key: 'contactPhone', label: 'هاتف التواصل', type: 'tel', required: true, maxLength: 20 },
    ],
  },
  {
    key: 'education-service', title: 'خدمات تربية ذي قار', department: 'المديرية العامة للتربية في محافظة ذي قار', category: 'التربية والتعليم',
    description: 'تقديم طلب إداري أو استفسار مدرسي يحال إلى المديرية أو القسم المختص.', estimatedTime: 'تحددها شعبة التربية بعد فرز الطلب', fee: 0, feeNote: 'لا يثبت رسم قبل إشعار الجهة المختصة.', requirements: ['اسم الطالب أو المستفيد', 'بيانات المدرسة إن وجدت', 'مرفقات عند الحاجة'], mode: 'GENERIC',
    fields: [
      { key: 'serviceType', label: 'نوع الخدمة التعليمية', type: 'select', required: true, options: ['طلب نقل طالب', 'استفسار وثيقة مدرسية', 'شكوى خدمية', 'طلب معلومات', 'طلب آخر'] },
      { key: 'beneficiaryName', label: 'اسم الطالب أو المستفيد', type: 'text', required: true, maxLength: 160 },
      { key: 'schoolName', label: 'اسم المدرسة الحالية أو المقترحة', type: 'text', required: false, maxLength: 180 },
      { key: 'district', label: 'القضاء', type: 'select', required: true, options: districts },
      { key: 'details', label: 'تفاصيل الطلب', type: 'textarea', required: true, maxLength: 1200 },
      { key: 'contactPhone', label: 'هاتف التواصل', type: 'tel', required: true, maxLength: 20 },
    ],
  },
  {
    key: 'agriculture-service', title: 'خدمات الزراعة', department: 'مديرية زراعة ذي قار', category: 'الزراعة',
    description: 'تسجيل طلب أو استفسار زراعي وإحالته إلى الشعبة المختصة في المديرية.', estimatedTime: 'حسب نوع الطلب والكشف المطلوب', fee: 0, feeNote: 'تحدد الرسوم أو المتطلبات من مديرية الزراعة.', requirements: ['موقع النشاط الزراعي', 'وصف الطلب', 'وثائق عند الحاجة'], mode: 'GENERIC',
    fields: [
      { key: 'serviceType', label: 'نوع الخدمة الزراعية', type: 'select', required: true, options: ['طلب كشف زراعي', 'استفسار دعم أو مستلزمات', 'تسجيل نشاط', 'شكوى خدمة', 'طلب آخر'] },
      { key: 'farmLocation', label: 'موقع المزرعة أو النشاط', type: 'textarea', required: true, maxLength: 350 },
      { key: 'district', label: 'القضاء', type: 'select', required: true, options: districts },
      { key: 'activityType', label: 'نوع النشاط', type: 'select', required: true, options: ['محاصيل', 'بساتين', 'ثروة حيوانية', 'دواجن', 'أخرى'] },
      { key: 'details', label: 'تفاصيل الطلب', type: 'textarea', required: true, maxLength: 1200 },
      { key: 'contactPhone', label: 'هاتف التواصل', type: 'tel', required: true, maxLength: 20 },
    ],
  },
  {
    key: 'environment-service', title: 'خدمات البيئة', department: 'مديرية بيئة ذي قار', category: 'البيئة',
    description: 'تسجيل بلاغ أو طلب بيئي وتحويله إلى فريق المتابعة المختص.', estimatedTime: 'حسب درجة الأثر البيئي', fee: 0, feeNote: 'الخدمة بلا رسم داخل المنصة.', requirements: ['موقع واضح', 'وصف الأثر', 'صورة أو ملف عند الحاجة'], mode: 'GENERIC',
    fields: [
      { key: 'serviceType', label: 'نوع الطلب البيئي', type: 'select', required: true, options: ['بلاغ تلوث', 'طلب كشف بيئي', 'مقترح بيئي', 'استفسار ترخيص', 'طلب آخر'] },
      { key: 'district', label: 'القضاء', type: 'select', required: true, options: districts },
      { key: 'locationDescription', label: 'الموقع وأقرب نقطة دالة', type: 'textarea', required: true, maxLength: 350 },
      { key: 'impact', label: 'نوع الأثر أو المشكلة', type: 'textarea', required: true, maxLength: 500 },
      { key: 'details', label: 'تفاصيل إضافية', type: 'textarea', required: true, maxLength: 1200 },
      { key: 'contactPhone', label: 'هاتف التواصل', type: 'tel', required: true, maxLength: 20 },
    ],
  },
  {
    key: 'planning-service', title: 'خدمات التخطيط', department: 'مديرية تخطيط ذي قار', category: 'التخطيط',
    description: 'طلب معلومات أو معاملة إدارية متعلقة بالتخطيط وتحويلها إلى الشعبة المختصة.', estimatedTime: 'بحسب نوع المعلومة أو الكتاب الرسمي', fee: 0, feeNote: 'يحدد أي رسم أو مستند من الدائرة.', requirements: ['عنوان واضح للطلب', 'تفاصيل كافية', 'كتاب رسمي عند الحاجة'], mode: 'GENERIC',
    fields: [
      { key: 'serviceType', label: 'نوع خدمة التخطيط', type: 'select', required: true, options: ['طلب بيانات أو إحصائية', 'طلب مخاطبة', 'استفسار خطة مشروع', 'طلب معلومات', 'طلب آخر'] },
      { key: 'entityType', label: 'صفة مقدم الطلب', type: 'select', required: true, options: ['مواطن', 'شركة', 'منظمة', 'جهة حكومية'] },
      { key: 'subject', label: 'عنوان الطلب', type: 'text', required: true, maxLength: 160 },
      { key: 'details', label: 'تفاصيل الطلب والغرض', type: 'textarea', required: true, maxLength: 1200 },
      { key: 'contactPhone', label: 'هاتف التواصل', type: 'tel', required: true, maxLength: 20 },
    ],
  },
  {
    key: 'investment-service', title: 'خدمات الاستثمار', department: 'هيئة استثمار ذي قار', category: 'الاستثمار',
    description: 'تسجيل استفسار أو طلب أولي لمشروع استثماري وإحالته إلى هيئة الاستثمار.', estimatedTime: 'تحددها الهيئة بعد مراجعة ملخص المشروع', fee: 0, feeNote: 'لا يتم تحصيل أي رسم في المنصة قبل الإجراءات الرسمية.', requirements: ['ملخص فكرة المشروع', 'موقع أو قطاع الاستثمار', 'معلومات التواصل'], mode: 'GENERIC',
    fields: [
      { key: 'serviceType', label: 'نوع خدمة الاستثمار', type: 'select', required: true, options: ['استفسار فرصة استثمارية', 'تقديم فكرة مشروع', 'طلب مقابلة استثمارية', 'استفسار إجازة', 'طلب آخر'] },
      { key: 'projectSector', label: 'قطاع المشروع', type: 'select', required: true, options: ['صناعة', 'زراعة', 'سياحة', 'خدمات', 'إسكان', 'طاقة', 'أخرى'] },
      { key: 'projectLocation', label: 'موقع المشروع المقترح', type: 'text', required: false, maxLength: 200 },
      { key: 'investmentRange', label: 'حجم الاستثمار التقريبي', type: 'select', required: false, options: ['أقل من 100 مليون د.ع', '100–500 مليون د.ع', 'أكثر من 500 مليون د.ع', 'يحدد لاحقاً'] },
      { key: 'details', label: 'ملخص المشروع أو الاستفسار', type: 'textarea', required: true, maxLength: 1500 },
      { key: 'contactPhone', label: 'هاتف التواصل', type: 'tel', required: true, maxLength: 20 },
    ],
  },
  {
    key: 'governorate-service', title: 'خدمات ديوان المحافظة', department: 'ديوان محافظة ذي قار', category: 'حكومة محلية',
    description: 'تسجيل طلب إداري أو كتاب متابعة لتحويله إلى القسم المختص في ديوان المحافظة.', estimatedTime: 'تحددها الشعبة المختصة بعد تسجيل الطلب', fee: 0, feeNote: 'لا يوجد رسم مثبت ضمن المنصة.', requirements: ['عنوان الطلب', 'الجهة المعنية إن وجدت', 'تفاصيل وملفات داعمة عند الحاجة'], mode: 'GENERIC',
    fields: [
      { key: 'serviceType', label: 'نوع طلب الديوان', type: 'select', required: true, options: ['طلب مقابلة', 'متابعة كتاب', 'طلب معلومات', 'طلب مخاطبة دائرة', 'طلب آخر'] },
      { key: 'previousReference', label: 'رقم الكتاب أو الطلب السابق', type: 'text', required: false, maxLength: 80 },
      { key: 'district', label: 'القضاء', type: 'select', required: true, options: districts },
      { key: 'subject', label: 'عنوان الطلب', type: 'text', required: true, maxLength: 160 },
      { key: 'details', label: 'تفاصيل الطلب', type: 'textarea', required: true, maxLength: 1500 },
      { key: 'contactPhone', label: 'هاتف التواصل', type: 'tel', required: true, maxLength: 20 },
    ],
  },
]

export const getServiceDefinition = (key: string) => serviceDefinitions.find(service => service.key === key)
