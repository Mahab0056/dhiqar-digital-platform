# معمارية ذي قار الرقمية — النسخة التجريبية والمسار الإنتاجي

## 1. نطاق الحزمة الحالية

الحزمة الحالية **Modular Full-Stack Demo** تعمل كتطبيق React واحد مع خادم Express وقاعدة SQLite. اختير هذا الشكل حتى تكون النسخة قابلة للنقل وسهلة التشغيل وتنفذ رحلة حقيقية مترابطة، من دون ادعاء أنها البنية النهائية لمحافظة تضم ملايين المستخدمين.

| الطبقة | التنفيذ الحالي |
|---|---|
| واجهة المواطن | React + TypeScript + RTL + Mobile First |
| واجهة الموظف | قائمة عمل وإجراءات حسب حالة المعاملة |
| القيادة | غرفة عمليات ولوحة محافظ وGIS تجريبي |
| API | Express JSON API |
| قاعدة البيانات | SQLite مع Foreign Keys وWAL |
| سير العمل | حالات انتقال محددة داخل API مع أحداث مستقلة |
| الوثائق | قالب عربي + توليد PDF في المتصفح + QR |
| التدقيق | جدول Audit Logs مستقل لا تعرض له عمليات حذف |
| التخزين | أسماء مرفقات تجريبية فقط؛ لا توجد ملفات حساسة حقيقية |

## 2. تدفق السيناريو المنفذ

```text
Phone OTP Demo
  → Document Capture Demo
  → OCR Review + Confidence
  → Consent + Liveness Demo
  → Verified Citizen Profile
  → Store License Form
  → Application Submission
  → Department Queue
  → Employee Requests Missing Document
  → Citizen Uploads Document
  → Employee Approval
  → Payment Record
  → Document Number + Verification ID
  → QR Verification Page
  → Operations KPIs
  → Audit Trail
```

كل انتقال يحدّث حالة المعاملة ويضيف حدثاً زمنياً، وتُسجل الإجراءات الحساسة في جدول تدقيق منفصل.

## 3. حالات المعاملة

| الحالة | المعنى |
|---|---|
| `SUBMITTED` | استلم النظام الطلب ووجهه للدائرة |
| `UNDER_REVIEW` | المعاملة لدى الموظف بعد التقديم أو الاستكمال |
| `ACTION_REQUIRED` | يوجد مستند أو معلومات مطلوبة من المواطن |
| `APPROVED` | تمت الموافقة وسُجل الدفع وأُصدرت الوثيقة |
| `REJECTED` | محجوزة للرفض المسبب في المرحلة التالية |

لا تسمح واجهة الموظف بالموافقة عندما تكون الحالة `ACTION_REQUIRED`. كما تمنع الموافقة المكررة بعد `APPROVED`.

## 4. نموذج الأمان في العرض

هذه النسخة لا تحتوي بيانات إنتاجية، لكنها تطبق مبادئ توضيحية مهمة:

| الضابط | التطبيق |
|---|---|
| تقليل البيانات | الرقم الوطني مقنّع في بوابة الموظف |
| الموافقة | لا تكتمل مرحلة الوجه قبل موافقة صريحة |
| القرار البشري | التحقق التجريبي لا يصدر رفضاً حكومياً نهائياً |
| فصل البوابات | صفحات المواطن والموظف والعمليات مستقلة |
| التدقيق | المشاهدات والقرارات وتغيير الحالات مسجلة |
| الدفع | لا يوجد حذف من الواجهة؛ يسجل الدفع عند الموافقة |
| التحقق العام | صفحة QR تعرض بيانات الوثيقة الضرورية فقط |
| البيانات البيومترية | لا يتم تخزين فيديو أو قالب بيومتري فعلي |

## 5. البنية الإنتاجية المقترحة

عند الانتقال إلى مشروع حكومي فعلي، يجب تفكيك النسخة إلى خدمات ذات حدود أمنية وتشغيلية واضحة:

