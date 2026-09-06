# Staff-side QA audit — ذي قار الرقمية

Date: 2026-09-06 · Scope: everything staff touch — `/staff/login`, `/staff/security`, `/employee` (all tabs),
`/department/:id`, `/operations`, `/governor`, `/super-admin` (all tabs) — as EMPLOYEE (with and without a
department), IDENTITY_REVIEWER, OPERATIONS and SUPER_ADMIN, plus anonymous; desktop 1366 px and mobile 390 px,
light and dark (`data-gov-theme="dark"`).

Method: Playwright walk of 50 route×role combinations × 2 viewports × 2 themes
(`scripts/dev/audit-staff-browse.mjs`, raw data `qa-screens/audit-staff/report.json`), interactive probes
(`scripts/dev/audit-staff-flows.mjs`, `qa-screens/audit-staff/flows.json`), direct API role-boundary probes with
curl (accounts `emp.sewer` (sewerage), `emp.nodept` (no department), `reviewer.qa`, `ops.qa` created via
`/api/super-admin/staff`; identity-review rows seeded into `identity_reviews` because the upload path depends on the
OCR worker documented in the citizen audit), and a source read of `src/pages/{employee,department,operations,
super-admin,staff,auth}`, `src/components/{shared,operations,citizen/PortalLayout}`, `server/auth/*`, `server/routes/*`.
Evidence screenshots: `qa-screens/audit-staff-*.png` (full walk in `qa-screens/audit-staff/`).

Severity: **P0** blocker (data loss, security, wrong decisions on citizens' files) · **P1** major (a role cannot do
its job or sees what it must not) · **P2** minor (wrong/awkward but there is a way through) · **P3** polish.

Note on the rate limiter: `sensitiveLimiter` (30 requests / 10 min per IP) was hit within minutes of normal testing
and blocked logins; the walk used `X-Forwarded-For` to work around it — see P1-8.

---

## P0 — blockers

### P0-1 Any EMPLOYEE can wipe every store-licence application and the whole audit log with one request
- **Where:** `POST /api/system/reset-test-data` → `server/routes/system.ts:6-18` (`requireSession('EMPLOYEE')`, then `resetDemo()` in `server/db.ts:1109`).
- **What:** the route is registered for the regular EMPLOYEE role and only skipped when `NODE_ENV === 'production'`. `resetDemo()` runs `DELETE FROM payments; DELETE FROM notifications; DELETE FROM application_events; DELETE FROM applications; DELETE FROM audit_logs`. Nothing in `nixpacks.toml`/`railpack.json` sets `NODE_ENV`, so any staging/preview/self-hosted instance is exposed, and even in production a mis-set env deletes the legal audit trail. The audit entry it writes afterwards is attributed to the fake actor `'Local Operator'`, not the session.
- **Evidence:** as `emp.sewer` (EMPLOYEE, sewerage): `POST /api/system/reset-test-data` → `200 {"success":true}`; `GET /api/applications` afterwards → `[]`, `audit_logs` count 79 → 2. (Data was restored for this audit from `data/backups/…startup.sqlite`.)
- **Fix:** delete the route from the production bundle (register only when `process.env.NODE_ENV === 'test'` or behind `ENABLE_TEST_RESET=true`), never on EMPLOYEE — at most SUPER_ADMIN with `sensitiveLimiter` and a real audit actor; never `DELETE FROM audit_logs` (audit tables must be append-only).

