# Design-system & Arabic copy audit — public surfaces of ذي قار الرقمية

Date: 2026-09-06 · Scope: `/`, `/directory` (+ `?q=`, filters, empty state), `/service/<key>` for every channel type
(ONLINE_SUBMISSION `muni-dir-complaint-against-municipality`, APPOINTMENT_REQUIRED `nid-first-issue`, INFORMATION_ONLY
`national-id` + `airport-flight-inquiry`, fee service `health-birth-certificate`, specialized `store-license`),
`/departments`, `/departments/dhiqar-municipalities`, `/login`, `/staff/login`, `/onboarding`, `/verify`, 404.
Viewports 1440 / 1024 / 390 px, light and dark (`data-gov-theme="dark"`).

Method: Playwright walk (`scripts/dev/audit-design.mjs`, 17 routes × 3 viewports × 2 themes) that records for every
visible text node the computed font family/size/line-height/colour, the effective background (walking ancestors and
alpha-blending), WCAG contrast, border colours, radii, button styles, icon sizes, `<a href>` targets, images and
overflow; raw data in `qa-screens/audit/design/report.json`. Follow-up scripts: `audit-design-shots.mjs`
(reveal animations disabled), `audit-design-links.mjs` (every internal link fetched and checked for the SPA 404 text),
`audit-design-focus.mjs` (focus / hover / images), `audit-design-rhythm.mjs` (section padding, container widths),
`audit-design-fontuse.mjs`. Screenshots: `qa-screens/audit-design-<route>-<viewport>-<theme>.png` (87 files).
No source files were modified.

Severity: **P0** — the platform looks broken to a citizen on a default page (unreadable / invisible content) ·
**P1** — clearly wrong design or blocks a task at a supported viewport · **P2** — inconsistent / off-system ·
**P3** — polish.

---

## Executive summary (what the numbers say)

| Measure (1440 px, light, all 17 routes) | Found | Target |
| --- | --- | --- |
| Body font actually rendered | `"Segoe UI", Tahoma, Arial` on **2,733** text nodes; `IBM Plex Sans Arabic` on **0** (all 4 self-hosted weights report `status: unloaded`) | IBM Plex Sans Arabic |
| Headings/buttons in Noto Kufi | h1–h4 + `strong` only (496 nodes); **no button** uses Noto Kufi (`App.css:42 button{font:inherit}` beats `index.css:30`) | headings + buttons |
| Distinct text colours | **71** (dark: 40) | ≤ 12 |
| Distinct background colours | **65** (dark: 39) | ≤ 10 |
| Distinct border colours | **43** (dark: 23) | ≤ 5 |
| Distinct border radii in use | **18** (`8,999,12,16,4,6,5,14,50%,2,10,7,18,20,3,22,24,13px`); 25 distinct values declared in CSS | 4 (`4/8/12/999`) |
| Distinct hex colours declared across CSS | **1,534** (2,288 literals; `App.css` alone is 18,969 lines) | tokens only |
| Distinct button styles (class × font × size × height × radius × colours) | **81** | ~8 |
| Distinct icon sizes (rendered SVG boxes) | **15** (11→26 px) | 3 (14/18/24) |
| Text nodes < 12 px | **352** at 1440 px (59 nodes at 9 px, 51 at 10 px, 31 at 8 px) | 0 |
| Text nodes with `line-height: normal` | **2,471** of ~3,260 | explicit ≥ 1.6 for Arabic body |
| WCAG AA contrast failures (unique selector × colour) | **34** light · **46** dark, 21 of them below 1.6:1 (effectively invisible) | 0 |
| h1 sizes across pages | 26, 30, 31, 32, 34, 36, 45, 46, 58 px; weights 700 / 780 / 800 / 900 | one scale |
| Container widths | 1392 (header/home/directory) vs 1180 (footer, department pages, login) | one |
| Internal links that resolve | all but `/terms` (SPA 404), `#privacy` / `#accessibility` (point at the footer itself), `/citizen#my-requests` (anchor missing) | all |

The single biggest root cause is the **generated `src/styles/portal-theme.css`**: it forces `background: var(--p-surface)`
(white) in light mode onto components that were designed dark (`.footer`, `.departments-hero`, `.service-form-header`,
`.staff-login .login-backdrop`) while their text keeps the light-on-dark colours from `App.css`. That one file produces
most of the P0s below; ironically these components look *correct* only in dark mode.

---

## P0 — visible as broken on default (light) pages

### P0-1 Footer is white-on-white on every public page
- **Where:** all 12 pages that render `<Footer/>`; `src/styles/portal-theme.css:24` and `:306`
  (`:root:not([data-gov-theme='dark']) .footer { background: var(--p-surface) }`) overriding `src/App.css:14493-14508`
  (`.footer{background:var(--gov-navy-deep)} .footer p,a,span{color:#cad8d5}`).
- **Evidence:** `qa-screens/audit-design-home-1440-light.png` (bottom). Measured: footer `bg rgb(255,255,255)`;
  links `rgb(202,216,213)` on white → **1.47:1** (needs 4.5); brand `strong` `#fff` on `#fff` → **1.00:1**; copyright
  `span` 9 px 1.47:1; "جمهورية العراق • محافظة ذي قار" 8 px 1.47:1. Fully-invisible brand name on 12 pages.
