# Backend security & robustness audit — ذي قار الرقمية

Date: 2026-09-06 · Scope: every HTTP/WS route in `server/` (Express 5 + `node:sqlite`), `server/auth/*`, `server/db.ts`,
`server/payments/*`, `server/push.ts`, `server/media.ts`, `server/otp.ts`, `server/identity-*.ts`, `server/face-match.ts`,
`server/*realtime*.ts`, `server/http/*`, `server/db-ops/backup.ts`, plus `tests/`.

Method: full source read of the modules above; read-only queries against the dev database (`data/test.sqlite`, via
`node:sqlite`) to confirm data-shape findings; unauthenticated probes against the dev server at `http://localhost:8787`;
`pnpm test` (34/34 pass, see §Tests); Railway variable **names** for `fabulous-laughter/dhiqar-digital-platform`
(values not read). Findings from the staff/citizen QA audits (`docs/audit/staff.md`, `docs/audit/citizen.md`) that the
task asked to verify are marked **[verified]** with the exact code path. No source files were modified.

Severity: **P0** exploitable now by an ordinary citizen/employee session, or destroys legal records ·
**P1** authorization/privacy/money defects needing a specific role or misconfiguration, or silent data corruption ·
**P2** robustness, DoS, integrity, retention · **P3** hygiene/performance/polish.

Production facts that matter for gating (from Railway variable names): `NODE_ENV`, `RAILWAY_ENVIRONMENT`, `SESSION_SECRET`,
`MEDIA_ENCRYPTION_KEY`, `OTP_HASH_SECRET`, `OTPIQ_*`, `PUBLIC_BASE_URL`, `DATABASE_PATH` are set; **no**
`PAYMENT_PROVIDER`/`ZAINCASH_*`, **no** `VAPID_*`, **no** `STAFF_BOOTSTRAP_*` (legacy `SUPER_ADMIN_PASSWORD`/
`ADMIN_REVIEW_PASSWORD`/`OPERATIONS_PASSWORD` accounts), **no** `MFA_ENCRYPTION_KEY` (MFA secrets keyed from
`SESSION_SECRET`), **no** `BACKUP_DIR`.

---

## P0 — blockers

### P0-1 [verified] `POST /api/system/reset-test-data` lets any EMPLOYEE wipe applications, payments, notifications and the entire audit log
- **Where:** `server/routes/system.ts:6-18`; `server/db.ts:1109-1120` (`resetDemo`).
- **Problem:** guarded by `requireSession('EMPLOYEE')` only (not SUPER_ADMIN, not department-scoped) and by
  `process.env.NODE_ENV === 'production'` at request time. `resetDemo()` runs `DELETE FROM payments; DELETE FROM
  notifications; DELETE FROM application_events; DELETE FROM applications; DELETE FROM audit_logs` — the audit table is
  not append-only. The audit row written afterwards is attributed to the constant `'Local Operator'`, not the session
  (`system.ts:10`). Any staging/preview/self-hosted instance without `NODE_ENV=production` (nothing in `nixpacks.toml`
  / `railpack.json` sets it; it is set only as a Railway variable) is exposed; on production a single env typo exposes it.
- **Repro:** `curl -X POST http://localhost:8787/api/system/reset-test-data -H "Cookie: dhiqar_session=<any EMPLOYEE cookie>"`
  → `200 {"success":true}`; applications/audit_logs are empty (staff audit P0-1 evidence: audit_logs 79 → 2).
  Unauthenticated probe on the dev server returns 401 — so the only barrier is *any* employee login.
- **Fix:** do not register the route at all unless `process.env.NODE_ENV === 'test'` (decide at boot in
  `createPlatformServer`, not per request); if a reset is needed for pilots, require `SUPER_ADMIN` + `sensitiveLimiter`
  + explicit `ENABLE_TEST_RESET=true`, use `session.actor`, and never delete `audit_logs` (move them to an
  `audit_logs_archive` table instead). Add a test asserting the route is 404 for EMPLOYEE and SUPER_ADMIN when
  `NODE_ENV=production`.