### P0-2 Store-licence decisions are not scoped to the employee's department — and no department employee can see them anyway
- **Where:** `server/routes/applications.ts:255` (`request-document`), `:363` (`reject`), `:402` (`approve`) — `requireSession('EMPLOYEE','SUPER_ADMIN')` and no department check. Listing at `:66-71` and the department dashboard (`server/departments.ts:236,264,275,286,296,309`) match on the free-text `applications.department` **name**, which is set from the client (`serviceName/department` in `req.body`, citizen audit P0-3) and currently holds `"بلدية الناصرية"` while the registry names are `"مديرية بلدية الناصرية"` / `"مديرية بلديات ذي قار"`.
- **What:** (a) an employee of any department can request documents, reject, or approve+issue a licence PDF for an application belonging to another department; (b) an EMPLOYEE with no department (`scopedName === undefined`) sees **all** applications; (c) the municipalities employee — the intended reviewer — sees **zero** applications (`/employee#employee-applications` → "لا توجد معاملات"), and the department dashboard KPIs/chart/table never include licence applications.
- **Evidence:** `emp.sewer` → `POST /api/applications/TQD-2026-0002/request-document {"documentName":"اختبار عبر دائرة أخرى"}` → `200`, application moved to `ACTION_REQUIRED` and the citizen was notified. `emp.nodept` → `GET /api/applications` → 3 rows. `emp.muni` → `[]` (`qa-screens/audit-staff-employee-store-licence-empty.png`). `applications.department` values: `('بلدية الناصرية')×3`; no such name in `departments`.
- **Fix:** store `department_id` on `applications` (resolve server-side from the service catalog), scope list/detail/actions with the same `canActOn()` used for service requests (`server/routes/service-requests.ts:169`), and return 403 for other departments; backfill existing rows.

### P0-3 Every EMPLOYEE sees the complete identity-verification queue of all citizens (ID images, full document number, phone, GPS), and the decision buttons are shown to them
- **Where:** `GET /api/admin/identity-reviews` and `GET /api/admin/media/:id` → `server/routes/onboarding.ts:415-417, 515` (`requireSession('EMPLOYEE','IDENTITY_REVIEWER','SUPER_ADMIN')`, no department/role filter); `extractedFields.documentNumber` returned unmasked (`:430`, `extracted_data`); UI `src/pages/employee/IdentityReviewPanel.tsx:271-293` renders رفض / طلب إعادة الرفع / اعتماد for every role.
- **What:** a municipalities clerk opens "مراجعة الهوية" and gets every citizen's national-ID front/back, face video, OCR'd full document number (the list masks it as `********5678`, the detail card prints `199012345678`), phone and device location with an OpenStreetMap link. Clicking "اعتماد بعد المراجعة" only fails afterwards with `هذا الإجراء يتطلب صلاحية مراجع الهوية.` — the page itself says the decision needs the reviewer role, then offers the buttons.
- **Evidence:** `emp.sewer` → `GET /api/admin/identity-reviews` `200` (3 rows), `GET /api/admin/media/media_4904…` `200` (image bytes); flows `C.employeeIdentityApprove`: `buttonVisible: true`, `fullDocNumberShown: true`, error text as above; `qa-screens/audit-staff-employee-identity-queue-visible.png`, `audit-staff-employee-identity-forbidden.png`.
- **Fix:** restrict list/media/decision to IDENTITY_REVIEWER and SUPER_ADMIN (`requireReviewAccess` on the GET routes too); hide the tab and the work-queue tile for EMPLOYEE; mask `documentNumber` in `extractedFields` (or show it only to reviewers behind an explicit "إظهار" that is audited); keep `national_id_masked` and the OCR number consistent.

---

## P1 — major

### P1-1 OPERATIONS staff cannot open the security page (no MFA, no password change, no session list)
- **Where:** `src/App.tsx:93-97` (`<SessionGate role="EMPLOYEE">` around `/staff/security`); `src/components/shared/SessionGate.tsx:24-33` only lets OPERATIONS through for `/department/*`. `StaffLoginPage.allowedPrefixes.OPERATIONS` includes `/staff` (`src/pages/auth/StaffLoginPage.tsx:18`) so the login page happily redirects there.
- **What:** `ops.qa` → `/staff/security` → "الدخول مطلوب — سجّل دخولك بحسابك الوظيفي". The operations room is the role with the widest read access to citizen data and has no way to enable TOTP. The operations shell also has no link to the page (`OperationsShell` nav) and its "exit" icon goes to the citizen `/login` chooser instead of logging out (`src/components/operations/OperationsShell.tsx:62`).
- **Evidence:** `qa-screens/audit-staff-operations-security-denied.png`; flows report `operations /staff/security → h1 "الدخول مطلوب"`.
- **Fix:** add an `ANY_STAFF` gate (all four staff roles) for `/staff/security`; add "الأمان" + a real logout button to `OperationsShell`.

