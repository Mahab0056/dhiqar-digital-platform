# نشر ذي قار الرقمية على Render

يحتوي المستودع على ملف [`render.yaml`](./render.yaml) الذي يعرّف خدمة ويب Node واحدة في منطقة **Frankfurt** مع قرص دائم سعة 1GB وفحص صحة على `/api/health`.

> يتطلب القرص الدائم خدمة Render مدفوعة. لا تعتمد النسخة الدائمة على نظام الملفات المؤقت، لأن تغييرات النظام المؤقت تضيع عند إعادة التشغيل أو إعادة النشر.

## الإعداد المعتمد

| الإعداد | القيمة |
|---|---|
| Runtime | Node |
| Region | Frankfurt |
| Plan | Starter |
| Branch | `main` |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm build` |
| Start | `pnpm start` |
| Health Check | `/api/health` |
| Database Path | `/var/data/dhiqar-demo.sqlite` |
| Disk | `dhiqar-digital-data` — 1GB |
| Auto Deploy | كل Commit على `main` |

## لماذا يوجد قرص دائم؟

تستخدم النسخة الحالية SQLite. يقرأ الخادم مسار القاعدة من المتغير `DATABASE_PATH`. في Render يضبط Blueprint المسار إلى `/var/data/dhiqar-demo.sqlite`، ويُركّب القرص الدائم عند `/var/data`، لذلك تبقى المعاملات وسجل التدقيق بعد إعادة التشغيل أو النشر.

## النشر عبر Blueprint

1. افتح Render Dashboard.
2. اختر **New → Blueprint**.
3. اربط المستودع الخاص `Mahab0056/dhiqar-digital-platform`.
4. اترك مسار Blueprint الافتراضي `render.yaml`.
5. راجع مورد Web Service والقرص الدائم ثم وافق على الخطة.
6. انتظر اكتمال البناء وتحقق من `/api/health`.

## التحديثات اللاحقة

أي Push جديد إلى `main` يبدأ Deploy تلقائياً. إذا فشل البناء، يحتفظ Render بآخر نسخة ناجحة. اختبر محلياً قبل الدفع:

```bash
pnpm lint
pnpm build
```

## قاعدة البيانات والنسخ الاحتياطي

SQLite في هذه النسخة مناسبة لعرض دائم بمثيل واحد وحجم استخدام أولي. القرص الدائم يمنع توسيع الخدمة إلى أكثر من Instance واحد، لذلك عند الانتقال إلى تشغيل حكومي واسع يجب ترحيل الجداول إلى PostgreSQL وإجراء نسخ احتياطية واختبارات استرجاع رسمية.

قبل أي ترقية كبيرة، نفّذ SQLite checkpoint ثم احتفظ بنسخة من الملف:

```bash
node server/checkpoint-db.mjs
cp /var/data/dhiqar-demo.sqlite /var/data/dhiqar-demo.backup.sqlite
```

## مراجع رسمية

- [Render: Deploy a Node Express App](https://render.com/docs/deploy-node-express-app)
- [Render: Persistent Disks](https://render.com/docs/disks)
- [Render: Blueprint YAML Reference](https://render.com/docs/blueprint-spec)
