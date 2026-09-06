# Citizen-side QA audit — ذي قار الرقمية

Date: 2026-09-06 · Scope: everything a citizen touches (homepage, directory, service pages, onboarding,
citizen dashboard, requests/checklists, payments, notifications, feedback, issued documents), desktop
1366 px and mobile 390 px, light and dark (`data-gov-theme="dark"`).

Method: Playwright walk of 33 routes × 2 viewports × 2 themes (`scripts/dev/audit-citizen-browse.mjs`,
raw data in `qa-screens/audit/report.json`), interactive flows (`scripts/dev/audit-citizen-flows.mjs`,
`qa-screens/audit/flows.json`), API-created data for citizen `07801112233` (`scripts/dev/audit-citizen-seed*.mjs`:
3 store-licence applications, 4 catalog requests incl. a fee + an appointment, 1 complaint), plus a source read
of `src/pages/{public,citizen,services}`, `src/components`, and the server routes those pages call.
Evidence screenshots for the worst issues are in `qa-screens/audit-citizen-*.png`.

Severity: **P0** blocker (data loss, money, security, crash) · **P1** major (citizen cannot complete or
cannot read) · **P2** minor (wrong/awkward but there is a way through) · **P3** polish.

---

## P0 — blockers

### P0-1 Uploading an ID photo during onboarding crashes the whole API server
- **Where:** `/onboarding` step 2 → `POST /api/onboarding/identity-extract-preview` → `server/local-identity-ocr.ts:19` (`createWorker(['ara','eng'], …)` without an `errorHandler`).
- **What:** tesseract.js tries to download `ara.traineddata.gz` from jsDelivr at request time. When the CDN is unreachable (as in this sandbox, and as on any locked-down government network) the worker thread emits `error`, which is unhandled and terminates the Node process. Every citizen and employee is disconnected; the citizen sees the raw English string **"Failed to fetch"** in the analysis box.
- **Evidence:** `/tmp/server.log` after the upload:
  `Error: Network error while fetching https://cdn.jsdelivr.net/npm/@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz. Response code: 403 … at Worker.<anonymous> (tesseract.js/src/createWorker.js:217)` followed by process exit; `curl localhost:8787/api/services/summary` → `000`. The browser showed `التحليل التلقائي قيد التهيئة … Failed to fetch`.
- **Fix:** ship the trained data with the deploy (`langPath` pointing at a bundled directory, `gzip:false`) instead of fetching from a CDN; pass `errorHandler` to `createWorker`; wrap the worker creation in try/catch and reset `workerPromise`; add `process.on('uncaughtException'|'unhandledRejection')` logging guard in `server/index.ts` so one bad request never takes the API down; map the client-side `TypeError: Failed to fetch` to an Arabic message in `src/api.ts`.

### P0-2 Paying a service fee can be bypassed by uploading any (even optional) document
- **Where:** `server/routes/service-requests.ts:516-531` (`upload-document` handler). UI entry: `/citizen` → "متابعة الخدمات" card → "رفع" on an optional checklist row.
- **What:** the handler recomputes status purely from the checklist: when no *required* document is missing it sets `UNDER_REVIEW` and "اكتملت المستمسكات وأُعيد الطلب إلى الموظف للتدقيق", regardless of the previous status. A request that is `PAYMENT_PENDING` (fee unpaid) or `APPOINTMENT_REQUESTED` moves into the department queue.
- **Evidence:** TQS-2026-00003 (شهادة ولادة, 5,000 د.ع, `PAYMENT_PENDING`, `PAY-2026-00001` PENDING) → citizen uploaded the *optional* "كتاب رسمي من الدائرة الطالبة" → DB row became `UNDER_REVIEW`, notification "اكتملت المستمسكات وأُعيد الطلب إلى الموظف للتدقيق", payment intent still `PENDING`. Dashboard then showed the request as "قيد التدقيق" with the fee never paid.
- **Fix:** only transition `ACTION_REQUIRED → UNDER_REVIEW`; for `PAYMENT_PENDING` / `APPOINTMENT_REQUESTED` / `SUBMITTED` keep the status and just update the checklist; also block uploads while `PAYMENT_PENDING` or route them to the same "waiting for payment" action text.