### P1-2 IDENTITY_REVIEWER's dashboard shows zeros and a JS error; the reviewer never sees how many identities are pending
- **Where:** `src/pages/employee/EmployeeDashboard.tsx:43-52` (`Promise.all([api.listApplications(), api.getEmployeeWorkQueueSummary()])`) — `GET /api/applications` is `EMPLOYEE|SUPER_ADMIN` only (`server/routes/applications.ts:66`), so the whole `load()` rejects and `setWorkQueue` never runs; `void load()` leaves the rejection unhandled.
- **What:** tiles read "معاملات محلية جديدة 0 / طلبات خدمات جديدة 0 / مواطنون بانتظار مراجعة الهوية 0" and the tab badges are empty while one identity review is pending; console shows an unhandled `Error: انتهت جلسة الدخول أو لا تملك صلاحية…` on every load. The reviewer is also shown the store-licence tab, the complaints tab and the archive, all of which fail with 401 for that role, and the service-request tab says "حسابك غير مرتبط بدائرة بعد" although a reviewer has no department by design.
- **Evidence:** flows `F.reviewerEmployeePage` (`tiles … 0 | 0 | 0`, `errors: ["انتهت جلسة الدخول…"]`); browse report `reviewer /employee… 401 GET /api/applications` + `PAGEERROR`.
- **Fix:** load the summary independently (`Promise.allSettled`), skip `listApplications` for non-EMPLOYEE roles, and render a role-specific tab set (reviewer: identity only; hide "لوحة دائرتي"/"قائمة الدائرة" copy). Also fix `/api/employee/work-queue-summary` (`applications.ts:19`) which counts **all** departments' service requests for non-EMPLOYEE roles — the reviewer badge said 2 while the list was empty.

### P1-3 Super-admin "سجل المواطنين" always shows exactly one citizen
- **Where:** `server/db.ts:845` — `MAX(COALESCE(c.updated_at, c.created_at)) AS last_activity_at` is an aggregate with no `GROUP BY`, so SQLite collapses the result to a single row.
- **What:** the registry, its "1 نتيجة ظاهرة" counter, and every filter/search return at most one citizen regardless of how many exist (4 in the dev DB).
- **Evidence:** `GET /api/super-admin/citizens` → 1 row; `SELECT COUNT(*) FROM citizens` → 4; `qa-screens/audit-staff-superadmin-citizens-one-row.png`.
- **Fix:** replace with `COALESCE(c.updated_at, c.created_at) AS last_activity_at` (no aggregate) and add a test asserting `citizens.length === COUNT(*)`.

### P1-4 Dark mode: the employee's working area is unreadable (light text on white cards)
- **Where:** `.service-request-checklist li`, `.service-request-current-action`, `.gov-segmented button b`, `.department-dashboard-actions a.ghost`, `.sidebar-logout` — backgrounds stay `#fff`/`#f8faf9` while text switches to the dark-theme foreground (`src/styles/portal-theme.css` / `staff.css` lack dark overrides for these classes).
- **What:** on `/employee` in dark mode the checklist rows show `color rgb(231,236,233)` on `bg rgb(255,255,255)` (≈1.1:1), the "current action" banner is `rgb(231,236,233)` on `rgb(248,250,249)`, "لوحة دائرتي" is `rgb(36,68,55)` on `rgb(18,28,23)` (≈1.5:1), the "الكل 3" counter and the logout button are invisible. The same components are embedded in `/department/:id`.
- **Evidence:** flows `L.darkContrast`; `qa-screens/audit-staff-employee-dark-unreadable-cards.png`.
- **Fix:** use the theme tokens (`var(--surface)`, `var(--text)`) for those components and add a Playwright contrast check on `[data-gov-theme=dark]` for `.service-requests-admin`.

