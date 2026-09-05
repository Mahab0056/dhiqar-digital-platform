# ذي قار الرقمية — THI QAR DIGITAL

منصة حكومية رقمية لمحافظة ذي قار: بوابة المواطن، بوابة الموظف، لوحات الدوائر، غرفة العمليات، لوحة المحافظ، الوثائق الرقمية القابلة للتحقق، وسجل تدقيق كامل. عربية، RTL، متجاوبة.

> **الحالة:** نسخة **pilot-ready** من الناحية البرمجية (حسابات موظفين حقيقية، MFA، جلسات قابلة للإلغاء، اختبارات، CI، نسخ احتياطي). لا يزال ربط البطاقة الوطنية، بوابة الدفع، وKYC الرسمي بحاجة إلى عقود واعتمادات حكومية — انظر [`ARCHITECTURE.md`](./ARCHITECTURE.md) و[`docs/DATABASE.md`](./docs/DATABASE.md).

## ما الذي تقدمه المنصة

| الوحدة | الوصف |
|---|---|
| البوابة العامة | دليل **370+ خدمة** من 80 جهة (`/directory`) مع المستمسكات المطلوبة وطريقة التقديم ومصدر كل خدمة، دليل الجهات (`/departments`) مع المصادر والمواقع الموثقة |
| بوابة المواطن | OTP، التقاط الهوية، مراجعة OCR، توثيق الوجه، **التقديم على أي خدمة إلكترونياً مع رفع كل مستمسك على حدة**، متابعة القرار وإعادة رفع النواقص، الوثائق، الشكاوى، الإشعارات الفورية |
| بوابة الموظف | قائمة عمل **مقيدة بدائرة الموظف**، تدقيق كل مستمسك (صحيح/غير مقبول مع السبب)، إعادة للمواطن، **موافقة (لا تُقبل قبل تدقيق كل المستمسكات المطلوبة) وإصدار وثيقة**، تحديد موعد الحضور للخدمات التي تتطلب حضوراً، رفض مسبب، مراجعة الهوية، الشكاوى |
| لوحة الدائرة | لكل دائرة لوحة خاصة (`/department/:id`): المؤشرات، تدفق 14 يوماً، المعاملات، الفريق المتصل، الخدمات، الشكاوى، سجل الإجراءات |
| غرفة العمليات / المحافظ | KPIs، خريطة GIS للجهات الموثقة، صحة النظام، أداء الدوائر |
| إدارة المنصة | حسابات الموظفين والصلاحيات، الدوائر، الخدمات، سجل التدقيق، حالة قاعدة البيانات والنسخ الاحتياطي |
| الأمان | حساب لكل موظف (scrypt)، MFA (TOTP)، قفل بعد 5 محاولات، جلسات من السيرفر قابلة للإلغاء، سجل تدقيق باسم الفاعل الحقيقي |

## كتالوج الخدمات وخط التقديم

- السجل: `server/registry/dhiqar-services.json` (355 خدمة مجمّعة من المواقع الرسمية وبوابة أور والمصادر العامة) + خدمات المنصة الخاصة في `src/service-forms.ts`. يُزرع الاثنان في جدول `service_catalog` عند الإقلاع (`server/services/catalog.ts`).
- لكل خدمة: الجهة، القطاع، طريقة التقديم (`ONLINE_SUBMISSION` / `APPOINTMENT_REQUIRED` / `INFORMATION_ONLY`)، الحقول، المستمسكات (مفتاح + إلزامي/اختياري + صورة/PDF)، الرسوم **فقط إن كانت موثقة بمصدر رسمي**، وجودة المصدر (`OFFICIAL` / `RELIABLE` / `UNVERIFIED` — تظهر للمواطن بوسم «بانتظار تأكيد الدائرة»).
- المسار: المواطن الموثق يرفع المستمسكات داخل الاستمارة (`doc__<key>`) + فيديو الوجه → `service_requests.document_checklist` → قائمة دائرة الموظف → تدقيق كل مستمسك → قرار. الواجهات: `GET /api/services`, `GET /api/services/:key`, `POST /api/service-requests`, `PATCH /api/employee/service-requests/:ref/documents/:key`, `PATCH /api/employee/service-requests/:ref`.
- تعديل الخدمات: عدّل ملف السجل ثم أعد التشغيل (upsert). لا تُخترع رسوم أو مدد؛ اترك `feeIqd: null` بلا مصدر.

