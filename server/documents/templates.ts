/**
 * Official document templates issued by Dhi Qar departments. Pure data (no DB): the renderer, the sample
 * generator, the employee gallery and the per-service mapping all read from here.
 */

export type TemplateFamily = 'CERTIFICATE' | 'LETTER' | 'RECEIPT' | 'CARD'
export type TemplateCategory = 'LICENCES' | 'APPROVALS' | 'LETTERS' | 'CERTIFICATES' | 'NOTICES' | 'CARDS'

/** Data blocks a template prints (the gallery lists them; the renderer skips the ones a template omits). */
export type TemplateField =
  | 'holder'
  | 'nationalId'
  | 'reference'
  | 'service'
  | 'department'
  | 'district'
  | 'location'
  | 'details'
  | 'validity'
  | 'conditions'
  | 'fees'
  | 'signer'
  | 'decision'
  | 'appointment'
  | 'reason'
  | 'referral'

export type DocumentTemplate = {
  id: string
  title: string
  titleEn: string
  category: TemplateCategory
  family: TemplateFamily
  description: string
  fields: TemplateField[]
  /** null = no expiry printed */
  defaultValidityDays: number | null
  defaultSignerTitle: string
  /** label of the holder row ("اسم صاحب الإجازة") */
  holderLabel: string
  /** label of the serial ("رقم الإجازة") */
  numberLabel: string
  /** opening paragraph; {service} {department} {holder} are filled in */
  preamble: string
  /** LETTER family: addressee line */
  addressee?: string
  /** LETTER family: closing line before the signature */
  closing?: string
  defaultConditions: string[]
  /** the document title follows the service ("شهادة عدم المحكومية") instead of the generic template title */
  titleFromService?: boolean
  /** false: never issued when a request is approved, so it cannot be assigned to a service (rejection letters) */
  issuable?: boolean
  /** only meaningful with an attendance appointment: assignable to attendance services, issued with a slot */
  requiresAppointment?: boolean
}

export const templateCategoryLabels: Record<TemplateCategory, string> = {
  LICENCES: 'إجازات وتراخيص',
  APPROVALS: 'موافقات وقرارات',
  LETTERS: 'كتب رسمية',
  CERTIFICATES: 'شهادات وبراءات ذمة',
  NOTICES: 'وصولات وإشعارات',
  CARDS: 'بطاقات',
}

export const templateFamilyLabels: Record<TemplateFamily, string> = {
  CERTIFICATE: 'شهادة / إجازة A4 بإطار أمني',
  LETTER: 'كتاب رسمي A4',
  RECEIPT: 'وصل / إشعار A5',
  CARD: 'بطاقة بحجم الهوية',
}

export const templateFieldLabels: Record<TemplateField, string> = {
  holder: 'اسم صاحب العلاقة',
  nationalId: 'آخر 4 أرقام من البطاقة الوطنية',
  reference: 'رقم المعاملة',
  service: 'اسم الخدمة',
  department: 'الدائرة المصدرة',
  district: 'القضاء / الناحية',
  location: 'العنوان / الموقع',
  details: 'تفاصيل الطلب',
  validity: 'تاريخ الإصدار والنفاذ',
  conditions: 'الشروط والملاحظات',
  fees: 'الرسوم ورقم الوصل',
  signer: 'صفة المخوّل بالتوقيع',
  decision: 'رقم القرار / الكتاب',
  appointment: 'موعد الحضور',
  reason: 'أسباب القرار',
  referral: 'الجهة المحال إليها',
}

const CORE: TemplateField[] = ['holder', 'nationalId', 'reference', 'service', 'department', 'decision', 'signer']