### P1-5 Super-admin "الدوائر والخدمات" tab makes the whole page 13,000 px wide
- **Where:** `src/pages/super-admin/DepartmentManagementPanel.tsx:88-100` (`.department-workbench-tabs` renders one chip per department — 80 chips); the strip's `overflow-x:auto` is set but its width is not constrained, so `.ops-main` grows to `scrollWidth 13203`.
- **What:** desktop and mobile both get a horizontal page scroll; the department chooser is a 13 k-px chip row with no search, no grouping, no selected-chip scroll-into-view. Editing a service's requirements uses `window.prompt` (`:32`), a native LTR dialog that then turns every line into a *required upload* for citizens (citizen audit P0-6). "إيقاف الاستقبال" toggles a public service with no confirmation.
- **Evidence:** flows `A.departmentsTabOverflow` (`bodyScrollWidth 13203`, `stripScrollWidth 17990`, `chips 80`); `qa-screens/audit-staff/superadmin-super_admin_departments-desktop-light.png` (13203×1545).
- **Fix:** give the strip `max-width:100%; min-width:0` inside a grid with `minmax(0,1fr)`, or replace it with a searchable `<select>`/list; replace `prompt()` with an in-page textarea editor that distinguishes documents from instructions; confirm before pausing a service.

### P1-6 Super-admin header is broken: blank avatar box, wrapped "إنهاء الجلسة", "تحديث" label under the icon; the same blank avatar on `/operations` and `/governor`
- **Where:** `src/pages/super-admin/SuperAdminDashboard.tsx:96-106` (`.ops-header-actions` with 4 controls), `OperationsCenter.tsx:60-66`, `GovernorDashboard.tsx:31-33` (`<div className="user-avatar gold">`), `.ops-header-actions .user-avatar` colour in `src/styles/staff.css`.
- **What:** the avatar renders as an empty white square (initials same colour as background), the action buttons wrap into two-line pills at 1366 px, and the refresh button loses its label. This is the first thing the governor sees. In the operations shell the sidebar shows icons only, without labels or `aria-label` (see P2-9).
- **Evidence:** `qa-screens/audit-staff-superadmin-header-avatar-blank.png`, `audit-staff-governor-empty-score.png`.
- **Fix:** give `.ops-header-actions` `flex-wrap:wrap; gap` and `white-space:nowrap` on buttons; set the avatar foreground/background tokens for the light theme; show the display name next to it.

### P1-7 Governor dashboard opens on "— /100 بانتظار مصدر قياس مؤسسي" and 58 departments with "0 طلب مسجل"
- **Where:** `src/pages/operations/GovernorDashboard.tsx:35-68, 97-108`; `/operations` health panel `OperationsCenter.tsx:176-195` (hard-coded rows with fixed 65 %/35 % bars), finance panel vs. KPI.
- **What:** the hero score ring is fully green while the value is "—"; SLA and satisfaction are "—" with 0 % bars; the ranking lists all 60 registry departments (57 with zero) and store-licence applications count for nobody (P0-2). On `/operations` the KPI says "التحصيل اليوم 5,000 د.ع — تسويات مؤكدة" while two panels on the same screen say "لا يسجل تحصيل قبل مزود دفع" and "لا توجد تسوية مالية حية أو تحصيل فعلي". "صحة المنظومة" bars are static text, not measurements. Mobile `/operations` is 27,514 px tall (60 registry cards × 4 zero KPIs).
- **Evidence:** `qa-screens/audit-staff-governor-empty-score.png`, `audit-staff-operations-finance-contradiction.png`, `audit-staff/operations-operations-mobile-light.png`.
- **Fix:** hide the score ring until a metric exists (or show a neutral "لم يُفعّل" card), rank only departments with activity, label sandbox money as "محاكاة", drop the fake health rows or wire them to `/api/super-admin/system/database` + `/api/health`, and collapse the registry list behind search/pagination.