### P0-3 Store-licence fee, department and service name are taken from the client
- **Where:** `server/routes/applications.ts:112-135` (`fee: z.coerce.number()`, `serviceName`, `department` from `req.body`), used at `:421` (`if (item.fee > 0)` gate) and copied verbatim into the issued PDF/verify record.
- **What:** a citizen can POST `fee=0` and receive an approved licence without any payment step, or POST a different `department`/`serviceName` that is then printed on an official document and the public `/verify/:id` page.
- **Evidence:** `scripts/dev/audit-citizen-seed2.mjs` posted `fee:'0'` → TQD-2026-0003 approved → `LIC-2026-00003` PDF issued with no payment; the UI itself sends `service.fee` from `src/data.ts` (`SpecializedServiceFormPage.tsx:73`).
- **Fix:** ignore client `fee/serviceName/department`; resolve them server-side from the catalog by `serviceKey`.

### P0-4 The issued official PDF is unreadable (reversed words, garbled labels, tofu, raw English enum)
- **Where:** `server/issued-documents.ts:72-180` (pdfkit, no Arabic shaping/bidi; label rows printed while the font is still `Helvetica` from the previous value; `ownershipType` passed raw at `server/routes/applications.ts:463`).
- **What:** every multi-word Arabic string is printed with words in reverse order ("العراق جمهورية", "الناصرية بلدية", "الوثيقة رقم"), two field labels render as `cV'bÖ( bvDcvDb€` / `bv3dR'dFEbÖD`, several lines contain missing-glyph boxes, and "نوع الإشغال" shows **owned**.
- **Evidence:** `qa-screens/audit-citizen-issued-pdf-garbled.png` (render of `/api/citizen/issued-documents/doc_1d42…/pdf`); `pdftotext` output shows the same.
- **Fix:** render the certificate from HTML with a headless browser (Playwright/Chromium is already a dev dependency) or use a library with Arabic shaping (e.g. `@pdf-lib/fontkit` + `arabic-reshaper` + `bidi-js`), always set the Arabic font before writing labels, and map `rent/owned` → `إيجار/ملك`.

### P0-5 Sandbox/checkout page arrives with all buttons disabled — payment cannot be completed in-app
- **Where:** `src/pages/citizen/PaymentPage.tsx:48-58` (`startCheckout` sets `busy=true`, then `navigate('/citizen/pay/:ref/sandbox')`; the same `PaymentPage` instance is reused by wouter so `busy` never resets) and `:172-186` (buttons `disabled={busy}`).
- **What:** clicking "ادفع 5,000 د.ع" lands on the sandbox page with "محاكاة دفع ناجح" / "محاكاة فشل الدفع" permanently disabled. Only a manual reload enables them. The same pattern will hit a real provider that returns an internal `checkoutUrl`.
- **Evidence:** `qa-screens/audit-citizen-pay-sandbox-buttons-disabled.png`; flows log: `sandbox buttons disabled after in-app navigation? [true,true]` / `after reload? [false,false]`.
- **Fix:** reset `busy` in a `useEffect` keyed on `sandbox`/`reference`, or give the two routes different `key`s (`<PaymentPage key={sandbox ? 'sandbox' : 'pay'} …/>`) so the component remounts.

### P0-6 "حجز موعد" requires the citizen to upload two fake "documents"
- **Where:** `src/service-forms.ts:220` (`requirements: ['تحديد الدائرة والغرض', 'اختيار تاريخ ووقت مفضلين']`) → `server/services/catalog.ts:64-105` converts every legacy *requirement string* into a **required document** (`accepts: image/pdf`). Enforced at `server/routes/service-requests.ts:254-260`.
- **What:** the appointment flow (linked from the bottom nav, sidebar, hero, quick actions, and every "حجز موعد آخر" reminder) shows a "المستمسكات المطلوبة" step with slots "تحديد الدائرة والغرض *" and "اختيار تاريخ ووقت مفضلين *" that demand a camera photo; the API rejects a normal request with `المستمسك «تحديد الدائرة والغرض» مطلوب لإكمال الطلب.` After submission the dashboard lists those two "documents" as "بانتظار التدقيق".
- **Evidence:** `qa-screens/audit-citizen-appointment-fake-documents.png`; seed log `online-appointment 400 المستمسك «تحديد الدائرة والغرض» مطلوب لإكمال الطلب.`
- **Fix:** give `online-appointment` (and audit the other legacy definitions) an explicit `requiredDocuments: []`; in `catalog.ts` only convert requirements that are documents.