export const documentTemplates: DocumentTemplate[] = [
  {
    id: 'shop-licence',
    title: 'إجازة فتح محل',
    titleEn: 'SHOP OPENING LICENCE',
    category: 'LICENCES',
    family: 'CERTIFICATE',
    description: 'إجازة فتح أو تجديد محل تجاري أو غذائي أو خدمي، تُعلّق داخل المحل.',
    fields: [...CORE, 'district', 'location', 'details', 'validity', 'conditions', 'fees'],
    defaultValidityDays: 365,
    defaultSignerTitle: 'مدير البلدية',
    holderLabel: 'اسم صاحب الإجازة',
    numberLabel: 'رقم الإجازة',
    preamble:
      'استناداً إلى الصلاحيات المخوّلة لنا بموجب القوانين والتعليمات النافذة، وبعد تدقيق المستمسكات واستكمال الكشف الموقعي، تُمنح هذه الإجازة لفتح المحل المبيّنة تفاصيله أدناه.',
    defaultConditions: [
      'تُعلّق هذه الإجازة في مكان ظاهر داخل المحل.',
      'لا يجوز تغيير نوع النشاط أو موقع المحل أو التنازل عنه إلا بموافقة الدائرة المختصة.',
      'الالتزام بشروط السلامة والصحة العامة والنظافة وعدم التجاوز على الرصيف.',
      'تُجدَّد الإجازة قبل انتهاء نفاذها بثلاثين يوماً.',
    ],
  },
  {
    id: 'profession-licence',
    title: 'إجازة ممارسة مهنة',
    titleEn: 'PROFESSION PRACTICE LICENCE',
    category: 'LICENCES',
    family: 'CERTIFICATE',
    description: 'إجازة ممارسة مهنة أو حرفة (محل صناعي، ورشة، فندق، مكتب) لمدة محددة.',
    fields: [...CORE, 'district', 'location', 'details', 'validity', 'conditions', 'fees'],
    defaultValidityDays: 365,
    defaultSignerTitle: 'مدير البلدية',
    holderLabel: 'اسم صاحب الإجازة',
    numberLabel: 'رقم الإجازة',
    preamble:
      'بناءً على الطلب المقدّم واستيفاء الشروط القانونية والفنية، يُجاز المذكور أدناه بممارسة المهنة المبيّنة في هذه الإجازة ضمن الموقع المحدد وللمدة المذكورة.',
    defaultConditions: [
      'تُمارَس المهنة في الموقع المحدد حصراً ومن قبل صاحب الإجازة.',
      'الالتزام بمتطلبات السلامة المهنية والبيئية وأوقات العمل الرسمية.',
      'للدائرة إلغاء الإجازة عند مخالفة شروطها أو التعليمات النافذة.',
    ],
  },
  {
    id: 'building-permit',
    title: 'إجازة بناء',
    titleEn: 'BUILDING PERMIT',
    category: 'LICENCES',
    family: 'CERTIFICATE',
    description: 'إجازة بناء دار سكنية أو بناء جديد وفق المخططات المصادق عليها.',
    fields: [...CORE, 'district', 'location', 'details', 'validity', 'conditions', 'fees'],
    defaultValidityDays: 365,
    defaultSignerTitle: 'مدير البلدية',
    holderLabel: 'اسم المجاز',
    numberLabel: 'رقم إجازة البناء',
    preamble:
      'استناداً إلى التصاميم والمخططات المصادق عليها من الجهات الفنية المختصة، وبعد الكشف على قطعة الأرض وتدقيق سند العائدية، يُجاز المذكور أدناه بالبناء وفق التفاصيل الآتية.',
    defaultConditions: [
      'يلتزم المجاز بالتصاميم المصادق عليها والارتدادات والارتفاعات المقررة.',
      'لا يجوز التجاوز على الرصيف أو الشارع أو أملاك الدولة أو الجوار.',
      'تُعلّق لوحة الإجازة في موقع العمل طيلة مدة البناء.',
      'تُعدّ الإجازة ملغاة إذا لم يُباشَر بالبناء خلال مدة نفاذها.',
    ],
  },
  {
    id: 'renovation-permit',
    title: 'إجازة ترميم وإضافة بناء',
    titleEn: 'RENOVATION & EXTENSION PERMIT',
    category: 'LICENCES',
    family: 'CERTIFICATE',
    description: 'إجازة ترميم أو إضافة طابق أو ملحق لبناء قائم.',
    fields: [...CORE, 'district', 'location', 'details', 'validity', 'conditions', 'fees'],
    defaultValidityDays: 180,
    defaultSignerTitle: 'مدير البلدية',
    holderLabel: 'اسم المجاز',
    numberLabel: 'رقم الإجازة',
    preamble:
      'بناءً على الطلب المقدّم ونتائج الكشف الفني على البناء القائم، يُجاز المذكور أدناه بأعمال الترميم أو الإضافة المبيّنة في هذه الإجازة فقط.',
    defaultConditions: [
      'تقتصر الأعمال على ما ورد في هذه الإجازة والمخطط المرفق بها.',
      'لا يجوز المساس بالعناصر الإنشائية إلا بإشراف مهندس مختص.',
      'رفع الأنقاض ومخلفات البناء على نفقة المجاز خلال مدة العمل.',
    ],
  },
  {
    id: 'general-licence',
    title: 'إجازة / ترخيص',
    titleEn: 'LICENCE',
    category: 'LICENCES',
    family: 'CERTIFICATE',
    description: 'قالب عام للتراخيص الأخرى: عيادة، صيدلية، روضة، معهد، حفر بئر، لافتة، حيازة سلاح…',
    fields: [...CORE, 'district', 'location', 'details', 'validity', 'conditions', 'fees'],
    defaultValidityDays: 365,
    defaultSignerTitle: 'المدير العام',
    holderLabel: 'اسم صاحب الترخيص',
    numberLabel: 'رقم الترخيص',
    preamble:
      'استناداً إلى الصلاحيات المخوّلة لنا وبعد استيفاء المتطلبات القانونية والفنية، يُمنح المذكور أدناه هذا الترخيص وفق التفاصيل والشروط الآتية.',
    defaultConditions: [
      'يُستخدم الترخيص للغرض المبيّن فيه حصراً ولا يجوز التنازل عنه للغير.',
      'يُبرز الترخيص عند طلبه من الجهات الرقابية المختصة.',
      'يُجدَّد الترخيص قبل انتهاء مدة نفاذه.',
    ],
    titleFromService: true,
  },
  {
    id: 'preliminary-approval',
    title: 'موافقة أصولية',
    titleEn: 'PRELIMINARY APPROVAL',
    category: 'APPROVALS',
    family: 'LETTER',
    description: 'كتاب موافقة أصولية (مبدئية) يسمح بالمضي في الإجراءات خلال مدة محددة.',
    fields: [...CORE, 'district', 'location', 'details', 'validity', 'conditions'],
    defaultValidityDays: 90,
    defaultSignerTitle: 'المدير العام',
    holderLabel: 'مقدّم الطلب',
    numberLabel: 'العدد',
    addressee: 'إلى / السيد {holder} المحترم',
    preamble:
      'إشارةً إلى طلبكم المسجّل لدينا بخصوص ({service})، وبعد دراسة الطلب وتدقيق المستمسكات المرفقة به، نعلمكم بحصول الموافقة الأصولية على طلبكم وفق التفاصيل المبيّنة أدناه، على أن تُستكمل بقية الإجراءات القانونية خلال مدة نفاذ هذه الموافقة.',
    closing: 'للتفضل بالاطلاع واتخاذ ما يلزم... مع التقدير.',
    defaultConditions: [
      'لا تُعدّ هذه الموافقة إجازةً نهائية ولا يجوز المباشرة بالتنفيذ قبل صدور الإجازة.',
      'تُعدّ الموافقة ملغاة إذا لم تُستكمل الإجراءات خلال مدة نفاذها.',
    ],
  },
  {
    id: 'technical-approval',
    title: 'كتاب موافقة',
    titleEn: 'APPROVAL LETTER',
    category: 'APPROVALS',
    family: 'LETTER',
    description: 'موافقة فنية أو صحية أو موافقة سلامة (دفاع مدني) أو موافقة قطاعية على طلب.',
    fields: [...CORE, 'district', 'location', 'details', 'validity', 'conditions'],
    defaultValidityDays: 365,
    defaultSignerTitle: 'مدير الدائرة',
    holderLabel: 'مقدّم الطلب',
    numberLabel: 'العدد',
    addressee: 'إلى / السيد {holder} المحترم',
    preamble:
      'إشارةً إلى طلبكم بخصوص ({service})، وبعد إجراء الكشف والتدقيق من قبل اللجنة المختصة في {department}، نود إعلامكم بالموافقة على طلبكم وفق التفاصيل والشروط المبيّنة أدناه.',
    closing: 'للتفضل بالاطلاع... مع التقدير.',
    defaultConditions: [
      'تُعدّ الموافقة نافذة طيلة المدة المحددة فيها ما لم تُلغَ لمخالفة شروطها.',
      'للدائرة حق الكشف الدوري للتأكد من استمرار الالتزام بالشروط.',
    ],
    titleFromService: true,
  },
  {
    id: 'endorsement-letter',
    title: 'كتاب تأييد',
    titleEn: 'LETTER OF ENDORSEMENT',
    category: 'LETTERS',
    family: 'LETTER',
    description: 'تأييد سكن أو إفادة رسمية أو تأييد تخرج أو صحة صدور، موجّه إلى من يهمه الأمر.',
    fields: [...CORE, 'district', 'details', 'validity', 'conditions'],
    defaultValidityDays: 90,
    defaultSignerTitle: 'مدير الدائرة',
    holderLabel: 'اسم المؤيَّد له',
    numberLabel: 'العدد',
    addressee: 'إلى / من يهمه الأمر',
    preamble:
      'نؤيد أن السيد ({holder}) قد راجع {department} بخصوص ({service})، وأن البيانات المثبتة أدناه مطابقة لما هو مسجّل لدينا، وقد زُوّد بهذا الكتاب بناءً على طلبه لتقديمه إلى الجهات المعنية.',
    closing: '...مع التقدير.',
    defaultConditions: ['هذا التأييد لا يُعدّ وثيقة ملكية أو هوية.', 'يُعتمد هذا التأييد لمدة نفاذه فقط.'],
  },
  {
    id: 'certificate',
    title: 'شهادة',
    titleEn: 'CERTIFICATE',
    category: 'CERTIFICATES',
    family: 'CERTIFICATE',
    description: 'شهادة رسمية (لياقة صحية، عدم محكومية، جنسية، تخرج…) بعنوان مأخوذ من الخدمة.',
    fields: [...CORE, 'district', 'details', 'validity', 'conditions'],
    defaultValidityDays: null,
    defaultSignerTitle: 'مدير الدائرة',
    holderLabel: 'اسم صاحب الشهادة',
    numberLabel: 'رقم الشهادة',
    preamble:
      'تشهد {department} بأن المذكور أدناه قد استوفى المتطلبات المقررة لـ ({service})، وقد مُنح هذه الشهادة بناءً على طلبه وفق البيانات المسجلة لدينا.',
    defaultConditions: ['تُعتمد هذه الشهادة عند التحقق من صحتها عبر منصة ذي قار الرقمية.'],
    titleFromService: true,
  },
  {
    id: 'clearance',
    title: 'براءة ذمة',
    titleEn: 'CLEARANCE CERTIFICATE',
    category: 'CERTIFICATES',
    family: 'CERTIFICATE',
    description: 'براءة ذمة ضريبية أو مالية أو رفع إشارة رهن بعد تسديد المستحقات.',
    fields: [...CORE, 'details', 'validity', 'conditions', 'fees'],
    defaultValidityDays: 30,
    defaultSignerTitle: 'مدير الدائرة',
    holderLabel: 'اسم المكلّف',
    numberLabel: 'رقم براءة الذمة',
    preamble:
      'تؤيد {department} أن ذمة المذكور أدناه بريئة من أي مبالغ أو التزامات مستحقة لصالحها لغاية تاريخ صدور هذه البراءة، وذلك لأغراض ({service}).',
    defaultConditions: [
      'تشمل هذه البراءة المستحقات المسجلة لغاية تاريخ صدورها فقط.',
      'تُعدّ البراءة نافذة للمدة المحددة فيها ولمرة استعمال واحدة.',
    ],
  },
  {
    id: 'receipt',
    title: 'وصل استلام',
    titleEn: 'RECEIPT',
    category: 'NOTICES',
    family: 'RECEIPT',
    description: 'وصل استلام معاملة ومستمسكات ورسم مستوفى (A5) يُسلَّم للمواطن.',
    // conditions printed too: its default instruction and any the department sets were silently left out before
    fields: ['holder', 'reference', 'service', 'department', 'details', 'conditions', 'fees', 'signer', 'decision'],
    defaultValidityDays: null,
    defaultSignerTitle: 'موظف الاستلام',
    holderLabel: 'اسم المراجع',
    numberLabel: 'رقم الوصل',
    preamble: 'استلمت {department} المعاملة المبيّنة أدناه مع مستمسكاتها، ويُحفظ هذا الوصل لحين إنجاز المعاملة.',
    defaultConditions: ['يُبرز هذا الوصل عند المراجعة أو الاستلام.'],
  },
  {
    id: 'appointment-notice',
    title: 'إشعار موعد',
    titleEn: 'APPOINTMENT NOTICE',
    category: 'NOTICES',
    family: 'RECEIPT',
    description: 'إشعار بموعد حضور المواطن إلى الدائرة مع التعليمات (A5).',
    fields: ['holder', 'reference', 'service', 'department', 'appointment', 'conditions', 'signer', 'decision'],
    defaultValidityDays: null,
    defaultSignerTitle: 'شعبة المواعيد',
    holderLabel: 'اسم المراجع',
    numberLabel: 'رقم الإشعار',
    preamble: 'يُرجى حضوركم إلى {department} في الموعد المبيّن أدناه لاستكمال إجراءات معاملتكم.',
    defaultConditions: [
      'الحضور قبل الموعد بربع ساعة مع أصول المستمسكات.',
      'يُعدّ الموعد ملغى عند التأخر أكثر من ثلاثين دقيقة.',
    ],
    requiresAppointment: true,
  },
  {
    id: 'rejection-decision',
    title: 'قرار رفض مسبّب',
    titleEn: 'REASONED REJECTION DECISION',
    category: 'APPROVALS',
    family: 'LETTER',
    description: 'كتاب رفض يذكر الأسباب القانونية أو الفنية وحق الاعتراض.',
    fields: [...CORE, 'reason', 'conditions'],
    defaultValidityDays: null,
    defaultSignerTitle: 'مدير الدائرة',
    holderLabel: 'مقدّم الطلب',
    numberLabel: 'العدد',
    addressee: 'إلى / السيد {holder} المحترم',
    preamble:
      'إشارةً إلى طلبكم بخصوص ({service})، نأسف لإعلامكم بتعذّر الموافقة على الطلب للأسباب المبيّنة أدناه، ويمكنكم تقديم طلب جديد بعد معالجتها.',
    closing: '...مع التقدير.',
    defaultConditions: ['يحق لكم الاعتراض على هذا القرار خلال (30) يوماً من تاريخ التبليغ به عبر المنصة.'],
    // documents are issued on approval only: a rejection letter assigned to a service would be printed on approvals
    issuable: false,
  },
  {
    id: 'referral-letter',
    title: 'كتاب إحالة',
    titleEn: 'REFERRAL LETTER',
    category: 'LETTERS',
    family: 'LETTER',
    description: 'إحالة المعاملة أو المواطن إلى دائرة أخرى مختصة لاستكمال الإجراء.',
    fields: [...CORE, 'referral', 'details', 'validity', 'conditions'],
    defaultValidityDays: 60,
    defaultSignerTitle: 'مدير الدائرة',
    holderLabel: 'صاحب المعاملة',
    numberLabel: 'العدد',
    addressee: 'إلى / {referral} المحترمين',
    preamble:
      'نحيل إليكم معاملة السيد ({holder}) الخاصة بـ ({service}) لاختصاصكم، بعد استكمال ما يخص دائرتنا من إجراءات، راجين التفضل بإكمال اللازم وإعلام صاحب العلاقة.',
    closing: '...مع التقدير.',
    defaultConditions: ['تُرفق مع هذا الكتاب أوليات المعاملة المحفوظة في الأرشيف الإلكتروني.'],
  },
  {
    id: 'allocation-decision',
    title: 'قرار تخصيص',
    titleEn: 'ALLOCATION DECISION',
    category: 'APPROVALS',
    family: 'LETTER',
    description: 'قرار تخصيص قطعة أرض أو وحدة سكنية أو قطعة دفن أو حصة.',
    fields: [...CORE, 'district', 'location', 'details', 'conditions', 'fees'],
    defaultValidityDays: null,
    defaultSignerTitle: 'المحافظ أو من يخوّله',
    holderLabel: 'المخصَّص له',
    numberLabel: 'رقم القرار',
    addressee: 'إلى / السيد {holder} المحترم',
    preamble:
      'استناداً إلى الصلاحيات المخوّلة لنا وتوصيات اللجنة المختصة بخصوص ({service})، تقرر تخصيص ما مبيّن أدناه لصالحكم وفق الشروط المذكورة في هذا القرار.',
    closing: 'للتفضل بالاطلاع... مع التقدير.',
    defaultConditions: [
      'لا يجوز التصرف بالمخصَّص بيعاً أو تنازلاً قبل استكمال إجراءات التسجيل.',
      'يُلغى التخصيص عند ثبوت عدم صحة المعلومات المقدّمة.',
    ],
  },
  {
    id: 'completion-notice',
    title: 'إشعار إنجاز معاملة',
    titleEn: 'TRANSACTION COMPLETION NOTICE',
    category: 'LETTERS',
    family: 'LETTER',
    description: 'القالب الافتراضي: إشعار رسمي بإنجاز المعاملة والموافقة عليها.',
    fields: [...CORE, 'district', 'details', 'conditions', 'fees'],
    defaultValidityDays: null,
    defaultSignerTitle: 'مدير الدائرة',
    holderLabel: 'صاحب المعاملة',
    numberLabel: 'العدد',
    addressee: 'إلى / السيد {holder} المحترم',
    preamble:
      'نعلمكم بإنجاز معاملتكم الخاصة بـ ({service}) لدى {department} والموافقة عليها بعد تدقيق المستمسكات المطلوبة، وفق التفاصيل المبيّنة أدناه.',
    closing: 'للتفضل بالاطلاع... مع التقدير.',
    defaultConditions: ['تُستكمل أي آثار قانونية أو تنظيمية وفق صلاحيات وتعليمات الجهة المختصة.'],
  },
  {
    id: 'id-card',
    title: 'بطاقة تعريفية',
    titleEn: 'IDENTIFICATION CARD',
    category: 'CARDS',
    family: 'CARD',
    description: 'بطاقة بحجم الهوية (عضوية، ممارسة، تعريف) بوجهين ورمز تحقق.',
    fields: ['holder', 'nationalId', 'department', 'details', 'validity', 'conditions', 'decision'],
    defaultValidityDays: 365,
    defaultSignerTitle: 'مدير الدائرة',
    holderLabel: 'الاسم',
    numberLabel: 'رقم البطاقة',
    preamble: 'بطاقة تعريفية صادرة عن {department}.',
    defaultConditions: [
      'البطاقة شخصية ولا يجوز استعمالها من قبل الغير.',
      'تُعاد البطاقة إلى الدائرة المصدرة عند انتهاء نفاذها أو إلغائها.',
    ],
  },
]