### P1-8 One shared rate-limit bucket (30 / 10 min per IP) covers login, MFA, password change and all super-admin edits
- **Where:** `server/http/rate-limit.ts:16-23` (`sensitiveLimiter`), applied in `server/routes/auth.ts` and to every `staff-admin.ts` / `super-admin.ts` mutation.
- **What:** a department office behind one NAT address gets 30 login attempts per 10 minutes *in total*, and the super admin's staff table fires one limited request per dropdown change — during this audit the limiter blocked logins and password changes after a few minutes of ordinary use with the message "تجاوزت الحد المؤقت لهذه العملية الحساسة".
- **Evidence:** `POST /api/auth/staff/login` → `429` after ~30 mixed requests from one IP; the browse script had to spoof `X-Forwarded-For` (`trust proxy` is 1, so locally the header is honoured — fine behind Railway/Render, but it means local rate limiting is trivially bypassed).
- **Fix:** separate buckets: login keyed by IP+username (e.g. 10/15 min), MFA by challenge token, admin mutations by staff id with a higher ceiling; keep the per-account lockout that already exists.

### P1-9 Realtime updates are only published for some events, and never to the operations room
- **Where:** `server/routes/service-requests.ts:636-672` (document verify/reject: no `employeeWorkQueueRealtime.publish`), `:700-736` (PAYMENT_REQUIRED branch returns before the publish at `:837`), `server/routes/feedback.ts` (no publish on new complaint or status change), `server/routes/onboarding.ts:537-618` (identity decision: no publish); `server/employee-work-queue-realtime.ts` authenticates only `EMPLOYEE|IDENTITY_REVIEWER|SUPER_ADMIN`, so `/department/:id` opened by OPERATIONS logs `WebSocket … 401` every reconnect (browse report).
- **What:** creation of a service request does refresh a colleague's queue (verified: rows 3 → 4 without reload), but a document verdict, a fee request, a complaint, or an identity decision by another staff member does not; two clerks can work the same request without seeing each other's checklist changes until a manual refresh. Operations relies on a 20 s poll and gets console errors.
- **Evidence:** flows `E.realtime`; source lines above; browse report `operations /department/… WebSocket connection … failed: HTTP Authentication failed`.
- **Fix:** publish `SERVICE_REQUEST UPDATED` after every mutation (extract a helper), publish `FEEDBACK`/`IDENTITY_REVIEW` events, accept OPERATIONS on the socket (read-only) or skip the connect for that role in `PortalLayout.tsx:132`.

### P1-10 Employee work-board numbers are wrong for the role that uses it most
- **Where:** `src/pages/employee/EmployeeDashboard.tsx:126-128` ("هناك N معاملات تحتاج مراجعة" counts store-licence apps only), `:167-197` (KPI row counts apps only; "التأخير التشغيلي — بانتظار SLA" placeholder), `:141-166` ("معاملات محلية جديدة" vs tab "معاملات إجازة المحل").
- **What:** with 3 open service requests the header says "هناك 0 معاملات تحتاج مراجعة" and all four KPIs read 0; the phrase is also grammatically off ("هناك 1 معاملات"). The work-queue tile, the KPI row and the tabs use three different names for the same thing (معاملات محلية / معاملات إجازة المحل / المعاملات).
- **Evidence:** `qa-screens/audit-staff-employee-dashboard-zero-counts-fake-docs.png`.
- **Fix:** derive the headline and KPIs from `workQueue` (service requests + applications + identity), pluralise correctly (`معاملة/معاملتان/معاملات`), remove the SLA placeholder tile until SLA exists, unify the label to "معاملات إجازة المحل".

---

## P2 — minor

### P2-1 Employee cannot save anything on a PAYMENT_PENDING request; the status dropdown silently shows "قيد التدقيق"
- **Where:** `src/pages/employee/ServiceRequestAdminPanel.tsx:68-72` (`setStatus(item.status as Decision)` with `PAYMENT_PENDING`, which is not an option) → server zod rejects (`service-requests.ts:687`).
- **Evidence:** flows `D.paymentPendingSelect` (`value: UNDER_REVIEW` shown, state `PAYMENT_PENDING`) → save → "تحقق من الحالة ووصف الإجراء قبل الحفظ."
- **Fix:** map `PAYMENT_PENDING`/`APPOINTMENT_REQUESTED` to `UNDER_REVIEW` in `selectItem`, or show a read-only "بانتظار سداد الرسم" state with only "إلغاء الرسم/رفض" available.

