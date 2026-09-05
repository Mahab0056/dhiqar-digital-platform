# قاعدة البيانات — التشغيل والنسخ الاحتياطي ومسار PostgreSQL

## الوضع الحالي

المنصة تعمل على **SQLite (node:sqlite) في وضع WAL** مع Foreign Keys. الملف يُحفظ على Railway Volume (أو `DATABASE_PATH`).

هذا مناسب لمرحلة **pilot بدائرة واحدة أو عدة دوائر** (آلاف المعاملات يومياً، عشرات الموظفين المتزامنين) بشرط
أن يبقى السيرفر نسخة واحدة (replica واحدة). ليس مناسباً لتشغيل متعدد النسخ أو لملايين المستخدمين.

## ما أُضيف لجعل SQLite صالحاً للتشغيل

| الآلية | التفاصيل |
|---|---|
| نسخ احتياطي تلقائي | `VACUUM INTO` عند الإقلاع ثم كل `BACKUP_INTERVAL_HOURS` (افتراضي 6 ساعات) إلى `BACKUP_DIR` |
| احتفاظ | تُحذف النسخ الأقدم من `BACKUP_RETENTION_DAYS` (14) مع الإبقاء على `BACKUP_MIN_KEEP` (7) على الأقل |
| فحص السلامة | `PRAGMA integrity_check` عند كل إقلاع، ويظهر في لوحة المدير العام |
| نسخة يدوية | من لوحة المدير العام (زر «نسخة احتياطية الآن») أو `POST /api/super-admin/system/backups` |
| استرجاع | `node scripts/db-restore.mjs <backup.sqlite> [target]` بعد إيقاف الخدمة؛ يحفظ الملف القديم بجانبه |
| مراقبة | `GET /api/super-admin/system/database` يعرض الحجم وعدد الصفوف والنسخ وحالة السلامة |

> انسخ مجلد `backups/` خارج الـVolume دورياً (S3/Backblaze أو سيرفر داخل العراق). النسخ على نفس القرص لا تحمي من فقدان القرص.

## مسار الانتقال إلى PostgreSQL (مؤجل عمداً)

الانتقال لم يُنفذ في هذه الدفعة لأن طبقة البيانات الحالية **متزامنة (sync)** عبر ~250 استعلام SQLite مباشر، والانتقال يعني:

1. تحويل كل مسارات الـAPI إلى async مع `pg` أو ORM (Drizzle).
2. استبدال دوال SQLite (`julianday`, `lastInsertRowid`, `ON CONFLICT` بصيغة SQLite، `PRAGMA`) بمكافئاتها.
3. نظام migrations رسمي (Drizzle Kit) بدل `CREATE TABLE IF NOT EXISTS` + `ensureColumn`.
4. اختبار كامل على Postgres حقيقي (أو PGlite في CI).

التقدير الواقعي: 3–5 أيام عمل مركزة، ويُنصح تنفيذها **بعد** تثبيت نطاق الخدمات للـpilot حتى لا تُكتب الطبقة مرتين.

الأعمدة والجداول الحالية موثقة في `server/db.ts`، وكل الاستعلامات معزولة في `server/db.ts`, `server/auth/*`, `server/departments.ts`, `server/routes/*` — وهذا ما يجعل الانتقال ممكناً بدون لمس الواجهة.