export const templateById = new Map(documentTemplates.map(item => [item.id, item]))
export const DEFAULT_TEMPLATE_ID = 'completion-notice'

export function getTemplate(id: string | null | undefined) {
  return (id && templateById.get(id)) || (templateById.get(DEFAULT_TEMPLATE_ID) as DocumentTemplate)
}

/** Whether a template may be issued on approval (and therefore assigned to a service). */
export const isIssuableTemplate = (template: DocumentTemplate) => template.issuable !== false

/**
 * Templates that state a legal outcome no service name can establish — an allocation («تقرر تخصيص…»), a clearance
 * of debts («ذمة المذكور بريئة…») or an appointment — are never inferred from keywords. Only the catalog services
 * listed here get them by default; any other service reaches them only through an explicit assignment by its
 * department (manager or super admin).
 */
export const EXPLICIT_DEFAULT_TEMPLATES: Readonly<Record<string, string>> = {
  // the approved request *is* the allocation
  'muni-dir-industrial-land-allocation': 'allocation-decision',
  'muni-dir-cemetery-plot': 'allocation-decision',
  // the issuing department certifies that nothing is owed to it
  'tax-clearance': 'clearance',
  'tax-shatrah-clearance': 'clearance',
  'tax-vehicle-clearance': 'clearance',
  'hf-clearance': 'clearance',
  // attendance bookings (APPOINTMENT_REQUIRED: always approved with a slot)
  'nid-first-issue': 'appointment-notice',
  'civ-national-id-booking': 'appointment-notice',
  'shat-civ-national-id': 'appointment-notice',
  'health-disability-committee': 'appointment-notice',
  'health-medical-committee-booking': 'appointment-notice',
  'museum-group-visit': 'appointment-notice',
}