| الخدمة | المسؤولية |
|---|---|
| Identity Gateway | OTP، الهوية الرسمية، الجلسات والمصادقة |
| Biometric Verification Service | الموافقة والحيوية والمطابقة والاحتفاظ المنفصل |
| Citizen Profile Service | ملف المواطن والبيانات الموثقة والحد الأدنى من العرض |
| Service Catalog | الخدمات والقواعد والمتطلبات والرسوم |
| Dynamic Forms Engine | الحقول الشرطية والتحقق والتعبئة التلقائية |
| Workflow Engine | الحالات والتوجيه والمهام وSLA والتصعيد |
| Document Service | القوالب والتوقيع وPDF وQR والتحقق |
| Payments Ledger | الفواتير والعمليات والتسوية والانعكاسات |
| Notifications | SMS والبريد والإشعارات والقوالب |
| GIS Platform | الطبقات الرسمية والمواقع والتوأم الرقمي |
| Audit Service | سجل مركزي غير قابل للتعديل وسياسات الاحتفاظ |
| Reporting Platform | KPIs وBI والتجميع دون كشف البيانات الشخصية |
| Integration Gateway | الجهات الحكومية والمصارف والمزودون الخارجيون |

## 6. حدود البيانات الإنتاجية

يفضل فصل البيانات إلى نطاقات على مستوى قواعد البيانات ومفاتيح التشفير والسياسات:

```text
Operational Data
  ├── Services / Applications / Workflows
  ├── Departments / Employees / Roles
  └── Aggregated Reporting

Sensitive Identity Vault
  ├── National IDs
  ├── Identity Document Images
  └── Verification Evidence

Biometric Vault
  ├── Face Images (only if legally required)
  ├── Biometric Templates
  └── Consent + Retention Metadata

Financial Ledger
  ├── Invoices
  ├── Payments
  ├── Reversals / Adjustments
  └── Reconciliation
```

لا يجب أن يستطيع موظف الخدمة العادي الوصول إلى مخزن الهوية أو البيومتريات أو تفاصيل الدفع الكاملة.

## 7. التوسع والأداء

| المشكلة | المعالجة الإنتاجية |
|---|---|
| ملايين المواطنين | قاعدة علائقية عالية التوفر وتقسيم وRead Replicas عند الحاجة |
| آلاف الموظفين | IAM مركزي، جلسات موزعة، RBAC + ABAC |
| معالجة OCR/PDF | Queues وWorkers منفصلة |
| الملفات | Object Storage وروابط مؤقتة وفحص Malware |
| البحث | Search Index للخدمات والمعاملات المسموح بها |
| التقارير | مستودع تحليلي منفصل عن قاعدة التشغيل |
| GIS | Vector Tiles وطبقات مكانية وتصفية حسب الصلاحية |
| المراقبة | Metrics، Logs، Traces، Alerts وSLOs |
| التعافي | نسخ مشفرة، Point-in-Time Recovery، موقع DR واختبارات دورية |

## 8. التكاملات الحقيقية

كل تكامل خارجي يجب أن يكون Adapter مستقلاً خلف Integration Gateway. إذا لم يكن مزود الخدمة الرسمي متاحاً، تعرض المنصة الحالة بوضوح كـ`PENDING_VERIFICATION` أو `MANUAL_REVIEW` ولا تستخدم كلمة «موثق حكومياً».

```text
Platform Core
  → Integration Gateway
      → National Identity Adapter
      → SMS Adapter
      → Payment Adapter
      → Digital Signature Adapter
      → Government Registry Adapters
      → GIS Provider Adapter
      → Camera Streaming Gateway
```

## 9. خطة التنفيذ العملية التالية

| المرحلة | الأولوية |
|---|---|
| اعتماد الهوية البصرية التقنية والملفات الأصلية | فورية |
| تحليل قانوني وخصوصية وتصنيف البيانات | فورية |
| اختيار IAM وOTP وIdentity Provider | فورية |
| تحويل SQLite إلى PostgreSQL/MySQL إنتاجية | عالية |
| فصل Workflow وDocuments وPayments | عالية |
| إضافة Dynamic Service Builder وForm Builder | عالية |
| ربط مزود تخزين وفحص ملفات | عالية |
| اعتماد بيانات GIS الرسمية | متوسطة |
| التكامل مع سجل الهوية والدفع | حسب الموافقات الرسمية |
| تدقيق أمني واختبارات تحميل وتعافي | شرط قبل الإطلاق |

هذه الوثيقة تميّز بوضوح بين **ما يعمل الآن كعرض وظيفي** وبين **ما يلزم لبنية حكومية إنتاجية**، حتى لا تتحول النسخة التجريبية إلى مصدر توقعات أمنية أو قانونية غير صحيحة.