- **Fix:** delete the two `.footer` blocks from the generator output (or exclude `.footer` in
  `scripts/dev/gen-portal-theme.py`). Then re-skin the footer on the approved tokens instead of the navy:
  `.footer{background:var(--gov-green-900);color:#e6efe9} .footer a,.footer p,.footer span{color:#cfe0d6;font-size:14px}
  .footer strong{color:#fff} .footer-bottom{font-size:13px;color:#a9c2b4}`. Dark mode: `background:#0a1712`.

### P0-2 Departments hero text invisible (light green on white)
- **Where:** `/departments`; `src/styles/portal-theme.css:502` (`.departments-hero{background:var(--p-surface)}`) vs
  `src/styles/departments.css` hero text colours.
- **Evidence:** `audit-design-departments-1440-light.png`: intro `p rgb(207,233,218)` on white → **1.29:1**; kicker
  `span.section-kicker rgb(155,230,191)` 10 px → **1.45:1**; stat labels `small rgb(184,217,199)` → **1.52:1**.
  In dark mode (`audit-design-departments-1440-dark.png`) the hero is the intended dark-green card and reads fine.
- **Fix:** remove the override; keep the hero `background: var(--gov-green-800)` in both themes, or make it a light
  card (`background:var(--gov-green-050); color:var(--gov-ink); p{color:var(--gov-ink-2)} small{color:var(--gov-muted)}`).

### P0-3 Store-licence (`/service/store-license`) header is unreadable and its form uses 9 px labels
- **Where:** `src/styles/portal-theme.css:35` and `:318` (`.service-form-header{background:var(--p-surface)}`) vs
  `src/App.css:1977-2040`; labels `src/App.css:2131-2136` (`.form-grid label{font-size:9px}`); summary/labels
  `.form-summary` 9 px; `button.active/ملك/إيجار` 9 px.
- **Evidence:** `audit-design-svc-special-1440-light.png` (top). Description `p rgb(169,193,181)` on white →
  **1.91:1**; "خدمة رقمية" `rgb(226,196,124)` 9 px → 1.69:1; back link `a rgb(159,192,176)` 9 px → 1.97:1; department
  chip 9 px 1.47:1. Form: `label «نوع النشاط» 9px`, `label.wide «العنوان التفصيلي» 9px`, `button «إيجار» 9px/800`,
  `strong «إجازة فتح محل» 9px`, upload hint `p 10px` 4.45:1, note `p 8px`. This is the flagship "specialised" service
  and the only one still on the legacy `.button`/`.form-grid` system.
- **Fix:** remove the generated override; migrate the page to the catalog form classes (`gov-service-header`,
  `.public-service-main .dynamic-fields label{font-size:13px}` in `services.css:856`). Minimum: `.form-grid label,
  .form-summary dt, .ownership-field button{font-size:13px}`; `.service-form-header{background:var(--gov-surface);
  color:var(--gov-ink)} .service-form-header p{color:var(--gov-ink-2)}`.

### P0-4 Staff login (light): 58 px white title and intro on a near-white backdrop
- **Where:** `/staff/login`; `src/styles/portal-theme.css:506` (`.staff-login .login-backdrop{background:var(--p-surface)}`)
  vs `src/App.css:10147-10160` (`.login-intro h1{color:white}`), `StaffLoginPage.tsx:119` (`STAFF ACCESS`).
- **Evidence:** `audit-design-staff-login-1440-light.png`. `h1 «دخول موظفي المنصة» 58px #fff` on `rgb(243,245,239)`
  → **1.10:1**; `p rgb(211,230,218)` → 1.19:1; eyebrow `STAFF ACCESS rgb(243,217,152)` → 1.23:1. The primary button
  "دخول آمن" also renders in its disabled-looking pale state.
- **Fix:** drop the override (keep the green photo backdrop in light mode) or invert the intro colours in light mode:
  `:root:not([data-gov-theme='dark']) .staff-login .login-intro h1{color:var(--gov-ink)} … p{color:var(--gov-ink-2)}`.
  Replace `STAFF ACCESS` with `دخول الموظفين`.

### P0-5 Dark mode on public pages is half-themed: forms, directory and hero cards keep light-mode text on dark, or light cards with light text
- **Where:** every public page in `data-gov-theme="dark"`. Home `.gov-verify` band, `.gov-gis-popup`, `.gov-gis-status`;
  directory `.gov-directory-results-head h2`, `.gov-btn.outline`, sector list; catalog service pages
  `.dynamic-fields label`, `.gov-service-header`; store-licence `button.button.ghost`; login `h2`.
- **Evidence (1440 dark):** `h2 «التحقق من وثيقة حكومية» rgb(238,243,240)` on mint `rgb(238,247,242)` → **1.03:1**;
  `h2 «437 خدمة» rgb(16,24,40)` on `rgb(18,28,23)` → **1.02:1**; `button.gov-btn.outline «عرض المزيد» 1.05:1`;
  `label «الاسم الكامل» rgb(52,64,84)` on dark → **1.67:1** (all catalog forms); GIS popup `h3 rgb(238,243,240)` on
  white → 1.12:1; `span.gov-gis-status.on «موثقة» rgb(7,94,69)` on `rgb(27,51,40)` → 1.74:1; `.gov-nav a.active`
  `rgb(7,94,69)` on dark → 2.34:1; `.gov-link`/`.gov-kicker` `rgb(8,122,85)` → 3.26–3.40:1; `strong «الشكاوى
  والمقترحات» rgb(200,16,46)` on `rgb(22,33,28)` → 2.81:1; login `h2 rgb(22,53,77)` on dark → 1.37:1. Screenshots:
  `audit-design-home-1440-dark.png`, `audit-design-directory-1440-dark.png`, `audit-design-svc-online-1440-dark.png`.