/** Templates only ever reached through EXPLICIT_DEFAULT_TEMPLATES or an assignment, never through keywords. */
export const EXPLICIT_ONLY_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  'allocation-decision',
  'clearance',
  'appointment-notice',
  'rejection-decision',
  'referral-letter',
])

/**
 * Default template of a catalog service: the explicit list above, then keyword rules for the remaining templates,
 * ordered from the most specific to the most generic. Anything ambiguous gets the completion notice, which states
 * only that the request was completed and approved.
 */
export function inferTemplateId(service: { key: string; title: string; category?: string | null }) {
  const title = (service.title || '').trim()
  const key = service.key || ''
  const explicit = EXPLICIT_DEFAULT_TEMPLATES[key]
  if (explicit) return explicit
  const text = `${title} ${key}`
  // inquiries, "no-benefit" statements, boundary inspections, instalment plans and loans: approving them completes
  // a transaction; it does not license, certify, endorse or allocate anything
  if (/استعلام|بيان عدم|تثبيت حدود|تقسيط|قرض|inquiry|enquiry|installment|instalment|loan|boundary/i.test(text))
    return DEFAULT_TEMPLATE_ID
  // the title says what the department actually issues: an endorsement or an approval, even when it mentions a
  // licence it supports ("تأييد لفتح عيادة", "الموافقة الصحية لفتح … إجازة محل")
  if (/^(طلب )?(كتاب )?تأييد/.test(title)) return 'endorsement-letter'
  if (/^(طلب )?(ال)?موافقة/.test(title))
    return /(ال)?موافقة (ال)?(مبدئية|تخطيطية|أصولية)/.test(title) ? 'preliminary-approval' : 'technical-approval'
  if (/فتح محل|إجازة محل|shop-licen/i.test(text)) return 'shop-licence'
  if (/ممارسة مهنة|profession-licen/i.test(text)) return 'profession-licence'
  if (/ترميم|إضافة بناء|renovation/i.test(text)) return 'renovation-permit'
  if (/إجازة بناء|بناء دار|بناء جديد|building-permit/i.test(text)) return 'building-permit'
  if (/هوية|بطاقة (عضوية|تعريفية|ممارسة)|membership/i.test(text) && !/البطاقة (الوطنية|التموينية)/.test(title))
    return 'id-card'
  if (/^(طلب )?(إجازة|ترخيص)/.test(title) || /licen[cs]e|permit/i.test(key)) return 'general-licence'
  if (/موافقة (مبدئية|تخطيطية|أصولية)|preliminary|planning-approval/i.test(text)) return 'preliminary-approval'
  if (/^(طلب )?(إصدار )?شهادة|certificate/i.test(text)) return 'certificate'
  if (/موافقة|كتاب سلامة|approval|safety/i.test(text)) return 'technical-approval'
  // «بيان» as a word (a statement), not inside «بيانات» ("تحديث بيانات…" is a data update, not a statement)
  if (
    /تأييد|إفادة|تصديق|صحة صدور|وثيقة تخرج|صورة قيد|(?<![؀-ۿ])بيان(?![؀-ۿ])|statement|confirmation|verification/i.test(
      text
    )
  )
    return 'endorsement-letter'
  return DEFAULT_TEMPLATE_ID
}

