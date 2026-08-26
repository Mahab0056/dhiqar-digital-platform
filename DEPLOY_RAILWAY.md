# إدارة الموقع الدائم — Railway

## الرابط النشط

| المورد | الرابط / الاسم |
|---|---|
| الموقع الدائم | https://dhiqar-digital-platform-production.up.railway.app |
| المستودع الخاص | https://github.com/Mahab0056/dhiqar-digital-platform |
| مشروع Railway | `fabulous-laughter` |
| الخدمة | `dhiqar-digital-platform` |
| البيئة | `production` — EU West |

## ما الذي تم إعداده؟

الموقع يعمل كخدمة **Node/Express + React** مع HTTPS من Railway. ترتبط الخدمة بالمستودع الخاص على GitHub، لذلك يبدأ نشر جديد تلقائياً عند دفع Commit إلى فرع `main`.

تستخدم المنصة SQLite للنسخة التجريبية الدائمة. تم ربطها بـRailway Volume، ويقرأ الخادم المسار من `RAILWAY_VOLUME_MOUNT_PATH` تلقائياً. هذا يمنع ضياع المعاملات والوثائق التجريبية عند نشر نسخة جديدة أو إعادة تشغيل الخدمة.

> **تنبيه تشغيلي:** الموقع نسخة عرض دائمة ببيانات صناعية. ليس متصلاً بمنظومات حكومية أو دفع فعلي أو تحقق بيومتري أو توقيع رسمي.

## تحديث الموقع

استخدم مسار GitHub المعتاد. يجب فحص التطبيق أولاً، ثم دفع التغييرات إلى الفرع الرئيسي:

```bash
pnpm lint
pnpm build
git add .
git commit -m "Describe change"
git push origin main
```

راقب نتيجة النشر من Railway عبر مشروع `fabulous-laughter` ثم خدمة `dhiqar-digital-platform`. يجب أن تصبح الحالة **Active / Online** قبل اعتبار التحديث جاهزاً.

## قاعدة البيانات والنسخ الاحتياطي

قاعدة البيانات تحفظ تحت Railway Volume. قبل أي تغيير كبير في نموذج البيانات أو الكود، أنشئ نسخة احتياطية من قسم **Backups** في Railway. عند انتقال المنصة إلى تشغيل حكومي فعلي متعدد المستخدمين، يجب نقل البيانات إلى PostgreSQL مُدار وإضافة مصادقة فعلية وتشفير ومراجعات صلاحيات رسمية.

## ربط نطاق مخصص لاحقاً

الرابط الحالي ثابت ودائم من Railway. إذا توفر نطاق مثل `digital.dhiqar.gov.iq` أو نطاق الشركة، افتح **Settings → Networking → Custom Domain** في Railway، أضف النطاق، ثم حدّث سجل DNS بالقيمة التي يعرضها Railway. لا تغيّر سجلات DNS قبل امتلاك صلاحية إدارة النطاق.

## التحقق التشغيلي المنفذ

تم التحقق من الصفحة الرئيسية، وواجهة الصحة، وبوابة المواطن، وبوابة الموظف، وإرسال معاملة تجريبية، والموافقة، وإصدار وثيقة وQR، وصفحة التحقق العامة. وتم التحقق لاحقاً من بقاء السجل `TQD-2026-0001` والوثيقة `LIC-2026-00001` بعد إعادة النشر.

## مراجع الإدارة

- [Railway: Volumes](https://docs.railway.com/guides/volumes)
- [Railway: Custom Domains](https://docs.railway.com/guides/public-networking)
- [Railway: Deployments](https://docs.railway.com/guides/deployments)
