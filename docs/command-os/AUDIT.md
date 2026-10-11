# Learnyx Command OS — Phase 1 Architecture Audit

Date: 2026-10-11 · Branch: `feat/command-os` · Baseline: `main @ 2dae273`

Scope: every admin route, screen, operation, permission, data source, and shared component,
inventoried before any edits. All paths relative to `src/`.

---

## 1. Route & screen inventory

Single admin route: `/admin` (`pages/Admin.tsx`, 2,554 lines, route-level lazy).
20 sections switched via `?tab=` (not sub-routes). 15 are extracted components in
`components/admin/`, 5 are inline in Admin.tsx (dashboard, users, keys, finance,
reports, terminal, broadcast, system).

| # | Tab id | Component | Lines | Data source (convex) |
|---|--------|-----------|-------|----------------------|
| 01 | dashboard | inline `Admin()` | ~175 | `adminCenter.getAdminDashboard` |
| 02 | content | `AdminContentSection` (+ `BulkUploadSection`, `CategoriesManagement`, `BrandingPanel`, `PdfSplitterPanel`, `AdminTopicsSection`) | 1,888+2,165+785+364+163+338 | `content.getAdminContent`, `contentAdmin.*`, `categories.*`, `subjects.*` |
| 03 | coverage | `AdminCoverageSection` | 424 | `coverage.getAdminGapDashboard` |
| 04 | users | inline | ~75 | `adminCenter.listUsers`, `setUserPremium` |
| 05 | admins | `AdminAdminsSection` | 619 | `adminManagement.*` (actions) |
| 06 | keys | inline `KeysTabContent` | ~390 | `configKeys.getKeyStatusesByCategory`, `listCustomKeys`, `setKey`, `deleteKey` |
| 07 | finance | inline | ~245 | `adminCenter.getFinanceOverview` |
| 08 | payments | `PaymentReviewsSection` | 886 | `manualPayments.*`, `schools.admin*SeatSubmission*` |
| 09 | schools | `AdminSchoolsSection` | 1,231 | `schools.admin*` |
| 10 | affiliates | `AdminAffiliatesSection` | 1,941 | `affiliates.*` |
| 11 | fraud | `AdminFraudSection` | 473 | `fraudDetection.getFraudPatternReport` |
| 12 | marketing | `AdminMarketingSection` | 1,026 | `marketing.getAdmin*`, discounts, announcements |
| 13 | testimonials | `AdminTestimonialsSection` | 761 | `testimonials.*` |
| 14 | subscriptions | `AdminSubscriptionsSection` | 903 | `subscriptions.getSubscriptionOverview`, bulk tools |
| 15 | reports | inline | ~45 | `safety.listReports`, `updateReportStatus` |
| 16 | terminal | inline | ~120 | `systemEvents.getSystemEvents`, `getSystemHealthSummary` |
| 17 | broadcast | inline | ~90 | `telegram.*`, `telegramActions.sendBroadcast` |
| 18 | system | inline | ~120 | `adminCenter.getSystemStatus`, `getIntegrationStatus`, `github.verifyGithubConnection` |
| 19 | audit | `AdminAuditLogSection` | 264 | `adminManagement.listAuditLog` |
| 20 | examengine | `ExamEngineAdmin` | 1,102 | `examQuality.*` |

All 20 destinations are preserved 1:1 by Command OS. No URL is removed; `/admin?tab=…`
remains the addressing scheme; the `admin:navigate-tab` CustomEvent protocol (used by
Schools → Keys deep-link) is kept.

## 2. Permission model (server-side authority)

- Roles: `super_admin(100) > admin(80) > moderator(60)`; helpers `requireAdminMutation`
  (moderator+) and `requireSuperAdminMutation` in `convex/admin.ts`; several modules
  re-implement local `requireAdmin` floors at 80+ (`adminCenter`, `manualPayments`,
  `marketing`, `affiliates`, `subscriptions`).
- Frontend gating: `useAppBootstrap().adminInfo` (shared subscription) + per-tab hiding
  for moderators (keys/admins/audit/finance/affiliates). Backend floors are the real
  boundary and are untouched by Command OS.
- Known floor mismatch (documented, not changed here): `adminManagement`, `audit`,
  `testimonials`, `schools`, `examQuality` accept moderator(60)+ while the UI hides them
  from moderators. UI hiding is preserved exactly.

## 3. Findings

### Duplicated components (consolidation candidates)
- **Five competing stat cards**: `StatCard2` (shared), plus local `StatCard` clones in
  AdminSubscriptionsSection (L883) and AdminMarketingSection (L237), `SchoolStat`
  (Schools), `MiniStat` (ExamEngine, Terminal), `Kpi` (Affiliates), `GapStat` (Coverage).
- **Hand-rolled tab bars** in ≥5 sections while `ui/tabs` exists.
- **Mixed confirmation idioms**: `AlertDialog` (AdminAdmins, AdminContent) vs native
  `confirm()`/`window.confirm()` (Subscriptions ×3, Affiliates ×2, Testimonials,
  Marketing ×2, Categories ×3).