export const DOCUMENT_TITLE_MAX = 90

/** A title never ends on one of these: a cut there leaves a dangling phrase («موافقة نقل الأثاث من»). */
export const DANGLING_TITLE_WORDS: ReadonlySet<string> = new Set(
  'من إلى الى في على عن مع ل لـ ب بـ و أو او حتى ضمن بين لدى عند نحو خلال عبر حول منذ قبل بعد'.split(' ')
)

/** «شهادة» and «الشهادة» are the same word: printed one after the other they read «شهادة الشهادة». */
const sameTitleWord = (a: string, b: string) =>
  a === b || (a.length > 2 && b.length > 2 && a.replace(/^ال/, '') === b.replace(/^ال/, ''))

/** Words a service title opens with that name the citizen's request, not the document («طلب إصدار …»). */
const REQUEST_LEAD = /^(طلب|إصدار|اصدار|التقديم على|تقديم|تجديد|الحصول على)(\s+|$)/

const titleWords = (text: string) => text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)

/** Drops an immediately repeated word, keeping the later form («شهادة الشهادة الصحية» → «الشهادة الصحية»). */
function dedupeTitleWords(text: string) {
  const out: string[] = []
  for (const word of titleWords(text)) {
    if (out.length && sameTitleWord(out[out.length - 1], word)) out[out.length - 1] = word
    else out.push(word)
  }
  return out.join(' ')
}