---

## P1 — major

### P1-1 Light theme paints dark-designed blocks white but keeps their white/pale text → invisible content
- **Where:** generated `src/styles/portal-theme.css` lines 24/306 (`.footer`), 35/318 (`.service-form-header`), 331 (`.application-detail-header`), 228/337 (`.feedback-detail > header`), 212/312 (`.citizen-v2-identity-card`), 216 (`.citizen-progress-card`), plus `.support-card` in dark mode. Original colours in `src/App.css:915-946, 14493-14510`.
- **What (light mode, every page):**
  - Public footer: brand name is white on white (ratio 1.00), all links 1.47 (`qa-screens/audit-citizen-footer-invisible.png`).
  - `/citizen/application/:ref`: the **application title, reference and date are invisible** (`audit-citizen-application-header-invisible.png`); "تحتاج مساعدة؟" support card also white-on-white.
  - `/citizen`: identity card "حالة الهوية / تمت المراجعة", "حماية الحساب / OTP + جلسة آمنة" at 1.08–1.79 (`audit-citizen-identity-card-invisible.png`).
  - `/citizen/feedback/:ref`: reference number 1.23, meta line 1.34, back link pale (`audit-citizen-feedback-detail-header-invisible.png`).
  - `/service/store-license`: header kicker "خدمة رقمية" 1.69, description 1.91.
  - `/onboarding`: stepper numbers 2.76.
  - Dark mode: "تحتاج مساعدة؟" support card and the push card on `/citizen/notifications` are white boxes with white text (1.20).
- **Fix:** stop the generator from re-theming `.footer`, `.service-form-header`, `.application-detail-header`, `.feedback-detail > header`, `.citizen-v2-identity-card`, `.citizen-progress-card` in light mode (or also override their text tokens); add a contrast check (`axe` / the probe in `audit-citizen-browse.mjs`) to CI.

### P1-2 Face-video step has no fallback when there is no usable camera (desktop, denied permission, iPhone)
- **Where:** `src/components/camera/SecureCameraCapture.tsx:324` (`{!cameraOnly && …upload button}`) used with `cameraOnly` at `OnboardingPage.tsx:615`, `DynamicServiceFormPage.tsx:555`, `SpecializedServiceFormPage.tsx:229`; MIME at `SecureCameraCapture.tsx:178-181`.
- **What:** (a) desktop/laptop without webcam or with permission blocked → error "لم نعثر على الكاميرا…"/"تم رفض إذن الكاميرا" and **nothing else**; the messages even say "استخدم رفع الفيديو / ارفع الملف" but the button is hidden. Onboarding and *every* service submission are dead ends. (b) iOS Safari does not support `video/webm`; `new MediaRecorder(stream, { mimeType: 'video/webm' })` throws `NotSupportedError` inside a `setTimeout` (uncaught) so recording never starts on iPhones. (c) `SpeechRecognition`-style progressive enhancement is missing: no "ارفع فيديو قصيراً" alternative.
- **Evidence:** `qa-screens/audit-citizen-onboarding-no-camera-dead-end.png`; flows log `step4 face video: upload fallback button count (cameraOnly) 0`.
- **Fix:** pick `mimeType` from `['video/mp4','video/webm;codecs=vp9,opus','video/webm']` with `isTypeSupported`, or omit `mimeType`; wrap `startVideo` in try/catch; when camera fails show an upload fallback (`capture="user"` file input) or let the citizen finish later from the dashboard; remove the sentence that promises an upload option.