- **Hand-rolled modal** (`fixed inset-0 z-50`) in AdminSubscriptionsSection instead of `ui/Dialog`.
- **Raw `<select>`/`<input>`** in AdminCoverageSection filters vs `ui/Select` elsewhere.
- **Raw `<table>`** in PdfSplitterPanel vs `ui/Table` elsewhere.

### Oversized / slow routes
- Admin.tsx is a single 2,554-line chunk importing every section statically → the
  /admin route bundle carries all 15.8k lines of sections at once.
- `BulkUploadSection` (2,165) and `AdminAffiliatesSection` (1,941) are the heaviest.
- Static import graph: Admin.tsx → all 19 sections → recharts, qrcode, etc.

### Redundant Convex subscriptions
- `subscriptions.getSubscriptionOverview` subscribed **3×** (Overview/Bulk/Users panels).
- `schools.adminListSeatSubmissions` subscribed **2× in Schools** + 2× in PaymentReviews.
- `affiliates.listAffiliatePromoters` subscribed **3×** (Promoters/Ledger/Payouts tabs).
- `examQuality.adminExamOverview` subscribed **2×** (shell + Queue).
- Admin.tsx subscribes **all** top-level queries (finance, users, system, integrations,
  events, broadcast, reports) unconditionally as soon as an admin opens any tab —
  regardless of the active tab. (Convex dedupes identical subscriptions, but cost is
  still paid for data the current screen never shows.)

### Layout / mobile issues
- `BulkUploadSection` review table is `min-w-[1200px]` (legit for a data grid, but its
  **sticky save bar (`bottom-4 z-10`) collides with the always-on music player
  (`fixed bottom-4 z-40`)** — the player draws on top of "Save All".
- Music player renders **unconditionally** inside DashboardShell (even idle) on /admin;
  admin surface compensates with `pb-32`, BulkUpload does not.
- `AdminFraudSection` quick-stats `grid-cols-3` with no `sm:` collapse — breaks at 320-390px.
- Wide tables are consistently wrapped in `overflow-x-auto` (correct), but several could
  offer responsive record views.

### Unclear / dead / misleading
- `adminCenter.getAdminStats`, `listAllPayments`, `clearAuthRateLimits`,
  `adminTopics.countTopicsBySubject` have **zero frontend callers** (backend dead surface,
  left untouched — backend hygiene is out of scope for a UI redesign).
- `BrandingPanel` L359-364: `void Eye; void X; …` — dead imports silenced with void statements.
- `PaymentReviewsSection` header comment claims a "10-second poller"; the code is fully
  reactive (stale comment).
- AdminAdminsSection is fetch-on-mount + manual Refresh (not reactive like every other
  section) — behavior preserved, noted.
- Sidebar "Admin network … v2.7 / 78%" status block is **decorative, not real data** —
  removed under the "no invented metrics" rule and replaced with the real role badge.

### Header consistency
Four competing header idioms (hero band, glass-panel card, plain text block, none) with
drifting heading levels (h1/h2/h3). Command OS standardizes on one `SectionHeader`
(eyebrow · title · description · actions) for new/rebuilt surfaces.

### i18n
Admin is hardcoded English everywhere (existing convention, preserved).

## 4. Navigation & route migration map

Old 4 groups (OVERVIEW / CONTENT / MANAGEMENT / TOOLS) map into the 6 Command OS groups
**without breaking any URL** — every tab id is unchanged:

| Command OS group | Tabs (ids unchanged) |
|---|---|
| Overview | `dashboard` |
| People | `users`, `admins`, `schools`, `subscriptions` |
| Academics | `content`, `coverage`, `examengine` |
| Revenue | `finance`, `payments`, `affiliates` |
| Trust & Security | `fraud`, `reports`, `audit` |
| Growth & Systems | `marketing`, `testimonials`, `broadcast`, `terminal`, `keys`, `system` |

Moderator-restricted tabs keep their exact visibility rules inside the new groups.

## 5. Phase plan executed on this branch

1. **Shell first**: design tokens (`cmdos-*`), `AdminShell` (grouped nav, icon-rail
   collapse, mobile drawer, breadcrumbs, ⌘K palette with recents/pins, real-data
   notification center, per-tab scroll restoration), shared `kit` primitives.
2. **Command Center** (dashboard tab) rebuilt as the reference implementation.
3. **Verified** (tsc + build + lint) before touching other workspaces.
4. **Incremental workspace upgrades**: People (users rebuilt with shared kit), Revenue
   (finance container pass), Trust (fraud mobile fix), consistency fixes, dead-code
   removal, music-player de-obstruction, lazy section chunks.
5. Remaining workspaces (content/schools/affiliates/marketing internal layouts) keep
   their proven layouts — internal restyling is deferred by design (no risky rewrite).