const endsDangling = (text: string) => {
  const words = titleWords(text)
  return !words.length || DANGLING_TITLE_WORDS.has(words[words.length - 1]) || /[،,:;/\-—–(]$/.test(text.trim())
}

/**
 * Fits a title into DOCUMENT_TITLE_MAX characters at a word boundary, never ending on a preposition, conjunction or
 * separator. Returns '' when nothing sensible is left (the caller falls back).
 */
function clipTitle(text: string, max = DOCUMENT_TITLE_MAX) {
  let words = titleWords(text)
  while (words.length && words.join(' ').length > max) words = words.slice(0, -1)
  while (words.length && (DANGLING_TITLE_WORDS.has(words[words.length - 1]) || /^[،,:;/\-—–]+$/.test(words.at(-1)!)))
    words = words.slice(0, -1)
  return words.join(' ').replace(/[\s،,:;/\-—–]+$/, '')
}

/**
 * The document name a service title carries: parentheticals dropped («(داخلية)», «(فتح / تجديد)»), the request
 * words in front removed, and an alternative written with a slash inside one phrase read as such («من/إلى» → «من
 * وإلى», «تجاري/غذائي» → «تجاري أو غذائي») instead of being cut there. `firstPart` keeps only the first of the
 * alternatives a spaced separator lists («إجازة حفر بئر مائي / إجازة مقاول حفر آبار»).
 */
function serviceDocumentName(serviceTitle: string, firstPart: boolean) {
  let text = serviceTitle
    .replace(/\([^()]*\)/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/(^|\s)من\s*\/\s*(إلى|الى)(?=\s|$)/g, '$1من وإلى')
    .replace(/\s+/g, ' ')
    .trim()
  if (firstPart) text = text.split(/\s[/|—–-]\s/)[0]
  text = text.replace(/\s*\/\s*/g, ' أو ').replace(/\s+[|—–-]\s+/g, ' — ')
  for (let previous = ''; previous !== text;) {
    previous = text
    text = text.replace(REQUEST_LEAD, '').trim()
  }
  return dedupeTitleWords(text)
}

/** Template-specific framing of a service-derived name, without repeating its first word. */
function framedTitle(template: DocumentTemplate, name: string) {
  if (template.id === 'technical-approval' && !/^((ال)?موافقة|كتاب)(\s|$)/.test(name)) return `كتاب موافقة — ${name}`
  if (template.id === 'certificate' && !/^(ال)?شهادة(\s|$)/.test(name)) return dedupeTitleWords(`شهادة ${name}`)
  return name
}

/**
 * Title printed on a document: the department's custom title, else the template's, or — for the generic templates —
 * the name the service title carries. A derived title is never cut mid-phrase: when the first alternative of the
 * service title would end on a preposition it falls back to the whole service title, then to the template's title.
 */
export function documentTitleFor(template: DocumentTemplate, serviceTitle: string, customTitle?: string | null) {
  const custom = clipTitle(customTitle || '')
  if (custom) return custom
  if (!template.titleFromService || !serviceTitle?.trim()) return template.title
  for (const firstPart of [true, false]) {
    const name = serviceDocumentName(serviceTitle, firstPart)
    if (!name || endsDangling(name)) continue
    const title = framedTitle(template, name)
    const clipped = clipTitle(title)
    // a clip that dropped words must still leave a usable title (more than the framing word)
    if (clipped && (clipped === title || titleWords(clipped).length >= 2)) return clipped
  }
  return template.title
}