### P0-2 [verified] Store-licence applications trust client `fee`, `department`, `serviceName`, and decisions/listing are not department-scoped
- **Where:** `server/routes/applications.ts:111-136` (zod accepts `serviceName`, `department`, `fee: z.coerce.number()`),
  `:173-186` (stored verbatim), `:421` (`if (item.fee > 0)` is the only payment gate), `:452-467` (client
  `department`/`serviceName` printed on the issued PDF and public `/api/verify`); listing `:66-71` and dashboard
  `server/departments.ts:236-296` match on the free-text `applications.department` **name**; `request-document :255`,
  `reject :363`, `approve :402` are `requireSession('EMPLOYEE','SUPER_ADMIN')` with no `canActOn`-style check; detail
  `:73-100` lets any EMPLOYEE read any application (with attachments' media ids).
- **Problem:** (a) a citizen posts `fee=0` and the application is approved and a licence PDF issued without any payment;
  (b) posts an arbitrary `department` so the file is routed nowhere (dev DB: all 3 rows carry `'بلدية الناصرية'`, which
  matches no registry department, so `emp.muni` sees `[]` while `emp.nodept` — no department — sees everything because
  `scopedName === undefined`); (c) any employee of any department can request documents, reject, or approve+issue for
  any application.
- **Repro:** `POST /api/applications` (multipart) with `serviceKey=store-license&fee=0&department=X&serviceName=Y…` →
  201; then as `emp.sewer`: `POST /api/applications/TQD-2026-0002/request-document {"documentName":"x"}` → 200 (staff
  audit P0-2 evidence).
- **Fix:** drop `fee`, `serviceName`, `department` from the schema; resolve them server-side from
  `getCatalogService(serviceKey)` (title, `departmentId`, `feeIqd`, `feeStatus`); add `department_id TEXT` to
  `applications` (`ensureColumn`) and backfill from the name map; replace `getApplications(departmentName)` with a
  `department_id` filter; add a shared `canActOnApplication(session, row)` (SUPER_ADMIN or same `department_id`) to
  the GET-by-reference, `request-document`, `reject`, `approve` handlers; return 403 otherwise; when
  `session.departmentId` is null for EMPLOYEE return an empty list (as `departmentScope()` already does for service
  requests). Use `payment_intents` for the fee instead of the `PAYMENT_REQUIRED` dead-end.

### P0-3 [verified + worse] Citizen `upload-document` rewrites the application status to `UNDER_REVIEW` from **any** state — including `APPROVED`, `REJECTED` and `PAYMENT_REQUIRED`
- **Where:** `server/routes/applications.ts:304-330` — the only checks are ownership and file validation; the UPDATE at
  `:328-330` is unconditional.
- **Problem:** a citizen can (1) re-open a rejected file and put it back in the employee queue; (2) take an
  `APPROVED`+issued licence back to `UNDER_REVIEW` (the licence PDF stays valid and `/api/verify` still says
  APPROVED), then get it re-approved with `createIssuedDocument` returning the existing document; (3) move a
  `PAYMENT_REQUIRED` file to `UNDER_REVIEW` — with P0-2 the employee then approves and a licence is issued with
  `payment_status='NOT_REQUIRED'` (`:473`). Also every upload is stored with `retentionHours: 24*30` but never purged (P1-4).
- **Repro:** approve TQD-2026-0001 → `POST /api/applications/TQD-2026-0001/upload-document` (multipart `document`,
  `documentName=anything`) → 200 with `status: "UNDER_REVIEW"`.
- **Fix:** allow the transition only when `item.status === 'ACTION_REQUIRED'` (409 otherwise), and only accept the
  document named in `required_document` (or an explicit `documentPurpose=FACE_VIDEO` when the face video is missing);
  keep `PAYMENT_REQUIRED` unchanged; make the status update conditional in SQL
  (`… WHERE reference = ? AND status = 'ACTION_REQUIRED'`) and check `changes`.

### P0-4 [verified] Service-request `upload-document` moves a `PAYMENT_PENDING` / `APPOINTMENT_REQUESTED` / `SUBMITTED` request to `UNDER_REVIEW` (fee bypass)
- **Where:** `server/routes/service-requests.ts:516-532` — `nextStatus` is derived only from the checklist.
- **Problem:** uploading any file (even for a non-existent `documentKey`, which appends an `extra-N` item at `:481-498`)
  on a request whose fee is unpaid puts it in the department queue with `payment_status='PENDING'`. `settlePayment`
  later sees `status !== 'PAYMENT_PENDING'` (`intents.ts:137`) and never releases anything, so the payment (if it ever
  happens) is disconnected from the request. The employee decision route only refuses `APPROVED` while a PENDING
  intent exists (`:737`), so an employee can still set `UNDER_REVIEW`/`ACTION_REQUIRED` freely; the citizen audit
  documented the fee being skipped end-to-end (TQS-2026-00003).
- **Fix:** compute `nextStatus` as: if `row.status === 'ACTION_REQUIRED'` → (`stillMissing.length ? 'ACTION_REQUIRED' :
  'UNDER_REVIEW'`); for every other status keep `row.status` and only update `document_checklist`; refuse uploads for
  keys not in the checklist unless `row.required_document` is set (employee asked for a free-form document); cap
  checklist length (e.g. 12).

---

## P1 — major

### P1-1 [verified + extended] Identity queue and **every** encrypted media object are readable by any EMPLOYEE; `/api/admin/media/:id` is a global IDOR
- **Where:** `server/routes/onboarding.ts:415-417` (`GET /api/admin/identity-reviews`, roles EMPLOYEE/IDENTITY_REVIEWER/
  SUPER_ADMIN), `:481` (`extractedFields.documentNumber` returned unmasked from `extracted_data`, which stores the full
  OCR'd number at `:260-270` while the audit row claims `rawDocumentNumberStored: false` at `:365`), `:515-535`
  (`GET /api/admin/media/:id` → `readDecryptedMedia(id)` with **no** check that the id belongs to an identity review, a
  department, or anything).
- **Problem:** any employee (any/no department) can enumerate all citizens' ID images, face videos, phone, GPS. Worse,
  `/api/admin/media/:id` decrypts *any* `media_objects` row: service-request documents of other departments (ids are
  visible in `/api/applications` attachments to every EMPLOYEE, and to OPERATIONS/other roles via
  `/api/employee/service-requests`), issued PDFs, derived profile photos, feedback attachments. The employee
  service-request media route (`service-requests.ts:600-633`) does the linkage check correctly — the admin route does not.
- **Repro:** as `emp.sewer`: `GET /api/admin/identity-reviews` → 200 (3 rows, staff audit P0-3); take any `mediaId` from
  `GET /api/applications` → `GET /api/admin/media/media_…` → 200 image bytes.
- **Fix:** put `requireReviewAccess` on the list and media routes; in the media route require the id to be one of
  `id_front_media_id | id_back_media_id | face_video_media_id | profile_photo_media_id` of an `identity_reviews` row
  (`SELECT 1 FROM identity_reviews WHERE ? IN (id_front_media_id, …)`), 404 otherwise; return
  `documentNumber` masked (`********1234`) and store only the masked value in `extracted_data.fields`; keep the raw
  OCR text out of the API.

### P1-2 Public `/api/verify/:id` falls back to the full application record (address, coordinates, citizen id, attachment media ids, timeline) and reports revoked documents as APPROVED
- **Where:** `server/routes/documents.ts:136-146` → `getApplicationByVerificationId` (`server/db.ts:889-894`) →
  `mapApplication` (`db.ts:896-954`) → `res.json({ ...item, … })`.
- **Problem:** when no `issued_documents` row is `ACTIVE` for the id (legacy approvals, or a document that was
  `REVOKED`), the endpoint returns the entire application including `citizenId`, `address`, `coordinates`,
  `attachments[].mediaId`, `events[]`, `decidedBy`, with `status: 'APPROVED'`. Verification ids are 18 hex chars
  (unguessable) but are printed on every licence PDF/QR, i.e. handed to third parties by design.
- **Fix:** whitelist the public projection (`reference, citizenName, serviceName, department, documentTitle,
  documentNumber, verificationId, status, issuedAt`); if the issued document exists but is not ACTIVE, answer
  `{ status: 'REVOKED', revokedAt }` instead of falling through; never include `citizenId`, attachments, coordinates or events.

### P1-3 [verified] Super-admin citizen registry returns a single row: aggregate without `GROUP BY`
- **Where:** `server/db.ts:845` — `MAX(COALESCE(c.updated_at, c.created_at)) AS last_activity_at` in a non-grouped
  `SELECT … FROM citizens c … ORDER BY … LIMIT ?`. SQLite collapses the whole result to one row (bare aggregate).
- **Evidence:** dev DB: `citizens` = 4, registry query returns 1 row (`scratchpad/check.mjs`).
- **Fix:** replace the aggregate with the plain expression `COALESCE(c.updated_at, c.created_at) AS last_activity_at`
  (the sub-selects already give per-citizen counts). Add a test asserting `citizens.length === COUNT(*)` capped by `limit`.

### P1-4 Media retention is never enforced; expired media is still served; audit rows promise deletions that never happen
- **Where:** `server/media.ts:126-141` (`purgeExpiredMedia`) is not referenced anywhere (`create-server.ts` only
  schedules `purgeExpiredSessions` and backups); `readDecryptedMedia` (`media.ts:93-115`) ignores `expires_at`;
  callers write `retentionHours: 24*30 / 24*90 / 168` and audit `retentionDays: 30` (`applications.ts:247,357`,
  `feedback.ts:354`).
- **Problem:** face videos, ID documents (for applications), feedback attachments and service documents are kept and
  downloadable indefinitely, contradicting the consent text shown to citizens. Backups (`data/backups/*.sqlite`,
  plaintext) also carry all metadata forever.
- **Fix:** `setInterval(purgeExpiredMedia, 60*60*1000).unref()` at boot plus one run at startup; in `readDecryptedMedia`
  treat `expires_at <= now AND retention_policy != 'RETAINED_WITH_CONSENT'` as unavailable; log a `MEDIA_PURGED` audit
  row per batch; add a test with a short `retentionHours` that asserts the file and row are gone.

### P1-5 Sandbox payment settlement is reachable without authentication and selected automatically whenever `NODE_ENV !== 'production'`
- **Where:** `server/payments/providers.ts:342-364` (`sandboxAllowed()`/`paymentProvider()`), `:272-281`
  (`SandboxProvider.parseCallback` trusts `intentId`/`outcome` from the payload), `server/routes/payments.ts:374-389`
  (`GET /api/payments/return/:provider` — public, no session, no CSRF, settles via `settlePayment`).
- **Problem:** on any deployment where `NODE_ENV` is not exactly `production` (previews, staging, a self-hosted pilot),
  or where `PAYMENT_SANDBOX_ALLOWED=true`, `GET /api/payments/return/sandbox?intentId=<id>&outcome=PAID` marks the
  intent PAID, issues a receipt, and releases the service request to the department — no login needed (intent ids are
  random but are shown to the owning citizen, and the same citizen can call `sandbox-confirm` anyway). The dev server
  answers the unauthenticated probe with `302` (`?payment=invalid` only because the id was fake).
- **Fix:** for the sandbox provider, only accept settlement through the authenticated `sandbox-confirm` route (make
  `SandboxProvider.parseCallback` return `ok:false` for the return route, or skip registering `/return/sandbox`);
  require `PAYMENT_SANDBOX_ALLOWED=true` explicitly in every environment instead of `NODE_ENV !== 'production'`; for
  ZainCash also verify `claims.exp`/`iat`, that `claims.id === intent.provider_reference` and that
  `Number(claims.amount) === intent.amountIqd` before settling (`providers.ts:327-339`).

### P1-6 Official fees are silently waived when no gateway is configured — which is the case in production
- **Where:** `server/routes/service-requests.ts:306`
  (`feeDue = feeStatus === 'OFFICIAL' && feeIqd > 0 && Boolean(paymentProvider())`).
- **Problem:** Railway has no `PAYMENT_PROVIDER`, so `paymentProvider()` is `null`, `feeDue` is false, and every
  fee-bearing service is submitted straight to the department with `payment_status='NOT_REQUIRED'` and no notice.
  `/api/payments/config` reports `available:false` but the request pipeline ignores it.
- **Fix:** when a fee is due and no provider exists, either refuse the submission with a clear 503/409 (“pay at the
  department, then upload the receipt”), or create the intent with `mode='UNAVAILABLE'` and keep the request in
  `PAYMENT_PENDING` so the employee can mark a manual receipt (new SUPER_ADMIN/EMPLOYEE action, audited).

### P1-7 Non-transactional multi-step writes around document issuance, payment creation and identity submission
- **Where:** `server/routes/applications.ts:450-509` — `await createIssuedDocument()` (renders PDF, writes an encrypted
  file, inserts `issued_documents`) **before** `BEGIN`; the status UPDATE runs after. `service-requests.ts:763-809`
  same pattern; `:320-422` — `createPaymentForRequest` runs after `COMMIT`; `onboarding.ts:213-311` — three media
  files are written before the `identity_reviews` INSERT; `applications.ts:159-217` — application row inserted, then
  media stored in a loop with no transaction.
- **Problem:** (a) two concurrent `approve` calls both pass the status check (the `await` yields), both render a PDF;
  the second `issued_documents` INSERT hits the UNIQUE index → 500 with an orphaned encrypted PDF on disk;
  (b) if the UPDATE after issuance fails, an ACTIVE issued document exists for a non-approved file and
  `createIssuedDocument` will forever return it; (c) if `createPaymentForRequest` throws, the request is stuck in
  `PAYMENT_PENDING` with no intent to pay; (d) if `analyzeIdentityDocument` throws, media with `retention_until =
  9999` is orphaned.
- **Fix:** render the PDF first (pure), then do `BEGIN … INSERT issued_documents … UPDATE applications WHERE reference=?
  AND status IN (…) … COMMIT` and check `changes` (409 on 0); write the media file after the DB row inside the same
  transaction or delete it on rollback; move `createPaymentForRequest` inside the request transaction; in
  `identity-review` insert the review row inside `BEGIN`/`COMMIT` and `deleteEncryptedMedia` on failure; add an
  in-process mutex per reference for the async approval routes.

### P1-8 One bad identity image can crash the API process (no worker error handler, no process guards)
- **Where:** `server/local-identity-ocr.ts:478-481` (`createWorker([...], 1, { cachePath, logger })` — no
  `errorHandler`); `server/index.ts` has no `process.on('uncaughtException' | 'unhandledRejection')`; the tesseract
  cache lives in `/tmp` unless `RAILWAY_VOLUME_MOUNT_PATH` is set and language data is fetched from jsDelivr at request time.
- **Problem:** documented in the citizen audit P0-1: a CDN failure emits `error` on the worker thread → process exit;
  every user is disconnected. Additionally `runIdentityVerification` (`identity-verification.ts:228-295`) has no
  concurrency cap (each run does ffmpeg + two ONNX sessions on the request path's CPU) and no resume: rows in
  `identity_verification_runs` with `finished_at IS NULL` after a restart are never re-run, leaving
  `auto_assessment='PENDING'` forever.
- **Fix:** pass `errorHandler` and a bundled `langPath` (`gzip:false`) to `createWorker`; wrap `getWorker()` in
  try/catch that resets `workerPromise`; add process-level handlers that log with the request id and keep serving;
  run identity checks through a small queue (concurrency 1–2) and, at boot, re-queue reviews whose latest run has
  `finished_at IS NULL`.

### P1-9 Internal error messages are returned to clients from catch-all handlers
- **Where:** `server/routes/onboarding.ts:40-48, 72-80, 152-155, 394-397, 613-616, 645-647`;
  `server/routes/feedback.ts:376-384`; `server/routes/service-requests.ts:554-556`; `server/routes/auth.ts:181,213`;
  `staff-admin.ts:329,467`.
- **Problem:** `res.status(400).json({ message: error.message })` forwards `ENOSPC: no space left on device, write
  '/data/private-media/media_…bin'`, `UNIQUE constraint failed: service_requests.reference`, `MEDIA_ENCRYPTION_KEY is
  required…`, OTPIQ provider errors, etc. (storage paths, schema, provider configuration). The central
  `errorHandler` (`http/error-handler.ts`) does this right; the local catches bypass it.
- **Fix:** in each catch, handle only the known domain errors (ZodError, the Arabic file-validation messages,
  `OtpError`), and `next(error)` for everything else so the generic 500 with `requestId` is returned; introduce a
  `DomainError` class with a `status` and use it in `otp.ts`, `staff.ts`, `media.ts`.

### P1-10 Reference and receipt numbers come from `COUNT(*)+1` — collisions become permanent 500s after any deletion
- **Where:** `server/routes/applications.ts:155-158`, `service-requests.ts:301-304`, `payments/intents.ts:79-82`
  (`PAY-` and the receipt derived from it at `:127`), `db.ts:959-960` (feedback), `issued-documents.ts:53-58`.
- **Problem:** `reference` columns are UNIQUE. After `resetDemo` (deletes applications but not `payment_intents`),
  any manual cleanup, or a restore, the counter re-issues an existing number and every subsequent submission fails
  with `UNIQUE constraint failed` (500) until enough rows exist. Year rollover keeps the global count, so numbers are
  also not per-year as their format suggests.
- **Fix:** a `sequences(name TEXT PRIMARY KEY, value INTEGER)` table updated with
  `UPDATE … SET value = value + 1 RETURNING value` inside the same transaction as the insert (SQLite ≥ 3.35 supports
  RETURNING), keyed per year (`applications:2026`), or fall back to `MAX(id)+1` with a retry on UNIQUE failure.

### P1-11 Cross-department exposure in the remaining employee routes
- **Where:** `server/routes/feedback.ts:405-407` (`GET /api/admin/feedback` — every complaint with citizen id,
  coordinates, admin notes), `:409-440` (`PATCH` any feedback's status — no `department_id` check);
  `server/routes/documents.ts:63-94` (any EMPLOYEE lists and downloads every issued PDF of every department);
  `server/routes/applications.ts:14-64` (`work-queue-summary` counts all departments for IDENTITY_REVIEWER and
  department-less EMPLOYEE); `server/employee-work-queue-realtime.ts:226-233` broadcasts every event (with
  references) to every staff socket, including IDENTITY_REVIEWER; `service-requests.ts:600-633` lets OPERATIONS
  download any citizen's documents (read-only role by description, but it gets raw ID/face media).
- **Fix:** filter feedback by `department_id` for EMPLOYEE (`departmentScope`-style; department-less employee sees
  nothing), and require `canActOn` on the PATCH; filter issued documents by `department_name`/new `department_id`;
  give the realtime publisher a `departmentId` and fan out only to sockets of that department (SUPER_ADMIN gets all,
  IDENTITY_REVIEWER only `IDENTITY_REVIEW` events); restrict OPERATIONS to metadata (no media bytes) unless the
  product explicitly wants otherwise — and audit it either way.

### P1-12 Identity submissions have no state guard: unlimited resubmission, self-downgrade, and a client-claimed liveness flag
- **Where:** `server/routes/onboarding.ts:95-115` (`complete-identity` sets `verification_status='MANUAL_REVIEW'` and a
  new `full_name` for any citizen, from a boolean `livenessPassed` the client asserts); `:159-399` (`identity-review`
  never checks for an existing `PENDING_REVIEW` or a verified citizen).
- **Problem:** a verified citizen (or an attacker with the cookie) can flip themselves to `MANUAL_REVIEW` and rename
  the account (the name is what gets printed on issued documents); any citizen can submit hundreds of reviews, each
  storing three media files with `retention_until = 9999-12-31` (~60 MB per submission at the multer limit), flooding the
  reviewer queue and the volume; every submission also kicks off an unbounded face-match job (P1-8).
- **Fix:** reject `identity-review` when the latest review is `PENDING_REVIEW` (409) or the citizen is already
  VERIFIED/VERIFIED_MANUAL unless a reviewer set `NEEDS_RESUBMISSION`; remove or gate `complete-identity` (it predates
  the media flow); limit to N submissions per 24 h per citizen; mark superseded reviews' media for deletion.

---

## P2 — should fix

### P2-1 Upload memory amplification
- **Where:** `server/http/upload.ts:107-109` (`memoryStorage`, `fileSize: 20 MB`, `files: 16`, no `fields`/`fieldSize`/
  `parts` limits); `service-requests.ts:186` uses `upload.any()`; the application/service-request upload routes are not
  behind `sensitiveLimiter`.
- **Problem:** one request can hold 320 MB of buffers plus an unlimited number of 1 MB text fields in memory; the
  `apiLimiter` allows 180 such requests per minute per IP. Face video buffers are additionally base64-encoded into a
  JSON body for the external analyzer (`identity-document-analysis.ts:361-368`).
- **Fix:** per-route multer instances with tight `files`/`fields`/`parts`; 20 MB only for videos, 8 MB for images/PDF;
  put `/api/applications`, `/api/service-requests`, `/api/citizen/feedback` and the two upload-document routes under
  `sensitiveLimiter` (or a dedicated 20/10 min limiter); stream to disk (`diskStorage` in the private media dir) and
  encrypt from the temp file.

### P2-2 Production gating is scattered across `NODE_ENV` checks with different fallbacks
- **Where:** `config.ts:2,8-10` (`isProduction` vs `secureHostedRuntime`), `rate-limit.ts:34`, `otp.ts:200`
  (`OTP_DEV_MODE` fixed code `246810` if `NODE_ENV !== 'production'`), `providers.ts:343`, `push.ts:399` (per-process
  VAPID keys), `system.ts:7`, `backup.ts:54`, `session.ts:43` (dev session secret).
- **Problem:** Railway sets `NODE_ENV`, but the repo's own deploy descriptors do not; `secureHostedRuntime` already
  recognises `RAILWAY_ENVIRONMENT`, the others do not. A preview/staging environment silently gets: fixed OTP code
  (anyone logs in as any phone), sandbox payments, no rate limits only in test, insecure cookies.
- **Fix:** one `runtime.ts` exporting `isProduction = NODE_ENV==='production' || RAILWAY_ENVIRONMENT==='production' ||
  RENDER==='true'` and `isTest`; make every dev shortcut opt-in via its own explicit variable **and** `!isProduction`;
  refuse to boot in production without `SESSION_SECRET`, `MEDIA_ENCRYPTION_KEY`, `OTP_HASH_SECRET` (today
  `MEDIA_ENCRYPTION_KEY` is only checked on first upload, `OTP_HASH_SECRET` falls back to the media key at `otp.ts:153`).

### P2-3 Citizen identity is `HMAC(phone, OTP_HASH_SECRET)`; rotating either secret orphans every account
- **Where:** `server/otp.ts:152-156, 212, 340` (`accountKey: row.phone_hash`), `db.ts:776-790`.
- **Problem:** the OTP hashing secret doubles as the citizen account key. Rotation (or the fallback to
  `MEDIA_ENCRYPTION_KEY` when `OTP_HASH_SECRET` is unset) creates fresh citizens for every phone; the old records with
  their verified identities become unreachable. Same coupling for MFA secrets keyed from `SESSION_SECRET`
  (`auth/totp.ts:789-793`).
- **Fix:** derive `account_key` from a dedicated `CITIZEN_ACCOUNT_KEY_SECRET` (or store a salted hash with a key id)
  and keep `OTP_HASH_SECRET` rotatable; set `MFA_ENCRYPTION_KEY` in production.

### P2-4 Web-push subscribe is a blind SSRF sink and endpoints can be re-bound to another citizen
- **Where:** `server/routes/push.ts:180-199` (`endpoint: z.string().url()`), `server/push.ts:416-426`
  (`ON CONFLICT(endpoint) DO UPDATE SET citizen_id = excluded.citizen_id`), `:459-464` (`webpush.sendNotification` to
  the stored URL on every notification).
- **Fix:** allow only `https:` endpoints whose host matches known push services (`fcm.googleapis.com`,
  `*.push.apple.com`, `*.notify.windows.com`, `updates.push.services.mozilla.com`, …) or at least block private/loopback
  addresses; on conflict keep the existing `citizen_id` unless it equals the caller's.

### P2-5 Realtime: stale sockets outlive revoked sessions; several state changes never publish
- **Where:** `citizen-notification-realtime.ts:106-126` / `employee-work-queue-realtime.ts:177-208` authenticate once at
  upgrade; `onboarding.ts:537-618` (identity decision), `applications.ts:255-289` (request-document) and `:402-511`
  (approve), `service-requests.ts:636-672` (document verify/reject) do not call `employeeWorkQueueRealtime.publish`.
- **Fix:** store `sid` per socket and terminate on `revokeSession`/`revokeStaffSessions`/account disable (export a
  `closeSocketsForSession(sid)` from the realtime modules); publish `IDENTITY_REVIEW UPDATED` after a decision and
  `APPLICATION UPDATED` after request-document/approve; publish `SERVICE_REQUEST UPDATED` after checklist verification.

### P2-6 Audit-log completeness
- **Where:** `applications.ts:90-97` (staff view audited with `session.sub` — the staff id — instead of `session.actor`);
  `service-requests.ts:586-597` (employee/OPERATIONS reading a full request incl. phone and form data — no audit);
  `feedback.ts:405` (admin list — no audit); `documents.ts:63` (issued document list — no audit); `super-admin.ts:324`
  (citizen registry search — no audit); `payments.ts:337-346` (checkout start — no audit); `push.ts` subscribe/unsubscribe
  — no audit; `settlePayment` logs `role: 'CITIZEN'` even when the actor is `payment-gateway` (`intents.ts:168-175`);
  `resetDemo` deletes `audit_logs` (P0-1).
- **Fix:** audit every PII read with `session.actor`, add `entityType='ServiceRequest'` view events, `PAYMENT_CHECKOUT_STARTED`,
  `PUSH_SUBSCRIBED`; set `role: 'SYSTEM'` for gateway callbacks; make `audit_logs` insert-only (drop DELETE from
  `resetDemo`; a trigger `BEFORE DELETE ON audit_logs … RAISE(ABORT)` is cheap insurance).

### P2-7 Fake demo citizen is created in every database, including production
- **Where:** `server/db.ts:649-662, 1122` (`ensureDemoCitizen()` runs at import; inserts a `VERIFIED` citizen with a
  real-looking name and no `account_key`), `db.ts:793-797` (`getCitizen()` returns "the first citizen").
- **Fix:** only seed under `isTest`/an explicit `SEED_DEMO=true`; delete `getCitizen()` (unused for auth but a footgun).

### P2-8 Employee decision inputs without bounds / validation reach notifications and appointments
- **Where:** `service-requests.ts:691` (`appointmentDate: z.string()` — any length/format, written to
  `appointments.confirmation_note` and pushed to the citizen), `:487` (citizen-created `extra-N` checklist items —
  unbounded growth of the JSON blob), `applications.ts:113-120` (no `max()` on `businessName`, `address`, etc. →
  1 MB strings stored and rendered on the PDF).
- **Fix:** `appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`, `.max()` on every free-text field
  (`businessName 120`, `address 300`, …), cap checklist entries.

### P2-9 CSRF/CORS/cookie posture
- **Where:** `http/app.ts:38-48` (`localhost:5173/5174` and `127.0.0.1` stay in `allowedOrigins` in production;
  `X-CSRF-Token` is allowed but never checked — no CSRF middleware exists), `session.ts:133-136` (`SameSite=Lax`,
  `Secure` only when `secureHostedRuntime`), `payments.ts:374` (state-changing GET).
- **Assessment:** `SameSite=Lax` blocks cross-site POST cookies, so classic CSRF is mitigated for JSON/multipart
  routes; the exposure is (a) any page on `http://localhost:5173` on a staff machine (dev tooling) can call the API
  with credentials, (b) the payment return GET is a top-level navigation and does carry the cookie (mitigated only by
  the signed token for ZainCash — see P1-5 for sandbox).
- **Fix:** drop localhost origins when `isProduction`; either remove the `X-CSRF-Token` header from `allowedHeaders`
  or implement double-submit; mark the cookie `SameSite=Strict` for staff sessions (the SPA is same-origin) and add
  `__Host-` prefix in production.

### P2-10 CSP / helmet
- **Where:** `http/app.ts:16-37`.
- **Notes:** `styleSrc 'unsafe-inline'` (inline styles from React/leaflet — acceptable but nonce-able);
  `connectSrc 'ws:' 'wss:'` allows websockets to any host — restrict to `wss://<PUBLIC_BASE_URL host>` (`ws:` only in
  dev); `frameAncestors 'none'` + `X-Frame-Options SAMEORIGIN` disagree (harmless); no `Permissions-Policy`
  (`camera=(self), geolocation=(self), microphone=()` would be appropriate given the capture flows). HSTS present.
  The SPA fallback (`create-server.ts:64`) returns `index.html` with 200 for unknown `/api/*` paths — add a 404 JSON
  handler for `/api` before the fallback.

### P2-11 ZainCash callback hardening
- **Where:** `providers.ts:245-258, 327-339`.
- **Fix:** verify `exp`, `iat`, `orderid` format, `claims.id === stored provider_reference`, `claims.amount ===
  amount_iqd`; store `raw` claims in `payment_intents` for dispute handling; reject if `intent.provider !== 'zaincash'`.

### P2-12 Employee `service-requests` list is capped at 300 with no pagination and serialises payments+attachments per row (N+1)
- **Where:** `service-requests.ts:576-582` + `serializeServiceRequestForEmployee` (2 extra queries per row);
  `db.ts:867-874` `getApplications` → `mapApplication` (2 queries per row, no cap at all); `departments.ts:236-330`
  runs ~60 COUNT queries per dashboard hit; `super-admin.ts:353-359` orders `audit_logs` by `created_at` (unindexed).
- **Indexes missing** (confirmed on the dev DB): `applications(department, status)`, `applications(citizen_id)`,
  `application_events(application_id)`, `payments(application_id)`, `payment_intents(service_request_id, status)`,
  `payment_intents(citizen_id)`, `audit_logs(created_at)`, `audit_logs(action)`, `identity_verification_runs(review_id)`,
  `feedback_media(feedback_id)`, `service_requests(status, updated_at)`.
- **Fix:** add the indexes in the schema block; batch-load events/attachments with `WHERE application_id IN (…)`;
  paginate lists (`?cursor=`/`?limit=`); compute the dashboard series with one `GROUP BY substr(created_at,1,10)` query.

### P2-13 `LIKE` search terms are not escaped
- **Where:** `db.ts:823-825`, `staff-admin.ts:481-487`, `government-service-directory.ts:205`.
- **Fix:** escape `%`/`_` and add `ESCAPE '\'` (functional correctness for names containing `_`; also prevents
  `%`-only queries from becoming full scans on the audit table).

### P2-14 Backups are plaintext copies of the whole database next to the database
- **Where:** `db-ops/backup.ts:26-36` (`VACUUM INTO` under `dirname(databasePath)/backups`, default 14 days, listed via
  `/api/super-admin/system/database` with absolute paths).
- **Fix:** encrypt backups (`MEDIA_ENCRYPTION_KEY`-derived key) or ship them off-volume; do not expose absolute
  paths in the API; note that `resetDemo`/deletions are not reversible from the API — a restore path exists only as a
  script (`scripts/db-restore.mjs`).

---

## P3 — hygiene

- `server/identity-screening.ts:440-447`: the "7-second camera recording" check is a filename regex on
  `originalname` — trivially spoofable; label it as informational or measure duration with ffprobe.
- `server/routes/auth.ts:37-53`: the MFA challenge token is reusable for 5 minutes (TOTP replay is blocked by
  `totp_last_counter`, so impact is low); add a `jti` and store consumed ids.
- `server/auth/session.ts:259`: `mustChangePassword` bypass check is `req.path.startsWith('/api/auth/')` — fine, but
  `/api/auth/staff/mfa/setup` etc. are reachable before rotation; restrict to `change-password`/`logout`/`session`.
- `server/auth/staff.ts:440-443`: user-not-found path runs `hashPassword` **and** `verifyPassword` (two scrypt
  computations, ~2× the cost of a real login) — precompute one dummy hash at module load.
- `server/routes/citizen.ts:72`: `/api/citizen/demo` naming; returns the citizen profile — rename to `/api/citizen/me`.
- `applications.ts:460`: `LIC-YYYY-<id>` document number derived from the row id (predictable); the verification id
  is random, so this only leaks volume.
- No route exists to set `issued_documents.status = 'REVOKED'` although `reject` tells the employee to "use the
  official cancellation path" (`applications.ts:370`).
- `service-requests.ts:64`: form fields hidden from the PDF by a regex on key names — make it an explicit
  `printOnDocument` flag in the catalog schema.
- `otp.ts:281`: on provider failure the challenge row is deleted, so the per-phone/IP counters do not count failed
  sends — an attacker can spam the SMS provider until the OTPIQ quota is exhausted; keep the row with
  `delivery_status='FAILED'`.
- `push.ts:399-402`: per-process VAPID keys outside production mean every restart invalidates subscriptions — fine
  for dev, but log it.

---

## Tests (`pnpm test`: 2 files, 34 tests, all pass in 12.5 s)

Gaps that let the findings above ship:
- `tests/api.test.ts:279-293` asserts that an EMPLOYEE **can** list identity reviews — it enshrines P1-1. Change it to
  expect 403 for EMPLOYEE and 200 for IDENTITY_REVIEWER/SUPER_ADMIN, and add a media-IDOR test.
- No test for department scoping of store-licence applications (P0-2), for `upload-document` state transitions
  (P0-3/P0-4), for `/api/system/reset-test-data` (P0-1), for `/api/verify/:id` projection (P1-2), for the super-admin
  citizens list count (P1-3), for media purge (P1-4), for unauthenticated `/api/payments/return/*` (P1-5), for
  reference collisions after deletion (P1-10), for cross-department feedback/issued-document access (P1-11), or for
  identity resubmission limits (P1-12).
- Upload validation is only exercised with a valid JPEG/WebM; add mismatched-magic-byte and oversize cases, and a
  test that error responses never contain a filesystem path.
- The payments suite runs only with the sandbox provider; add unit tests for `verifyJwtHs256` (tampered signature,
  wrong `orderid`, expired) and for `settlePayment` idempotency/`FAILED → PAID`.
- Tests run with `NODE_ENV=test`, so nothing covers the `NODE_ENV=production` branches (P2-2): add a boot-time
  test that production refuses to start without the required secrets and does not register dev routes.