- **Root cause:** the dark token block in `src/styles/home.css:1274-1286` is scoped to `.gov-home, .gov-header` only,
  so on `/directory`, `/service/*`, `/departments/*`, `/login` the page shell goes dark via `portal-theme.css`
  (`--p-bg`) while `--gov-ink-2`, `--gov-muted`, `--gov-line`, `--gov-surface` keep their **light** values
  (`#344054`, `#667085`, `#fff`) — hence dark-grey labels on dark backgrounds and white cards with light text.
  It also only remaps the neutrals: `--gov-green-700/800` and `--gov-red` stay at their light values and fail as text.
- **Fix:** move the block to `:root[data-gov-theme='dark']` (same place as `--p-*`), and add dark values for the brand
  tokens that are used *as text*: `--gov-green-700:#3fb489; --gov-green-800:#5cc79c; --gov-green-600:#2ea777;
  --gov-red:#ff6b7a`. Then make `.gov-band-mint`, `.gov-gis-popup`, `.gov-service-card`, `.gov-service-header`,
  `.gov-directory-hero` use `var(--gov-surface)`/`var(--gov-bg)`/`var(--gov-green-050)` instead of literal
  `#fff`/`#eef7f2`.

---

## P1 — clearly wrong at a supported viewport / blocks a task

### P1-1 Header navigation overflows at 1024 px — login / "ابدأ معاملتك" buttons are pushed off-canvas
- **Where:** `src/styles/home.css:221-260` (`.gov-nav > a{white-space:nowrap;padding:30px 14px}`) — the mobile menu only
  kicks in at `max-width: 960px` (`home.css:1207`).
- **Evidence:** at 1024 px on all 12 header pages `nav.gov-nav left=-177px`, `a.gov-btn.primary «ابدأ معاملتك»
  right=-68px` (entirely outside the viewport), `a.gov-btn.outline «تسجيل الدخول» left=-58px` (clipped);
  `audit-design-home-1024-light.png`. The 7 nav items + brand + 2 CTAs need ≈1,180 px.
- **Fix:** raise the hamburger breakpoint to `max-width: 1180px`, or at 961–1180 hide `b/small` of the brand, drop
  "دليل المستخدم" (it only scrolls to `#journey`) and reduce `.gov-nav > a{padding-inline:8px;font-size:13.5px}`.

### P1-2 Body text never uses the platform font (IBM Plex Sans Arabic is loaded but overridden by `Segoe UI`)
- **Where:** `src/index.css:4` sets `:root{font-family:'IBM Plex Sans Arabic'}`, but `src/App.css:9689` and
  `src/App.css:13744` set `body{font-family:'Segoe UI',Tahoma,Arial,sans-serif}` (two legacy "reed" / "gov" palettes).
- **Evidence:** `document.fonts` → all four `IBM Plex Sans Arabic` faces `unloaded` (never requested); computed
  `body` font `"Segoe UI", Tahoma, Arial`; 2,733 text nodes render in the OS fallback (Segoe UI on Windows, Geeza /
  Noto Naskh on phones, DejaVu on Linux) — so the Arabic body face differs per device and never matches the design.
  Buttons also inherit it (`App.css:42 button,input,select{font:inherit}` overrides `index.css:30`).
- **Fix:** delete both `body{font-family:…}` declarations; keep `:root` from `index.css`. For buttons decide once:
  `.gov-btn,.button{font-family:'Noto Kufi Arabic',…;font-weight:700}` or leave them in Plex (recommended: Plex 600 —
  Kufi at 13–14 px is heavy). Then remove the unused `@fontsource` weights you do not use (Kufi 500 is loaded, never used).

### P1-3 Footer / legal links are dead or self-referential
- **Where:** `src/components/public/Footer.tsx:20-28`.
- **Evidence:** `شروط الاستخدام → /terms` renders the SPA 404 ("الصفحة غير موجودة"); `سياسة الخصوصية → #privacy` is the
  id of the footer column itself; `إمكانية الوصول → #accessibility` (utility bar + footer) is the id of the copyright
  row; "الخدمات الحكومية" appears twice (`/#services` and `/directory`); `متابعة المعاملات → /citizen#my-requests` —
  anchor does not exist on the login gate. Government sites are expected to have real privacy/terms/accessibility pages.
- **Fix:** add `/privacy`, `/terms`, `/accessibility` routes (static pages), rename the first link "الخدمات على الرئيسية"
  or drop it, point "متابعة المعاملات" at `/citizen` only.

### P1-4 Mobile utility bar wraps to two lines inside a fixed 38 px bar and clips
- **Where:** `src/styles/home.css:113` (`.gov-utility{height:38px}`) + `CivicUtilityBar.tsx` (7 items at 390 px).
- **Evidence:** `audit-design-home-390-light.png` top: "جمهورية العراق" and "الوضع الليلي" / "إمكانية الوصول" wrap and are
  cut at the bottom edge; this is the first thing every mobile visitor sees.
- **Fix:** at `max-width:600px` show only `الوضع الليلي` (icon) + `العربية | English`, `min-height:38px;height:auto;
  white-space:nowrap`, hide "جمهورية العراق | محافظة ذي قار" (already in the brand block).