### P2-2 "حجز موعد" requests force the employee to "verify" two fake documents before approving
- **Where:** employee side of citizen P0-6 — `ServiceRequestAdminPanel.tsx:325-403` renders "تحديد الدائرة والغرض" / "اختيار تاريخ ووقت مفضلين" as checklist rows with صحيح/غير مقبول; APPROVED is disabled until both are "verified"; no "تأكيد الموعد" action exists — the appointment date must be typed again in the APPROVED form.
- **Evidence:** `qa-screens/audit-staff-employee-dashboard-zero-counts-fake-docs.png` (TQS-2026-00004).
- **Fix:** with the catalog fix, add an "تأكيد الموعد" decision that pre-fills `appointmentDate/Time` from `appointments` and confirms it (`service-requests.ts:810-818` already updates the row).

### P2-3 Must-change-password accounts can open `/employee` and get raw 403 errors
- **Where:** `/employee` is not wrapped in `SessionGate` (`src/App.tsx:143`); `EmployeeDashboard.tsx:53-64` checks role only.
- **Evidence:** flows `H.mustChangeDirectEmployee`: page renders "مرحباً حساب، لوحة عمل المراجعة" with the banner "يجب تغيير كلمة المرور المؤقتة قبل استخدام المنصة." and no link; `/department/...` correctly redirects.
- **Fix:** wrap `/employee` in `SessionGate role="EMPLOYEE"` (it already handles `mustChangePassword`) and drop the duplicate check.

### P2-4 Wrong MFA code (and replayed code) shows "انتهت جلسة الدخول أو لا تملك صلاحية الإرسال…"
- **Where:** `src/api.ts:32-34` maps every 401 not ending in `/login` to the session-expired text; `/api/auth/staff/mfa` returns 401 for a bad code (`server/routes/auth.ts:150`).
- **Evidence:** flows `I.mfaLogin.mfaErr`. Also: a code used to confirm enrolment is rejected at first login within the same 30 s window ("مستخدم سابقاً") with the same misleading text.
- **Fix:** exempt `/api/auth/staff/mfa` (and `/change-password`, `/mfa/disable`) from the generic mapping; return 400 for bad codes; after enrolment tell the user to wait for the next code.