## التشغيل المحلي

يتطلب **Node.js 22+** و**pnpm**.

```bash
cp .env.example .env      # عدّل القيم (OTP_DEV_MODE=true يكفي محلياً)
pnpm install
pnpm dev                  # الواجهة على 5173 + API على 8787
```

عند أول إقلاع بجدول موظفين فارغ يُنشأ حساب المدير العام من `STAFF_BOOTSTRAP_USERNAME/PASSWORD` ويُطلب تغيير كلمة المرور في أول دخول.

| البوابة | المسار |
|---|---|
| المواطن | `/onboarding` — في وضع التطوير رمز OTP الثابت `246810` |
| الموظفون (كل الأدوار) | `/staff/login` |
| لوحة الدائرة | `/department/<id>` (لموظفي الدائرة، غرفة العمليات، والمدير العام) |
| الأمان والحساب | `/staff/security` (كلمة المرور، MFA، الجلسات) |
| دليل الدوائر | `/departments` |

## الجودة

```bash
pnpm check        # lint + typecheck (واجهة + سيرفر) + tests
pnpm test         # vitest + supertest: المصادقة، الصلاحيات، MFA، OTP، سير المعاملة، الرفض، خط الخدمات (مستمسكات/تدقيق/نطاق الدائرة)
pnpm build        # typecheck ثم vite build
```

GitHub Actions (`.github/workflows/ci.yml`) يشغّل lint/format/typecheck/test/build على كل push وPR.

## الإنتاج

```bash
pnpm build && pnpm start
```

المتغيرات المطلوبة في الإنتاج: `SESSION_SECRET`, `MEDIA_ENCRYPTION_KEY`, `OTP_HASH_SECRET`, `STAFF_BOOTSTRAP_*` (لأول مرة فقط)، `OTPIQ_API_KEY`، و`PUBLIC_BASE_URL`. تفاصيل النشر: [`docs/DEPLOY_RAILWAY.md`](./docs/DEPLOY_RAILWAY.md).

## هيكل المشروع

```text
src/
  pages/          صفحات: public, auth, citizen, services, employee, department, operations, super-admin, verify, staff
  components/     مكونات مشتركة (PortalLayout, SecureCameraCapture, maps, ...)
  lib/session.ts  حالة الجلسة المشتركة
  api.ts          عميل API مكتوب بالأنواع
server/
  create-server.ts   تركيب التطبيق (يُستخدم في الاختبارات أيضاً)
  http/              app factory, upload, rate-limit, error handler
  auth/              session, staff accounts, password (scrypt), totp
  routes/            auth, staff-admin, departments, applications, onboarding, documents, ...
  departments.ts     لوحات الدوائر وسجل الدوائر
  registry/dhiqar-departments.json   سجل 80 جهة مع المصادر
  registry/dhiqar-services.json      سجل 355 خدمة (مستمسكات، حقول، مصادر)
  services/catalog.ts                زرع الكتالوج والاستعلام عنه
  db.ts              المخطط وطبقة البيانات (SQLite)
  db-ops/backup.ts   النسخ الاحتياطي والسلامة
tests/               اختبارات API
docs/                التوثيق، البحث، وسجل QA التاريخي
```

## التوثيق

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — المعمارية، نموذج الأمان، المسار الإنتاجي
- [`docs/DATABASE.md`](./docs/DATABASE.md) — النسخ الاحتياطي، الاسترجاع، مسار PostgreSQL
- [`docs/research/dhiqar-departments-sources.md`](./docs/research/dhiqar-departments-sources.md) — مصادر سجل الدوائر
- [`docs/history/`](./docs/history/) — تقارير QA والقرارات السابقة

---

الهوية البصرية من ملف الهوية الرسمي؛ حقوق الأصول في [`ASSET_CREDITS.md`](./ASSET_CREDITS.md).