### P1-5 Text below 12 px is systemic (352 nodes at 1440 px; worst on store-licence, onboarding, login, footer)
- **Where / evidence:** footer `p/a 11px`, `span 9px`, `small 8px` (`App.css:934-948`); store-licence labels/buttons
  9 px (P0-3); onboarding `label «رقم الهاتف العراقي» 11px`, stepper `8–10px` (`span «2» 10px/900` at 2.76:1);
  login `span.login-v3-kicker 10px`, `p «استرجع حسابك…» 11px` 4.24:1; directory `span.section-kicker 10px`,
  `span.availability 9px`; home `span.gov-gis-status 11px/800` at 4.37:1; catalog stepper `b «01» 11px` 3.53:1;
  verify `span «أو» 10px` 3.49:1. Arabic at 9–11 px in a UI font loses dots and marks (ـيـ/ـبـ/ـنـ become identical).
- **Fix:** define `--fs-xs:12px` as the floor for chips/kickers and `13px` for any sentence; add
  `.gov-home small,.gov-home .section-kicker{font-size:12px}`; kickers can keep weight/tracking for hierarchy.

### P1-6 Directory empty state is unreachable and the suggestion panel opens on load
- **Where:** `GovernmentDirectoryPage.tsx:262-270` (`.gov-directory-empty`), `SmartSearch.tsx`, API
  `/api/services/search`.
- **Evidence:** `/directory?q=zzzzqqqq` → head says **"15 خدمة … نتائج البحث عن «zzzzqqqq»"** and lists pension /
  court / tax information services (`/api/services/search?q=zzzzqqqq` returns 40 fuzzy items), so the designed empty
  state (`h3 «لا توجد خدمة مطابقة»`) never shows; meanwhile the SmartSearch dropdown is rendered open over the grid
  without focus (`audit-design-directory-empty-1440-light.png`). The second catalog block at the bottom does show
  its own unstyled empty state (`h3 18.72px` browser default) → two different empty states on one page.
- **Fix:** require a minimum match score in `searchServices` (or fall back to the 0-result state when the top score is
  below threshold); only open the suggestions panel on focus/typing; style `.national-catalog .empty` the same as
  `.gov-directory-empty`.

### P1-7 Arabic headings set with negative letter-spacing and line-height ≤ 1.05
- **Where:** `src/App.css:13151-13156` (`.login-v3-intro h1{line-height:1.02;letter-spacing:-0.07em}`),
  `App.css:14982-14987` (`font-weight:780;letter-spacing:-0.02em`), `App.css:10147` (`.login-intro h1 -0.05em`),
  `App.css:10862` (`.onboarding-aside h1 -0.048em`), 27 rules in total with `letter-spacing ≤ -0.03em`.
- **Evidence:** login h1 measured `46px / line-height 1.02 / weight 780`; the hamza of "إنشاء" collides with the line
  above (`qa-screens/audit-design-login-1440-light.png`). Negative tracking on a cursive script overlaps joined glyphs
  and Chrome's synthetic `780` weight is not a loaded face (Kufi is loaded at 500/700/800 → `900` on the home h2 is
  faux-bold too).
- **Fix:** `letter-spacing:0` for every Arabic heading; `h1,h2{line-height:1.3}`; use only 700/800.

### P1-8 Two competing component systems on the same public pages
- **Where:** `.gov-btn` (`home.css:47`, 40 px, 14 px/700, radius 8) vs `.button` (`App.css`, 44–48 px, **12 px/800**,
  radius 4/7) — both appear on `/directory` (national catalog block), `/service/store-license`, `/staff/login`,
  `/onboarding`, `/departments/*` ("فتح في الخريطة"), 404. Cards: `.gov-service-card` (r12, `--gov-line`) vs
  `.department-card` (r16) vs `.national-catalog` cards (r4 buttons). Brand lockup: header `.gov-brand` (one logo +
  Arabic/Latin) vs footer/login/404 `.brand` (two emblems, 8 px caption).
- **Evidence:** 81 distinct button styles; `a.button.outline «عرض التفاصيل» 12px/800 h46 r4` next to
  `a.gov-btn.primary «ابدأ الطلب» 13px/700 h33 r8` on the same page.
- **Fix:** see consolidation plan — alias `.button` → `.gov-btn` and delete the `.button` rules from `App.css`.

---

## P2 — inconsistent / off-system

### P2-1 Colour sprawl: 71 text colours, 43 border colours, three "muted" greys, three "brand" greens
- **Evidence (1440 light, counts of text nodes):** greens used for text: `#075e45` (283), `#0b6b3a` (205 —
  `departments.css:128`, `staff.css:54`, not a token), `#087a55` (130), `#064a36`, `#0a5338`, `#0a8f63`, `#244437`,
  `#3a5b4f`; greys: `#667085` (533), `#344054` (336), `#3d5247` (233), `#68776f` (107), `#58665f`, `#52695d`,
  `#6b7f73`, `#7b8f82`, `#506959`, `#7a8a82`, `#69777e`… Borders: `#e3e8e5` (341) but also `#d7e4dc`, `#d6e4dd`,
  `#dbe5df`, `#bac7c0`, `#e2eae5`, `#d5e2f3`, `#cfe4d6`, `#d4dfd9`, `#d7e7dd`, `#d2ddd8` … (43).
- **Fix:** grep-replace every green not in `--gov-green-*` and every grey not in `--gov-ink/-2/--gov-muted`; borders →
  `--gov-line` / `--gov-line-soft` only. `unify.css` maps legacy *tokens* but the 1,534 literals bypass it.