### P2-5 Super-admin irreversible actions have no confirmation and no accessible name
- **Where:** `StaffAccountsPanel.tsx:246-304` (reset password, reset MFA, disable — icon buttons with `title` only; role/department `<select>` fires a PATCH on change, which revokes the user's sessions `staff-admin.ts:83`); `GovernmentServiceAdminPanel`/`DepartmentManagementPanel` toggles.
- **Evidence:** flows `G.resetWithoutConfirm`: one click on the key icon reset `emp.nodept`'s password and revoked their sessions; 24 icon buttons without `aria-label`. Creating/updating with a bogus department returns `400 "FOREIGN KEY constraint failed"` / `500` generic text (`staff-admin.ts:45,84` do not validate `departmentId` against the registry).
- **Fix:** confirm dialog naming the account and the consequence, `aria-label`s, validate `departmentId` server-side with an Arabic message, and disable the role/department selects for the current admin's own row.

### P2-6 Department dashboard details: raw enums, raw session UUIDs, Arabic-Indic vs Latin digits, orphan KPI tile, light-only chart colours
- **Where:** `DepartmentDashboardPage.tsx:274` (`APPOINTMENT_REQUESTED` / `PAYMENT_PENDING` missing from `statusLabels`), `:353` (`item.status` raw e.g. `RECEIVED`), `:374` (`entityType entityId` → "Session 68325838-7cd8-…", "IdentityReviewQueue all"), `:32-33` (`ar-IQ` numerals while the rest of the platform uses `en-GB`), `:61-85` (7 tiles → one orphan on the second row), `:151-169` (hard-coded `#e3ebe6` grid, white tooltip in dark mode).
- **Evidence:** `qa-screens/audit-staff-department-activity-raw-ids.png`, `audit-staff/employee-department_dhiqar_municipalities-desktop-dark.png`.
- **Fix:** extend `statusLabels`, use `feedbackStatusLabels`, humanise audit entities ("جلسة", "طلب TQS-…") and hide session ids, pick one numeral system, make the KPI grid 4+3 or 6 tiles, theme the chart via CSS variables.

### P2-7 Super-admin overview audit list is unusable as an audit log
- **Where:** `SuperAdminDashboard.tsx:194-210` — 20 latest rows, raw role enums (`SUPER_ADMIN`), raw `Session / <uuid>` entities, no filters, no link to more; `api.listAuditLogs` (`src/api.ts:153`) and `GET /api/super-admin/audit-logs` (actor/action filters, 500 rows) exist but no page calls them.
- **Fix:** an "سجل التدقيق" tab with actor/action/date filters, Arabic role labels (`staffRoleLabels`), `auditActionLabel`, and export.

### P2-8 "الأرشيف" and "سجل الإجراءات" tabs only know about store-licence applications
- **Where:** `EmployeeDashboard.tsx:491-579` — archive = `apps.filter(APPROVED)`, activity = last 12 apps sorted by `updatedAt`; issued service-request documents (`api.listEmployeeIssuedDocuments`, `/api/employee/issued-documents`) and the audit log are never shown, so both tabs are empty for every department employee (see P0-2) and "سجل الإجراءات" is not a log at all.
- **Fix:** archive = issued documents (with PDF links) + closed service requests; activity = department-scoped audit entries (the department dashboard already has them).

### P2-9 Operations/super-admin sidebar is icon-only with no labels or tooltips; mobile collapses it to an unlabeled icon bar
- **Where:** `src/components/operations/OperationsShell.tsx` + `.ops-sidebar` CSS (labels hidden at ≤1366 px), exit icon → `/login`.
- **Evidence:** `qa-screens/audit-staff-superadmin-overview-raw-audit.png` (left rail), `audit-staff/superadmin-super_admin_staff-mobile-light.png`.
- **Fix:** show labels ≥1200 px, add `aria-label`/`title` otherwise, and turn the exit icon into "تسجيل الخروج" calling `logoutAndRedirect`.

### P2-10 Complaints panel has no department scoping, no citizen, no department, raw coordinates
- **Where:** `server/routes/feedback.ts:125-129` (all EMPLOYEEs see and can close every complaint), `FeedbackAdminPanel.tsx:150-172` (no `departmentId`/citizen name; "الموقع: 31.05200, 46.24900" with no map link; status select has no "إحالة إلى دائرة").
- **Evidence:** `emp.sewer` → `GET /api/admin/feedback` `200` (electricity complaint).
- **Fix:** scope by `departmentId` (unassigned complaints to a triage role/super admin), show department + citizen (masked phone), link coordinates to the map, add "إحالة".

### P2-11 Employee "عرض الصورة" links and IDENTITY_REVIEWER/OPERATIONS mismatches
- **Where:** `ServiceRequestAdminPanel.tsx:359-366` opens `/api/employee/service-requests/:ref/media/:id` in a new tab — for IDENTITY_REVIEWER the route is not allowed (`service-requests.ts:602`) and the tab shows raw JSON `{"message":"تحتاج جلسة دخول صالحة…"}`; OPERATIONS gets **401** (not 403) on any PATCH so the UI tells them their session expired.
- **Fix:** return 403 with a role message when the session is valid but the role is wrong (`requireSession`), hide the link for roles that cannot open media, or render media inline as the identity panel does.

### P2-12 Identity-review panel states
- **Where:** `IdentityReviewPanel.tsx:123` (no empty state when the queue is empty — the section shows just a heading), `:151` (detail badge always `pending` class even for APPROVED/REJECTED), `:157` ("الاحتفاظ حتى: 31/12/9999" — retention "forever" printed as year 9999), `:283-291` (reject/approve with no confirmation and with an empty note; the citizen then receives the generic text), `:168` (`NATIONAL_ID` raw).
- **Fix:** empty state "لا توجد طلبات مراجعة", status-driven badge class, "احتفاظ دائم (بموافقة المواطن)" when retention is the sentinel, require a note for REJECTED/NEEDS_RESUBMISSION, translate `documentTypeDetected`.

### P2-13 Store-licence review panel shows hard-coded citizen data and has dead buttons
- **Where:** `EmployeeDashboard.tsx:288-299` ("الرقم الوطني ********** 4821" and "حالة الهوية: موثّقة يدوياً أو قيد المراجعة" are literals for every application), `:223-225` and `:268-270` (search and archive icon buttons with no handler — flows `K.deadButtons`), `:90` ("طلب مستند" sends the literal "المستند المطلوب", so the citizen is told "يرجى رفع المستند المطلوب").
- **Fix:** read the masked id / verification status from the application, remove or wire the icon buttons, and ask the employee which document is required (free text like the service-request form).

---

## P3 — polish

- **P3-1** Employee topbar search (`PortalLayout.tsx:170-180`) searches the *citizen* catalogue and links to `/service/:key` citizen forms; for staff it should search references/citizens or be hidden.
- **P3-2** Sidebar "جلسة محمية — آخر نشاط: الآن" is static text (`PortalLayout.tsx:252-256`); show the real `lastSeenAt` or drop it.
- **P3-3** Mobile `/employee`: the workspace tab bar scrolls horizontally (902 px in a 360 px viewport) with no scroll cue; the mobile bottom bar has only 4 of the 7 sections (flows `B.mobileBottomNav`).
- **P3-4** `/staff/security`: `session.role` printed raw when no department (`SecurityPage.tsx:290` → "مدير النظام — SUPER_ADMIN"); session rows show raw user-agent strings and `ar-IQ` numerals; no IP/last-location column although `ip_hash` exists.
- **P3-5** `/staff/login`: English eyebrow "STAFF ACCESS"; no "نسيت كلمة المرور؟ راجع مدير النظام" hint; disabled primary button is low-contrast in dark mode.
- **P3-6** `SuperAdminDashboard` "النظام والنسخ الاحتياطي" prints `SQLITE • WAL` and backup file names in English; `SystemHealthPanel.tsx:43`.
- **P3-7** `readSession` (`server/auth/session.ts:116`) silently drops a session when the super admin changes a user's role — the user is logged out mid-work with no message; the `revokeStaffSessions(id,'ROLE_CHANGED')` in `staff-admin.ts:83` should also inform the admin ("سيُخرج المستخدم من جلسته").
- **P3-8** `server/auth/staff.ts:225-239` `updateStaffProfile` accepts `departmentId` for SUPER_ADMIN/OPERATIONS (meaningless) and any string for EMPLOYEE — validate against `departmentRegistry` and clear it for global roles.
- **P3-9** Legacy accounts `employee` / `operations` (bootstrapped from env passwords, `staff.ts:319-335`) remain listed forever with "بانتظار تغيير كلمة المرور"; offer a "تعطيل الحسابات القديمة" action once real accounts exist.
- **P3-10** Chart panels in `/operations` and `/governor` have fixed dark colours in the light theme (`#09291d` tooltips), and the pie in "حالة معاملات اليوم" renders as a lone blue arc when only one bucket has data.

---

## Role-boundary matrix (verified with curl, `qa-screens/audit-staff/flows.json`)

| Check | Result |
| --- | --- |
| EMPLOYEE (sewerage) read/act on municipalities **service request** | 403 ✔ |
| EMPLOYEE (sewerage) act on municipalities **store-licence application** | **200 ✘** (P0-2) |
| EMPLOYEE with no department | service requests: empty + message ✔; **applications: all ✘** |
| EMPLOYEE identity queue / media | **200 ✘** (P0-3); decision 403 ✔ |
| EMPLOYEE `reset-test-data` | **200 ✘** (P0-1) |
| OPERATIONS list all service requests / open media / dashboards | 200 (read-only by design) |
| OPERATIONS PATCH service request | 401 (should be 403, P2-11) |
| IDENTITY_REVIEWER decide identity | 200 ✔; applications/feedback 401 ✔ |
| Disabled account | existing session invalid immediately, login "هذا الحساب معطّل" ✔ |
| Password change revokes other sessions | ✔ (`otherSessionsRevoked`) |
| MFA enrol → login requires code; replay blocked | ✔ (message wording P2-4) |
| Lockout after 5 failures | ✔ (but shared IP limiter triggers first, P1-8) |
| Realtime: new request appears without reload | ✔; other mutations ✘ (P1-9) |