### P1-3 In-page anchor links (`#services`, `#my-requests`, `#general-requests`) do nothing
- **Where:** wouter `<Link href="#services">` in `CitizenDashboard.tsx:183, 220, 276, 281, 420, 431`; `/citizen#my-requests` links in `DynamicServiceFormPage.tsx:362,372`, `PaymentPage.tsx:98,131,183`, `CitizenNotificationsPage.tsx:86`, `CitizenFeedbackDetailPage.tsx:53`, `LandingPage.tsx` quick action "متابعة معاملة", notification `link` values from the server (`/citizen#my-requests`).
- **What:** wouter navigates with `pushState` so the URL becomes `/citizen#services` but the page does not scroll (`scrollY` stayed 0 after clicking "تصفح الخدمات"). The main hero CTA, "ابدأ خدمة", "اختر خدمة", "إكمال الإجراء" for catalog requests, "متابعة الطلب في حساب المواطن" after submitting, and "لاحقاً" on the payment page all look dead. (Sidebar/bottom nav use raw `<a>` so they work but force a full reload.)
- **Fix:** add a small `useHashScroll()` (on location change, `document.getElementById(hash)?.scrollIntoView()`), or replace with `onClick` handlers; make the server notification links point at a real route.

### P1-4 A citizen cannot log out
- **Where:** `src/components/citizen/PortalLayout.tsx:267-271` (citizen gets `تبديل البوابة → /login` instead of the employee's logout button). `/login` has no "تسجيل الخروج" either.
- **What:** shared/family phones are the norm in Iraq; the OTP session stays active with no way to end it from the UI. `api.logout` exists but is unused on the citizen side.
- **Fix:** add "تسجيل الخروج" (calling `logoutAndRedirect(..., '/')`) to the sidebar and the topbar avatar menu; keep "تبديل البوابة" as secondary.

### P1-5 Complaints are not listed anywhere in the citizen account
- **Where:** `CitizenDashboard.tsx` never calls `api.listFeedback()` (`src/api.ts:360`); `CitizenFeedbackPage.tsx` shows only the form.
- **What:** after submitting a complaint the only way back is the reference URL; "معاملاتي" and "متابعة الخدمات" show licence applications and catalog requests only. The detail page's back link goes to `/citizen#my-requests` where the complaint is not present.
- **Fix:** add a "شكاواي ومقترحاتي" list (status chip + link to `/citizen/feedback/:ref`) on `/citizen/feedback` above the form and a count/preview on the dashboard.

### P1-6 Approved store licence with a fee is stuck forever ("بانتظار تهيئة بوابة الدفع") although the payment gateway works
- **Where:** `server/routes/applications.ts:421-449` sets `PAYMENT_REQUIRED` with text "بانتظار تهيئة بوابة الدفع المعتمدة" and never creates a `payment_intents` row; `ApplicationPage.tsx` has no pay button; `SpecializedServiceFormPage.tsx:263` tells the citizen "تبقى عملية الدفع معلقة إلى حين تهيئة بوابة دفع معتمدة" while catalog services already pay through `/citizen/pay/:ref`.
- **Evidence:** TQD-2026-0001 approved → status "بانتظار الدفع", `current_action` "تمت الموافقة الإدارية. بانتظار تهيئة بوابة الدفع…", no payment reference, aside still says "25,000 د.ع — بانتظار الموافقة".
- **Fix:** create a payment intent on approval and show "سدّد الرسم الآن" on the application page; issue the PDF on `PAID` webhook/sandbox confirm; align the wording.

### P1-7 Feedback "الدائرة المعنية" dropdown only contains "لا أعرف الدائرة"
- **Where:** `src/pages/citizen/CitizenFeedbackPage.tsx:150` iterates `defaultStats.departments`, which is the empty placeholder in `src/data.ts:57`.
- **Fix:** load `api.listDepartments()` (already used on the landing page) and render its items.

### P1-8 Portal top-bar search only knows the 12 legacy services
- **Where:** `PortalLayout.tsx:196-204` filters `services` from `src/data.ts` instead of `api.searchServices`.
- **Evidence:** typing "ولادة" in the citizen top bar returns nothing, while the same query on the homepage returns 7 results.
- **Fix:** reuse `SmartSearch` (compact variant) in the portal top bar.

### P1-9 `/citizen/application/:ref` is not session-gated → infinite spinner + uncaught error for guests / expired sessions
- **Where:** `src/App.tsx:150-152` (no `SessionGate`), `ApplicationPage.tsx:18-20` (`api.getApplication(...).then(setApp)` with no catch, no error state).
- **Evidence:** guest visit shows "جاري تحميل المعاملة..." forever; console `pageerror: انتهت جلسة الدخول أو لا تملك صلاحية الإرسال…`, `WebSocket … HTTP Authentication failed`. Same for a wrong reference while logged in (`/citizen/application/NOPE` → 404 API, spinner forever).
- **Fix:** wrap in `SessionGate role="CITIZEN"`; add `error` state with "المعاملة غير موجودة" + link back.

### P1-10 Footer/utility links go nowhere
- **Where:** `src/components/public/Footer.tsx` (`/terms` → 404 page; `#privacy`, `#accessibility` point at the footer itself; "الخدمات الحكومية" listed twice), `CivicUtilityBar.tsx:44-49` ("إمكانية الوصول" → `#accessibility`, "English" is a muted span that looks like a link).
- **Evidence:** flows log `home internal links leading to 404: ["/terms"]`; clicking "إمكانية الوصول" changes nothing.
- **Fix:** create `/terms`, `/privacy`, `/accessibility` pages (a government portal needs them), remove the duplicate link, and either hide "English" or label it "قريباً".

---

## P2 — minor

### P2-1 Fee wording contradicts the data
- `DynamicServiceFormPage.tsx:62-67`: `feeStatus === 'NOT_REQUIRED'` renders "تُحدَّد الرسوم من الدائرة عند التدقيق" — a *free* service (complaint against a municipality, appointment booking) is told fees will be decided later. Should read "بدون رسوم".
- Store licence: page and summary say "مجانية" (`fee: 0` in `service-forms.ts:50`) while `feeNote` says the department sets a fee and the approval flow expects one. Say "تُحدَّد الرسوم بعد التدقيق".
- `ApplicationPage.tsx:189`: "الرسم … — بانتظار الموافقة" is shown even after approval / on 0-fee approved licences ("0 د.ع — بانتظار الموافقة").
- Homepage `LandingPage.tsx:478-488` stamps every legacy service, including البطاقة الوطنية / الجواز / إجازة السياقة (external/information-only), with "متاحة إلكترونياً". National ID also shows fee 6,000 in `service-forms.ts:178` but "الرسوم غير مؤكدة" on its page.

### P2-2 Search never says "no results"
- `SmartSearch.tsx` and `GovernmentDirectoryPage.tsx`: fuzzy server ranking returns unrelated services for any string (`q=zzzz` → "تأييد الراتب التقاعدي…"). Add a relevance threshold server-side and an explicit "لا توجد خدمة مطابقة" state (the dashboard deck has one; the public search does not).

### P2-3 Dashboard information architecture is confusing
- `CitizenDashboard.tsx:435-483`: "معاملاتي" shows only store-licence applications when any exist; catalog requests are pushed to a separate "متابعة الخدمات" section far below the PDF archive. The stats card counts "طلبات جارية" (licences only, 2) next to "طلبات عامة" (catalog, 3) with no explanation. "إكمال الإجراء" for a catalog request links to `#general-requests` (dead, P1-3).
- `:768-782` "آخر طلب مسجل … حجز موعد آخر" appears under every request type, even a birth certificate.
- `:204-207` identity chip says "قيد المراجعة" for `NEEDS_RESUBMISSION`/`REJECTED`/unverified citizens; the "حساب مواطن محمي"/badge icon is always shown.
- Fix: one unified "معاملاتي" list (applications + requests + complaints) sorted by `updatedAt`, honest identity status with a CTA.

### P2-4 Error messages appear off-screen
- `CitizenFeedbackPage.tsx:271`, `DynamicServiceFormPage.tsx:567`, `OnboardingPage.tsx:702`: the `.form-error` is rendered above the submit footer / at the bottom of the panel; on the feedback form the error sat at y=586 while the viewport was scrolled to y=1271 — the citizen sees nothing happen. Add `role="alert"`, scroll to the error, or show it next to the button.

### P2-5 `capture="environment"` forces the camera on "upload" inputs (mobile)
- `SecureCameraCapture.tsx:241`, `CitizenDashboard.tsx:709,744`, `CitizenFeedbackPage.tsx:241`: the buttons are labelled "رفع صورة / رفع صورة موجودة على الهاتف / أضف صور أو PDF" but on Android/iOS the `capture` attribute opens the camera and hides the gallery/files picker; `multiple` + `capture` in feedback prevents multi-select. Drop `capture` on the upload path (keep it on the "فتح الكاميرا" path only).

### P2-6 Stale preview after changing document type / identity data
- `SecureCameraCapture.tsx:255`: `previewUrl` is internal state; when the parent resets `file` to `null` (`OnboardingPage.tsx:402-415` on document-type change) the old ID image stays on screen without the "جاهز" chip. Derive the preview from the `file` prop (`useEffect` on `file`).

### P2-7 Onboarding step logic
- `OnboardingPage.tsx:243/494`: back-of-ID capture lives in step 3 "البيانات", not step 2 "المستند"; step 2 "متابعة" is enabled while analysis is still `loading`.
- `:213-216, 644`: "أوافق على الاحتفاظ المشفر بالمرفقات" is a checkbox but the request is blocked if unchecked ("مطلوبة قبل الإرسال") — a consent that cannot be declined is not consent. Make it informational or truly optional.
- `:180-207`: continuing from step 3 silently triggers a GPS prompt and disables the button for up to 12 s; if the citizen dismisses the prompt on iOS Safari (no callback) they wait for the timeout. Show a spinner text and a "تخطي الموقع" button.
- `:307`: the header "X" closes to `/login` while the saved-account variant (`:250`) closes to `/`; both are icon-only links with no `aria-label`.
- `:373` placeholder "6 digits" (English); `:344` "سنرسل رمزاً حقيقياً لمرة واحدة" — "حقيقياً" reads oddly; use "رمز تحقق لمرة واحدة".
- Preview-analysis copy `server/routes/onboarding.ts:146` shows citizens "مزود قراءة المستندات غير مهيأ في بيئة المنصة" (dev jargon). Say "القراءة التلقائية غير متاحة حالياً؛ أدخل البيانات يدوياً".

### P2-8 SessionGate loses the destination
- `SessionGate.tsx:57-61` sends citizens to `/onboarding` without `?continue=`; a guest clicking "الشكاوى والمقترحات" in the public header ends on `/citizen` after OTP instead of `/citizen/feedback`. Pass `continue=<current path>` and widen the allow-list in `OnboardingPage.tsx:29` (currently only `/service/*`).

### P2-9 Dead "اتصل بالدعم" button
- `ApplicationPage.tsx:194`: `<button>اتصل بالدعم</button>` — `type=submit`, no handler, no phone number. Link to a `tel:` number or the feedback form.

### P2-10 Address search / reverse geocoding silently fails
- `LocationPicker.tsx:63-70, 112-126`: direct browser calls to `nominatim.openstreetmap.org` (violates Nominatim's usage policy for a production government site — needs a referer/UA and rate limits) and, when blocked, the search box shows nothing (no "تعذر البحث" message). Proxy through the API with caching; show an error state; the map already works without it.

### P2-11 Mobile layout
- Utility bar wraps to 2–3 lines on 390 px ("جمهورية العراق", "إمكانية الوصول", "الوضع الليلي" each broken mid-phrase) — collapse to icons or hide the identity text on `< 480px`.
- `src/styles/motion.css:187-196`: `.dynamic-form-submit` is `position: sticky; bottom: 0` but is the last child of the form, so it can never stick (measured top = 3237 px on a 844 px viewport). Move it outside the form (`form="…"` attribute on the button) or drop the sticky intent.
- 11 interactive elements under 32 px tall on every public page (utility links, category chips) — see `report.json` `small` lists.

### P2-12 Inconsistent district lists
- Feedback form: 7 districts; birth-certificate select: 14; store licence: 4 (`SpecializedServiceFormPage.tsx:145-156`). Use one shared list.

### P2-13 Dashboard has no loading/error state
- `CitizenDashboard.tsx:63-71`: `Promise.all` without catch; a failed call leaves "جاري تحميل الحساب" text in the identity card and empty lists that read like "no requests". Add a loading skeleton and an inline error with retry.

---

## P3 — polish

- **English kickers in an Arabic government UI:** "YOUR VOICE", "REQUEST REGISTERED" (`CitizenFeedbackPage.tsx:78,103`), "DIGITAL DOCUMENT VERIFICATION" (`VerifyPage`), "DIGITAL" watermark (`ApplicationPage.tsx:215`), `<title>` "ذي قار الرقمية | THI QAR DIGITAL" identical on every page (no per-route `document.title`).
- **Register mix:** "راح يصلك رقم متابعة" (colloquial) on the feedback page next to formal copy elsewhere.
- **Dates:** `toLocaleString('en-GB')` → "06/09/2026, 09:55:09" with seconds, while appointments print ISO "2026-09-20 — 10:00" and the native date input shows "mm/dd/yyyy". Pick one Arabic-friendly formatter (`ar-IQ-u-nu-latn`, no seconds).
- **Fonts:** five families in use on citizen pages (`Noto Kufi Arabic`, `Segoe UI`, `Inter`, `Helvetica Neue`, `Lucida Console`) — the map controls and `.section-kicker` fall back to Latin fonts.
- **Sidebar:** "آخر نشاط: الآن" is a hard-coded string (`PortalLayout.tsx:257`); active state never highlights "الخدمات/معاملاتي" because wouter's location has no hash (`:247`).
- **Accessibility:** icon-only buttons without names (`PortalLayout.tsx:235` sidebar close, `:275` menu button, onboarding "X"); the realtime toast close is an `<svg onClick>` (`:357`) not reachable by keyboard; `img` without `alt` on the certificate (`ApplicationPage.tsx:217`); stepper/progress use colour only.
- **Progress bar on service forms is static** (`DynamicServiceFormPage.tsx:388-407` always shows 01 active).
- **Console noise:** every portal page logs two 404s for `/api/citizen/profile-photo`; guest pages log 401 from `/api/auth/session`. Return 204/`{ photo: null }` instead.
- **Directory taxonomy:** "التخطيط" (1) vs "التخطيط والإحصاء" (2), "حكومة محلية" (1) — merge categories.
- **Appointment date bounds** use `toISOString()` (UTC) so after 21:00 Baghdad time "today" is rejected (`DynamicServiceFormPage.tsx:131`, server `:288`).
- **Feedback attachments:** picking files twice replaces instead of appends; a 4th file is dropped silently (`CitizenFeedbackPage.tsx:37-43`).
- **Verify page** mixes "الرسم: مجانية" (legacy) with catalog wording.

---

## Things that worked well
OTP flow messages (invalid phone, wrong code) are clear; the appointment/checklist/rejection loop renders the employee's rejection reason and "إعادة الرفع" correctly; the sandbox payment, once enabled, produces a receipt that shows up on the dashboard; the PDF download/preview endpoints stream `application/pdf` with auth; dark mode on the dashboard, notifications and application pages is generally readable; no horizontal overflow at 390 px; 404 route and unknown service key both land on the NotFound page.

## Reproduction helpers (dev only)
- `node --no-warnings scripts/dev/audit-citizen-seed.mjs` / `audit-citizen-seed2.mjs` — creates the citizen `07801112233` and the requests referenced above.
- `node --no-warnings scripts/dev/audit-citizen-browse.mjs` — route walk + contrast/overflow/a11y probe → `qa-screens/audit/report.json`.
- `SKIP_HOME=1 node --no-warnings scripts/dev/audit-citizen-flows.mjs` — interactive flows (mocks the OCR endpoint to avoid P0-1) → `qa-screens/audit/flows.json`.
- `scripts/dev/audit-citizen-shots.mjs` — evidence screenshots.