### P2-2 Radii and icon sizes have no scale
- **Evidence:** 18 radii rendered (`4,5,6,7,8,10,12,13,14,16,18,20,22,24px`); pills at `999px` and `50%`; icons at
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26 px (278× 14 px, 133× 24 px, 132× 12 px).
- **Fix:** tokens `--gov-radius-xs:4px` (chips), `--gov-radius-sm:8px` (buttons, inputs), `--gov-radius:12px`
  (cards), `--gov-radius-pill:999px`; icons `size={14|18|24}` only (lucide `size` prop audit).

### P2-3 Typography scale: 9 different h1 sizes, 35 body sizes, `line-height: normal` on 76 % of text
- **Evidence:** h1 26→58 px (see summary); body sizes include 11.5, 12.48, 12.5, 13.3333, 13.5, 14.08, 14.1667, 15.5,
  18.72 px (unstyled/`em` leaks). 2,471 nodes have `line-height: normal` (≈1.2 for Plex/Segoe) — Arabic paragraphs need
  1.6–1.8 for tashkīl and descenders (home hero `p` is fine at 1.8; directory cards `p` are `normal`).
- **Fix:** `--fs-h1:40px; --fs-h2:28px; --fs-h3:20px; --fs-body:15px; --fs-sm:13px; --fs-xs:12px`, `body{line-height:1.7}`,
  `h1,h2,h3{line-height:1.3}`; remove per-page `h1{font-size:…}`.

### P2-4 Utility bar "English" is an inert span that looks like a link
- **Where:** `CivicUtilityBar.tsx:46` (`<span class="gov-utility-lang is-muted" title="النسخة الإنجليزية قيد الإعداد">`).
- **Evidence:** rendered grey next to the active "العربية"; no cursor, no tooltip on touch, no `aria-disabled`.
- **Fix:** either remove it until EN ships, or render `English <small>قريباً</small>` with `aria-disabled="true"`.

### P2-5 Container width and vertical rhythm differ per page
- **Evidence:** header/home/directory content width 1392 px (`--gov-container:1480`), footer 1180 px (`.container`),
  department pages 1180 px, login 1180 px → the footer is visibly narrower than the header on every page
  (`audit-design-home-1440-light.png`). Section padding: home bands 56/56, trust strip 22/22, services section 28/0,
  footer padding-top 56 on home vs 70 elsewhere.
- **Fix:** `.footer .container,.department-page .container{width:min(var(--gov-container),calc(100% - 48px))}`; one
  `--section-y:56px` (40 px ≤ 1100, 32 px ≤ 600).

### P2-6 Homepage category names do not match the directory sectors they open
- **Where:** `LandingPage.tsx:85-93` vs `/api/services/summary` categories.
- **Evidence:** "الوثائق الشخصية" → `?category=الوثائق الحكومية`; "الأعمال والتجارة" → "المحلات والأعمال";
  "السكن والعقار" → "السكن والأراضي"; "البلديات" → "البناء والبلديات"; "المرور والنقل" → "الأمن والمرور";
  "الماء والكهرباء" → `?q=ماء` (a search, and it drops electricity); "التعليم" → `?q=تعليم` while the directory has
  two sectors (التربية والتعليم / التعليم العالي). The citizen lands on a page whose heading names a different sector.
- **Fix:** use the sector labels verbatim on the home tiles, or map tile → `category` with the same label.

### P2-7 Homepage GIS explorer opens with a popup covering the map and grey tiles with no fallback
- **Evidence:** on load, the "مديرية بلديات ذي قار" popup is open (`.gov-gis-popup` at 1440 and 390) hiding the map; the
  map is a flat `#ddd` rectangle when tiles cannot load (blocked host here; the same happens on locked-down networks)
  — no "تعذّر تحميل الخريطة" state; in dark mode the map stays light grey (`audit-design-home-1440-dark.png`).
- **Fix:** do not preselect; render a `tileerror` fallback (message + list stays usable); `filter:brightness(.8)
  invert(1) hue-rotate(180deg)` or a dark tile style in dark mode; Leaflet controls use `Lucida Console` (`+`/`−`) —
  restyle `.leaflet-control-zoom a{font-family:inherit}`.

### P2-8 Catalog form: required asterisk drops to its own line
- **Where:** `DynamicServiceFormPage.tsx:427` (`<b aria-hidden> *</b>`) inside `.form-grid label{display:grid}`
  (`App.css:2131`).
- **Evidence:** `audit-design-svc-online-1440-light.png`: every label shows "الاسم الكامل (الرباعي واللقب)" then a lone
  red `*` on the next row; `*` is `aria-hidden` and no `(مطلوب)` text exists for screen readers.
- **Fix:** `.dynamic-fields label{display:flex;gap:4px;align-items:baseline}`; add `<span class="sr-only">(مطلوب)</span>`.

### P2-9 Department page: placeholder dash jumps to the far left
- **Where:** `DepartmentPublicPage.tsx:132` (`<dd dir="ltr">{item.phone || '—'}</dd>`).
- **Evidence:** `audit-design-dept-muni-1440-light.png`: "الهاتف" label on the right, "—" 400 px away on the left.
- **Fix:** `dir="ltr"` only when a phone exists, and `.department-contact dd{text-align:start}` with `<bdi>`.

### P2-10 Trust and source signals are exposed as raw notes / third-party names
- **Evidence:** department page prints "الإحداثيات من OSM (mapcarta W467592669). تغطية إخبارية: https://ar.nasiriyah.org/…"
  and links "مصدر البيانات → mapcarta.com" (a commercial aggregator) on an official page; store-licence sidebar tells
  citizens "تبقى عملية الدفع معلقة إلى حين تهيئة بوابة دفع معتمدة" (an internal status); footer bottom says
  "واجهة عربية • دعم RTL • أرقام إنجليزية • متوافق مع الهاتف" (a dev checklist). News source label "Iraqi News" in Latin.
