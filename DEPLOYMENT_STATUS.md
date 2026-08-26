# حالة النشر الدائم — Railway

**آخر تحديث:** 26 آب 2026، 23:14 GMT+3

| البند | الحالة |
|---|---|
| المستودع | `Mahab0056/dhiqar-digital-platform` — خاص |
| المزود | Railway — Hobby Plan |
| المشروع | `fabulous-laughter` |
| الخدمة | `dhiqar-digital-platform` |
| المنطقة | EU West |
| النسخ | 1 Replica |
| النشر | قيد الإقلاع الأول |
| رابط Railway المخصص | `https://dhiqar-digital-platform-production.up.railway.app` |

## سجل الإقلاع الذي تم التحقق منه

أظهرت سجلات Railway بدء حاوية Node بنجاح وتشغيل الأمر `tsx server/index.ts`، ثم ظهور الرسالة:

```text
Dhi Qar Digital Demo API listening on http://0.0.0.0:8080
```

كما أظهرت السجلات تركيب Volume للخدمة. ما زال مطلوباً اختبار الرابط العام والتحقق من تعيين `DATABASE_PATH` لمسار الـVolume داخل الخدمة، ثم تنفيذ اختبار كتابة واسترجاع للبيانات للتأكد من الاستمرارية بعد إعادة التشغيل.