- **Fix:** hide `notes` from public rendering (keep in admin), show the official site or nothing as the source, drop
  the dev strap-line, transliterate sources ("عراق نيوز").

### P2-11 404 page has no header, footer or way to search
- **Where:** `src/pages/NotFound.tsx`. Uses the legacy `.button.primary` and the alternate brand lockup.
- **Fix:** wrap in `PublicHeader`/`Footer`, add a search box and links to `/directory` and `/departments`.

### P2-12 Search bar shows two magnifier icons
- **Where:** `SmartSearch.tsx` — decorative `.gov-search-icon` on the right *and* a green submit button with the same
  icon on the left (home and directory).
- **Fix:** keep one: make the right-hand icon the submit control (RTL: action at the start is fine) or drop it.

### P2-13 Verification band: disabled primary button reads as broken; placeholder inconsistent
- **Evidence:** home `button.gov-btn.primary «تحقق الآن»` renders at opacity .5 until a number is typed (pale green,
  2.3:1); home placeholder `TQD-XXXXXXXXXXXXXXXX` vs `/verify` placeholder `TQD-...`.
- **Fix:** keep the button enabled and validate on submit; use one placeholder `TQD-2026-00001`.

### P2-14 Tap targets under 24 px on mobile
- **Evidence (390 px):** department links inside directory cards 15 px tall (`a «دائرة صحة ذي قار» 97×15`), footer links
  22 px, `.gov-link «المصدر» 63×16`, Leaflet attribution links 9 px.
- **Fix:** `min-height:44px` or `padding-block:6px` on inline links in cards/footer.

---

## P3 — polish

- **P3-1** Romanisation differs: header "THI QAR DIGITAL" vs department page "Dhi Qar Municipalities Directorate" and
  the repo name "dhiqar" — pick "Dhi Qar" (ISO/GoI usage).
- **P3-2** `public/news/new-city.png` is a JPEG with a `.png` extension (600×750 portrait cropped into a 120×80 3:2 box —
  heavy crop); news thumbnails are `loading="lazy"` with no `width/height` → layout shift on scroll.
- **P3-3** Home category grid: 9 tiles → orphan tile at 5-col (≤1200) and 2-col (390) layouts; make it 8 or 10.
- **P3-4** Onboarding stepper numbers use `Inter` (not loaded → fallback) at 8–10 px; nav item "دليل المستخدم" just
  scrolls to `#journey` (there is no user guide).
- **P3-5** Departments page bleeds 6 px outside the viewport on each side at 390 (`section.departments-hero l=-6 r=376`).
- **P3-6** Hover state on `.gov-services-two a` rows and `.gov-news-side a` is only a colour change on `strong`; add
  a background (`--gov-green-050`) for row affordance.
- **P3-7** `::selection{background:#08783f}` and the focus ring `rgba(20,168,91,.28)` use greens outside the token set.

---

## Design-system consolidation plan

1. **One token file.** Move `--gov-*` from `home.css:6-31` into `src/styles/tokens.css`, imported first. Add the missing
   semantic tokens: `--gov-text-on-brand`, `--gov-link`, `--gov-danger`, `--gov-focus`, `--fs-*`, `--lh-body:1.7`,
   `--lh-heading:1.3`, `--space-1..8` (4 px grid), `--radius-xs/sm/md/pill`, `--icon-sm/md/lg`. Dark values for
   *every* token, including the greens used as text (P0-5).
2. **Kill the legacy palettes.** `--brand-*`, `--reed*`, `--limestone*`, `--gov-navy*`, `--sand/--brass` in `App.css`
   are aliased by `unify.css` but 1,534 literal hexes bypass them. Codemod: replace every `#hex` in `App.css` with the
   nearest token (script: cluster by ΔE < 6 → token), fail CI on new literals (`stylelint color-no-hex`).
3. **Fonts.** Remove `body{font-family:'Segoe UI'…}` (`App.css:9689`, `:13744`). Only two families:
   Plex (body, forms, buttons) and Kufi 700/800 (h1–h3, display numbers). Drop Kufi 500 and `Inter`.
4. **Components → one class each.** `.button{…}` → `@extend`-style alias to `.gov-btn` (`primary|outline|ghost|small`),
   then delete `.button` rules; `.department-card`, `.national-catalog` cards → `.gov-card`; `.section-kicker`,
   `.gov-eyebrow`, `.gov-kicker` → `.gov-kicker`; `.status-pill`, `.gov-chip`, `.availability`, `.gov-gis-status`,
   `.gov-service-status` → `.gov-chip` with `data-tone`; `.brand` → `.gov-brand`; `.container` → `.gov-container`.
5. **Retire the generated `portal-theme.css` for public pages.** Scope the generator to `.portal-shell,.ops-shell` only;
   public components must carry their own dark values via tokens. This alone fixes P0-1…P0-4.
6. **Type & spacing scale** (P2-3, P2-5) applied via `home.css` base rules; remove per-page `h1{font-size}` overrides
   (`.login-v3-intro h1`, `.onboarding-aside h1`, `.departments-hero h1`, `.service-form-header h1`).
7. **Lint gates:** stylelint (`declaration-property-value-allowed-list` for `font-family`, `border-radius`,
   `letter-spacing: 0` under `[dir=rtl]`), a Playwright contrast check (reuse `scripts/dev/audit-design.mjs`) failing
   on any ratio < 4.5 in both themes, and a font-size floor of 12 px.

---

## Arabic copy corrections (before → after)

Terminology decisions first (apply everywhere):
- **مستمسك** = an identity/supporting document the citizen supplies (Iraqi administrative term, already dominant:
  "المستمسكات المطلوبة"); **وثيقة** = a document the platform/department issues (شهادة، إجازة، وثيقة إتمام).
  Retire **مستند** (used on onboarding + store-licence: "المستندات", "صوّر المستند", "من مستند موثق").
- **دائرة** for a government office (مديرية/دائرة/هيئة are proper names and stay); **جهة** only when speaking
  generically about "the responsible body". Navigation must be one term: "الدوائر الحكومية" everywhere
  (today: "الجهات الحكومية" nav, "دليل الدوائر" footer, "دليل الجهات الحكومية الكامل" home, "كل دوائر ومديريات" h1).
- **إجازة** (Iraqi) not **رخصة**: only one leak (directory placeholder).
- Numbers: keep Western digits (stated policy) but apply Arabic counting rules (3–10 plural, 11+ singular).

| # | Where | Before | After |
| --- | --- | --- | --- |
| 1 | `LandingPage.tsx:183-187`, `:210` | ذي قار.. / أرض الإنسان.. / تصنع المستقبل · تراث عريق.. | ذي قار… أرض الإنسان، تصنع المستقبل · هويتنا: تراث عريق ومستقبل رقمي (use "…" or none, never "..") |
| 2 | `service-forms.ts:213`, `government-directory.ts:431` | حجز موعد أونلاين | حجز موعد إلكتروني |
| 3 | `GovernmentDirectoryPage.tsx:175` | مثال: إجازة بناء، جواز، تقاعد، رخصة سياقة، عقد إيجار… أو اضغط المايك وتكلّم | مثال: إجازة بناء، جواز سفر، تقاعد، إجازة سياقة، عقد إيجار… أو اضغط الميكروفون وتكلّم |
| 4 | `LandingPage.tsx:311`, GIS list | الناصرية • 8 خدمة / 7 خدمة / 5 خدمة | الناصرية • 8 خدمات (3–10 → خدمات; 11+ → خدمة; 1 → خدمة واحدة; 2 → خدمتان) |
| 5 | `DepartmentPublicPage.tsx:96` | 6 مستمسك مطلوب / 3 مستمسك مطلوب / 2 مستمسك مطلوب / 1 مستمسك مطلوب | 6 مستمسكات مطلوبة / 3 مستمسكات مطلوبة / مستمسكان مطلوبان / مستمسك واحد مطلوب |
| 6 | directory cards (`estimatedDuration` data) | 30 يوم · 3-5 يوم عمل | 30 يوماً · 3–5 أيام عمل |
| 7 | directory cards | 3 مطلوبة | 3 مستمسكات |
| 8 | `DepartmentPublicPage.tsx:65` | تابعة لـ وزارة الإعمار… | تابعة لوزارة الإعمار… (no space after لـ) |
| 9 | `StaffLoginPage.tsx:119` | STAFF ACCESS | دخول الموظفين |
| 10 | `PublicHeader.tsx:13` | دليل المستخدم (scrolls to journey) | كيف تعمل المنصة؟ (or remove) |
| 11 | `PublicHeader.tsx`, `Footer.tsx`, `LandingPage.tsx` | الجهات الحكومية / دليل الدوائر / دليل الجهات الحكومية الكامل | الدوائر الحكومية / دليل الدوائر / دليل الدوائر الكامل |
| 12 | `DepartmentsDirectoryPage.tsx` h1 | كل دوائر ومديريات محافظة ذي قار في مكان واحد | دوائر محافظة ذي قار ومديرياتها في مكان واحد |
| 13 | `Footer.tsx:33` | واجهة عربية • دعم RTL • أرقام إنجليزية • متوافق مع الهاتف | (remove) or: منصة رسمية لمحافظة ذي قار — الإصدار 1.0 |
| 14 | `Footer.tsx:17-19` | الخدمات الحكومية (twice) | الخدمات على الرئيسية / دليل الخدمات |
| 15 | `NotFound.tsx:10` | المسار الذي فتحته غير متاح أو تم نقله إلى مسار آخر. | الصفحة التي طلبتها غير متاحة أو نُقلت إلى عنوان آخر. |
| 16 | `NotFound.tsx`, `SpecializedServiceFormPage`, `LoginPage`, `VerifyScanner` | العودة للرئيسية / الرجوع للرئيسية / الرئيسية | العودة إلى الرئيسية (one form) |
| 17 | `OnboardingPage.tsx:314` | يبدأ حسابك من مستند موثق. | يبدأ حسابك بمستمسك رسمي موثق |
| 18 | `OnboardingPage.tsx:344` | سنرسل رمزاً حقيقياً لمرة واحدة عبر WhatsApp أو Telegram أو SMS مع تحويل تلقائي حسب التوفر. | سنرسل رمز تحقق لمرة واحدة عبر واتساب أو تيليغرام أو رسالة نصية، بحسب المتاح. |
| 19 | `OnboardingPage.tsx:320-324` | تُحفظ المرفقات بتشفير وعلى نطاق مراجعة محدد بعد موافقتك، ولا يصدر قرار هوية تلقائي من التحليل أو الفيديو وحدهما. | تُحفظ مرفقاتك مشفّرة ولا يطّلع عليها إلا الموظف المخوّل بعد موافقتك، ولا يُتخذ قرار بشأن هويتك تلقائياً؛ المراجعة بشرية دائماً. |
| 20 | Onboarding stepper / header | المستند · إنشاء الهوية الرقمية vs إنشاء حساب المواطن | المستمسك · إنشاء حساب المواطن (one name for the flow) |
| 21 | `LoginPage.tsx` intro | يمكن للمواطن استرجاع حسابه المحفوظ برقم الهاتف أو إكمال التسجيل لأول مرة؛ وبوابات العمل الحكومية لها صلاحيات مستقلة. | ادخل بحسابك برقم الهاتف أو أنشئ حساباً جديداً. للموظفين والإدارة بوابات دخول مستقلة. |
| 22 | `LoginPage.tsx` option kicker | وصول مقيّد | للموظفين فقط |
| 23 | `SpecializedServiceFormPage.tsx:120` | أدخل المعلومات التشغيلية للخدمة. | أدخل بيانات المحل والنشاط. |
| 24 | `service-forms.ts:48` | تقديم طلب إجازة لمحل تجاري جديد مع المرفقات والموقع ومسار مراجعة الموظف. | تقديم طلب إجازة لمحل تجاري جديد مع المستمسكات وتحديد الموقع، ثم تدقيقه في الدائرة. |
| 25 | `SpecializedServiceFormPage.tsx:262-265` | تُحفظ مرفقات الطلب مشفرة وتُوجّه للدائرة المختصة. تبقى عملية الدفع معلقة إلى حين تهيئة بوابة دفع معتمدة. | تُحفظ مرفقات الطلب مشفّرة وتُحال إلى الدائرة المختصة. تُدفع الرسوم إلكترونياً بعد الموافقة. |
| 26 | store-licence section "المستندات" / hint | المستندات · صوّر المستند كاملاً من الكاميرا أو ارفع صورة / PDF واضحاً. | المستمسكات · صوّر المستمسك كاملاً بالكاميرا أو ارفع صورة أو ملف PDF واضحاً. |
| 27 | `service-forms.ts:184` | خدمة البطاقة الوطنية في أور | خدمة البطاقة الوطنية على بوابة «أور» الحكومية |
| 28 | `VerifyScanner.tsx:82` | يفتح المسح سجل التحقق العام ويعرض الحد الأدنى من بيانات الوثيقة. لا ترفع صورة QR إلى خادم المنصة. | يُقرأ الرمز على جهازك ثم يُعرض سجل التحقق العام بالحد الأدنى من بيانات الوثيقة؛ لا تُرسل صورة الرمز إلى الخادم. |
| 29 | catalog forms (registry) | الاسم الكامل (الرباعي واللقب) vs الاسم الكامل (رباعي واللقب) | الاسم الرباعي واللقب |
| 30 | `svc-online` notice | بيانات هذه الخدمة مأخوذة من مصادر عامة ولم تؤكدها الدائرة بعد. قد تطلب الدائرة مستمسكاً إضافياً أو تعدّل الشروط عند التدقيق. | (fine — keep; but chip "بانتظار تأكيد الدائرة" should appear on the page header as on the directory card) |
| 31 | `DepartmentPublicPage` notes | الإحداثيات من OSM (mapcarta W467592669). تغطية إخبارية: https://… | (do not render on public page) |
| 32 | `news.ts:13` | الحكومة المحلية • Iraqi News | الحكومة المحلية • عراق نيوز |
| 33 | trust strip `LandingPage.tsx:503` | سجل إلكتروني | سجل رقمي لكل معاملة |
| 34 | home e-services rows | إجازة السياقة — وزارة الداخلية — مديرية المرور العامة (em-dash chains) | وزارة الداخلية / مديرية المرور العامة (use "/" or "–" consistently; today "—", "–" and "/" all appear) |
| 35 | directory hero | 437 خدمة من 80 جهة حكومية — 198 خدمة تُقدَّم إلكترونياً بالكامل و204 خدمة تُقدَّم إلكترونياً ثم تُستكمل بالحضور. | 437 خدمة من 80 دائرة حكومية: 198 منها تُنجز إلكترونياً بالكامل، و204 تبدأ إلكترونياً وتُستكمل بالحضور. |

---

## Evidence index

- `qa-screens/audit-design-home-{1440,1024,390}-{light,dark}.png` — hero, categories, GIS, journey, verify band,
  e-services, trust strip, news, footer (P0-1, P0-5, P1-1, P1-4, P2-6, P2-7, P2-12, P2-13).
- `qa-screens/audit-design-directory{,-q,-empty}-1440-{light,dark}.png` — filters, results, unreachable empty state (P1-6).
- `qa-screens/audit-design-svc-{online,appt,info,info2,fee,special}-1440-{light,dark}.png` — all channel types (P0-3,
  P0-5, P2-8).
- `qa-screens/audit-design-departments-1440-light.png`, `-dark.png`, `audit-design-dept-muni-*.png` (P0-2, P2-9, P2-10).
- `qa-screens/audit-design-{login,staff-login,onboarding,verify,404}-1440-{light,dark}.png` (P0-4, P1-7, P2-11).
- `qa-screens/audit-design-home-news-1440-light.png` — lazy-loaded thumbnails after scroll (P3-2).
- `qa-screens/audit/design/report.json` — every measurement quoted above.
