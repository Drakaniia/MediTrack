# MediTract Web — Specification

Status: draft v1 (from the interview; no code written yet)
Source brief: `all.md` ("Web-Based Automated Medical Supply Expiration Tracking and Usage Prioritization System")

## 1. Summary

Build a new, web-only version of the MediTrack/CMIS concept as `apps/web` in this monorepo. It is a multi-user, role-based system that registers medical supplies by batch, tracks expiry, classifies each batch (Safe / Near Expiry / Urgent / Expired), prioritizes dispensing by FEFO (First-Expiry, First-Out), and raises alerts. There is no Tauri, no Rust and no local SQLite. It is deployed to **Cloudflare Pages** (with **Pages Functions** as the API and **D1** as the database) using **pnpm + wrangler**.

The existing `apps/desktop` Tauri app stays untouched. Code that is useful is **copied** into `apps/web`, not shared via a new package.

## 2. Decisions captured in the interview

| Topic | Decision |
|---|---|
| Repo layout | New `apps/web` in this monorepo; `apps/desktop` untouched |
| Code reuse | Copy needed code into `apps/web` (no shared package extraction now) |
| Hosting | Cloudflare Pages (static SPA) + Pages Functions (API) + D1 |
| Deploy tooling | `pnpm wrangler pages deploy`, manual plus GitHub Actions CI deploy on `main` |
| Auth | Own username/email + password in D1, cookie sessions, admin-created accounts |
| First admin | Seeded by a CLI script using wrangler secrets; no public signup |
| Tenancy | Single facility per deployment |
| Offline | Online-only; show an offline banner |
| Scanning | USB/Bluetooth handheld (keyboard-wedge) scanners only; no camera scanning |
| QR content | Short opaque batch ID |
| Alerts | In-app notification center + dashboard banner, daily email digest, browser push |
| Email | Cloudflare Email Service, free tier only (verified destination addresses); degrade gracefully, drop if unavailable |
| Scheduled jobs | Separate small cron Worker sharing the same D1 |
| Data | Fresh start; keep the demo seed data (no migration from Tauri SQLite or the old D1) |
| Expiry thresholds | Configurable, defaults 7 days (Urgent) and 30 days (Near Expiry) |
| Expired stock | Excluded from FEFO and quarantined; disposal/write-off flow with reason |
| Stack | Same as desktop: React 19, TanStack Router and Query, Tailwind 4, Base UI/shadcn, Visx, Vite |
| Carried-over features | Request queue, Dispensing + Quick Deduct, Analytics dashboard, Audit log + Trash/restore, Reports export (PDF/XLSX), Ctrl+K palette, docs/help, density/theme |
| Spec file name | `meditract-web-spec.md` |

## 3. Goals and non-goals

### Goals
- Replace manual expiry checking with automated classification and alerts.
- Make FEFO the default and visible ordering for what to use first.
- Give each of the five roles a safe, appropriate view and set of actions.
- Run entirely on Cloudflare's free-ish tier: Pages, Pages Functions, D1, one cron Worker.

### Non-goals (v1)
- Native or desktop packaging, auto-updater, local backups/restore of a SQLite file.
- Camera-based barcode scanning, offline mode, background sync or conflict resolution.
- Multi-facility or multi-tenant support.
- Third-party auth, SSO, Cloudflare Access.
- Data migration from the Tauri app or the old `cmis-sync` D1.
- Email to arbitrary recipients on a paid plan (only the free verified-address path).

## 4. Users and roles

Five roles, one role per user. Admin creates accounts and assigns roles.

| Capability | Admin | Inventory Personnel | Pharmacist | Nurse / Healthcare Worker | Healthcare Administrator |
|---|---|---|---|---|---|
| Manage users, roles, system settings | Yes | No | No | No | No |
| Register / edit items and batches | Yes | Yes | No | No | No |
| Scan and look up items | Yes | Yes | Yes | Yes | Yes (read) |
| View inventory, status, FEFO list | Yes | Yes | Yes | Yes | Yes |
| Create requests | Yes | Yes | Yes | Yes | No |
| Approve / prepare / dispense requests | Yes | No | Yes | No | No |
| Quick Deduct | Yes | Yes | Yes | Yes | No |
| Adjust stock (count correction) | Yes | Yes | Yes | No | No |
| Dispose / write off expired stock | Yes | Yes | Yes | No | No |
| Soft-delete items/batches | Yes | Yes | No | No | No |
| Restore from Trash / permanent purge | Yes | No | No | No | No |
| View analytics and reports | Yes | Yes | Yes | No | Yes |
| Export reports (PDF/XLSX) | Yes | No | No | No | Yes |
| View audit log | Yes | No | No | No | Yes |
| Configure thresholds and alert settings | Yes | No | No | No | No |

Notes (my defaults where not explicitly decided; confirm during review):
- Inventory Personnel can soft-delete; only Admin can restore or purge.
- Healthcare Administrators are read-only except report export and audit-log viewing.
- Nurses see the FEFO list and availability (needed to request) but not cost/analytics.
- Permissions are enforced **server-side** on every API route; the UI only hides what the role cannot do.

## 5. Core user flow (from `all.md`)

1. User logs in (username/email + password).
2. Inventory personnel register a supply: item name, batch number, quantity, expiration date (plus the existing optional fields: dosage/strength, category, supplier, unit/pack size, low-stock threshold).
3. System assigns a QR code (generated from a short opaque batch ID) or stores an existing barcode/SKU supplied by the manufacturer.
4. User scans with a handheld scanner into a focused scan field; system retrieves the item/batch.
5. System computes days remaining until expiry.
6. System classifies each batch: Safe, Near Expiry, Urgent, Expired.
7. System prioritizes unexpired batches by FEFO.
8. System raises alerts and updates the dashboard.

## 6. Domain rules

### 6.1 Entities
- **Item**: a product definition (name, dosage/strength, category, unit, pack size, supplier, SKU/barcode, low-stock threshold, optional "no expiry" flag).
- **Batch**: stock of an item with a batch number, expiry date (nullable), quantity, received date, supplier, status, unique short code (QR payload).
- **Request**: a staff request for stock moving through an approval workflow (carried over from desktop).
- **Dispensing record**: a hand-over, tied to the batch(es) it drew from.
- **Disposal record**: an expired or damaged write-off with reason.
- **User, Session, Role**, **Notification**, **Push subscription**, **Audit entry**, **Setting**, **Trash entry**.

### 6.2 Expiry classification
Based on whole days remaining, `daysUntil = ceil((expiry − today) in the facility timezone)`:

| Class | Rule (defaults) | Maps to desktop `ExpiryStatus` |
|---|---|---|
| Expired | `daysUntil < 0` | `expired` |
| Urgent | `0 ≤ daysUntil ≤ urgentDays` (default 7) | `expiring-soon` (red) |
| Near Expiry | `urgentDays < daysUntil ≤ nearDays` (default 30) | `expiring-later` (orange) |
| Safe | `daysUntil > nearDays`, or no expiry date | `safe` |

- `urgentDays` and `nearDays` are admin-editable global settings; validate `0 ≤ urgentDays < nearDays`.
- Reuse the shape of `classifyExpiry` in `apps/desktop/src/features/inventory/domain/expiry.ts` (copied, with renamed labels: "Urgent" and "Near Expiry" instead of "Expiring Soon" and "Expiring Later").
- **Facility timezone**: a setting (default `Asia/Manila`, confirm). All day counting, "today" boundaries, digest scheduling and report month boundaries use it, not UTC or the browser's zone.
- Classification is **computed at read time** from the expiry date and current settings (not stored as a mutable column), so changing thresholds is instantly consistent. An optional denormalized column may be added later for query speed if needed.
- The earlier todo notes asked for separate warning (orange) and critical (red) windows to be real settings used by the Alerts and Low Stock pages. This spec keeps that: one pair of thresholds drives dashboard, expiry list, alerts, reports and digest.

### 6.3 FEFO prioritization
- For each item, eligible batches = not expired, not quarantined, `qty > 0`.
- Order: earliest expiry first; tie-break by earliest received date, then batch number. Batches with no expiry sort last.
- The FEFO list per item (and a facility-wide "use first" list) shows the recommended batch to pull next.
- Dispensing, Quick Deduct and request fulfillment draw from FEFO order automatically, and may span multiple batches. The record stores the exact batches and quantities taken.
- Copy and adapt the logic in `features/requests/deduct-stock.ts` and `features/inventory/domain/deduct-plan`.

### 6.4 Expired stock and disposal
- Expired batches are excluded from FEFO, from availability for requests, and from Quick Deduct.
- They appear in a **Quarantine / Expired** view, with a **Dispose / Write off** action: requires a reason (expired, damaged, recalled, other), logs a disposal record, sets qty to 0 (or marks disposed), and writes an audit entry.
- No override path for dispensing expired stock in v1.
- A batch that becomes expired while a request is Approved or Prepared must be re-validated at hand-over; the hand-over is blocked or reduced with a clear message.

### 6.5 Edge cases
- **No expiry date** (equipment, consumables): allowed per item; class is Safe ("No expiry"); excluded from the expiry timeline and from FEFO date ordering (sorted last).
- **Duplicate batch number for the same item**: detected case-insensitively and trimmed. Default behavior: block creation and offer "add quantity to the existing batch" with a confirmation. (Confirm.)
- **Expiry date already in the past at registration**: allowed, with an explicit warning; the batch is created as Expired/quarantined.
- **Same-day expiry**: FEFO tie-break per 6.3.
- **Zero quantity batches**: kept for history, hidden from FEFO and availability.
- **Negative stock**: never allowed; deductions are re-planned inside the same transaction as the write.
- **Concurrent dispensing**: D1 has no multi-statement transactions beyond `batch()`, so deductions use a conditional update (`UPDATE ... SET qty = qty - ? WHERE id = ? AND qty >= ?`) inside `DB.batch`, and the API returns a conflict if the row changed.
- **Date inputs**: ISO `YYYY-MM-DD` only; no date-time for expiry.

## 7. Features

### 7.1 Dashboard
Totals by status (Safe / Near Expiry / Urgent / Expired), low-stock count, items expiring this month, "use first" FEFO shortlist, recent dispensing, pending requests, alert banner. Month filter uses month+year only (per the todo note). Role-appropriate cards (e.g. nurses see availability, not analytics).

### 7.2 Inventory management
- Add/edit/soft-delete items and batches; batch entry sheet and paste import (copy from desktop `inventory/creation`).
- Batch number auto-suggest when empty (the todo asked for automatic FEFO-style batch code, same as the Step 1 wizard); "Remove" button when adding a batch row.
- Search, filters by status/category, virtualized table (copy TanStack Virtual usage).
- Item detail dialog with batches, FEFO order, history, and a **New request for this stock** button (todo item).
- Low-stock page and Expiry page using the shared threshold settings.

### 7.3 QR / barcode
- **Generate**: every batch gets a short opaque code (e.g. 8–10 chars, Crockford base32, unique). A QR rendered in-browser (client-side library) encodes only that code. Printable label sheet (item name, batch, expiry, QR).
- **Existing barcodes**: an item or batch can store a manufacturer barcode/SKU; lookup resolves either.
- **Scan input**: a global "scan" field and a Scan page that accept keyboard-wedge input (rapid keystrokes ending in Enter). No camera permissions needed. Scan resolves to a batch or item and shows details plus actions allowed for the role.
- Not found: clear message, and for permitted roles an "Register this code" shortcut.
- Optional: global key capture when no input is focused, with a debounce threshold to distinguish scanner input from typing.

### 7.4 Request queue
Carry over the desktop workflow (create, approve, prepare, ready to claim, claimed), role-gated per section 4. Validation message "quantity must be a whole number greater than zero" only appears after the user clicks Create (todo note). Ctrl+N opens New Request.

### 7.5 Dispensing and Quick Deduct
Hand-over deducts via FEFO and writes the dispensing log. Quick Deduct (Ctrl+D) is one item, one quantity, one confirm, with a short undo window. Both share one server-side service so rules cannot diverge. Dispensing is recorded per batch (this answers the todo question "is by-batch recorded monthly when dispensing?": yes, each record stores batch ID and quantity, and monthly reports aggregate by batch).

### 7.6 Alerts and notifications
Three channels, all driven by the same alert generator:
1. **In-app**: notification center (bell) and dashboard banner; per-user read/dismissed state. Alerts for: batch entering Near Expiry, entering Urgent, becoming Expired, low stock.
2. **Browser push (Web Push)**: service worker, VAPID keys as secrets, per-user opt-in on a device; sent by the cron Worker. Requires HTTPS (Pages provides it). Subscriptions that return 404/410 are deleted.
3. **Daily email digest**: via Cloudflare Email Service, free tier only, so only to destination addresses verified in the Cloudflare account. Admin manages a recipient list in settings. If sending is not available or fails, the job logs it and the app continues (in-app and push still work). If Cloudflare Email proves unavailable at implementation time, the email channel is dropped.

Alert hygiene: do not re-send the same transition for the same batch (store the last notified class per batch); digest lists current counts plus new transitions; quiet when nothing changed (admin setting).

### 7.7 Analytics
Port the existing widgets that make sense: usage donut, top dispensed, expiry timeline, stock movement, low-stock trend, dispensed vs requested. Visx charts.

### 7.8 Reports and export
Stock report and expiry report, month+year picker only, export to PDF and XLSX (copy desktop `admin/reports`). Role-gated per section 4. Exports are generated in the browser from API data.

### 7.9 Audit log and Trash
Append-only audit of auth events, inventory changes, dispensing, disposal, settings and user management, with actor, time and before/after summary. Trash holds soft-deleted items/batches with restore (Admin only) and purge.

### 7.10 User management and settings
- Admin: create/disable users, reset passwords, change roles. No deleting users who have history (disable only).
- Settings: facility name (the app-name field from the todo), timezone, thresholds, alert channels, digest recipients and time, density, theme.

### 7.11 Productivity and polish
Ctrl+K command palette (with item search and "new request" action), docs/help pages (rewrite for the web), density and theme toggles, loading and empty states, keyboard shortcuts modal.

## 8. Architecture

### 8.1 Repo layout
```
apps/
  desktop/            # unchanged
  web/
    src/              # React SPA (copied/adapted from desktop)
    functions/        # Pages Functions (API) -> /api/*
      api/...
      _middleware.ts  # session + role guard
    migrations/       # D1 SQL migrations (new numbering from 0001)
    public/           # icons, manifest, service worker for push
    wrangler.toml     # Pages config: D1 binding, vars, compatibility_date
workers/
  sync/               # existing, untouched
  cron/               # new scheduled Worker (alerts, digest, push), same D1 binding
packages/ui           # reused as-is via workspace dependency
```
`@cmis/ui` (packages/ui) is already a workspace package and may be imported; everything else is copied.

### 8.2 Frontend
- Vite SPA, TanStack Router (file-based) and Query, served as Pages static assets with SPA fallback (`_routes.json` limiting Functions to `/api/*`).
- Remove all `@tauri-apps/*` usage; replace the `lib/db.ts` SQLite layer with a typed API client (`fetch` to `/api/*`) wrapped by TanStack Query.
- Role-aware route guards and navigation.
- Respect the code standards in `AGENTS.md` (no barrel files, explicit types, no `console.log`, a11y).

### 8.3 API (Pages Functions)
- JSON over HTTPS under `/api`; validation with zod (already in the pnpm catalog).
- Middleware: parse session cookie, load user, enforce role per route, rate-limit login.
- Resource groups: `auth`, `users`, `items`, `batches`, `scan`, `requests`, `dispense`, `quick-deduct`, `disposals`, `alerts`, `push`, `analytics`, `reports`, `audit`, `trash`, `settings`.
- Errors: consistent `{ error: { code, message } }`; 409 for stock conflicts.

### 8.4 Auth and security
- Passwords hashed with PBKDF2 (WebCrypto) or an equivalent available in Workers, per-user salt, high iteration count; enforce minimum length.
- Sessions: random token stored hashed in D1, `HttpOnly; Secure; SameSite=Lax` cookie, sliding expiry with an absolute max; logout and "log out everywhere".
- CSRF: SameSite plus a required custom header on mutating requests and Origin check.
- Login throttling by username+IP (D1 table) and generic error messages.
- Forced password change on first login for admin-created accounts.
- First admin is created by a script (`pnpm web:seed-admin`) that reads credentials from env/wrangler secrets, never committed.
- Secrets (VAPID keys, session pepper) via `wrangler secret`/Pages secrets; none in the repo.
- Security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`) via `_headers`.
- Audit all privileged actions.

### 8.5 Database (D1)
Fresh schema starting at `0001`, in `apps/web/migrations/`. Note: the "never edit a shipped migration" rule in `AGENTS.md` is about `tauri-plugin-sql`; the same discipline is still adopted here (forward-only migrations applied by `wrangler d1 migrations apply`).

Indicative tables: `users`, `sessions`, `login_attempts`, `items`, `batches` (with `code` unique), `requests`, `request_items`, `dispensing_records`, `dispensing_lines` (batch-level), `disposals`, `notifications`, `notification_state`, `push_subscriptions`, `alert_state` (last notified class per batch), `audit_log`, `trash`, `settings`, `categories`. Indexes on `batches(item_id)`, `batches(expiry)`, `batches(code)`, `items(sku)`, `items(barcode)`.

Dates are stored as ISO `YYYY-MM-DD` (expiry) and ISO UTC timestamps (events). Money is not in scope.

### 8.6 Cron Worker
`workers/cron` with a `scheduled()` handler bound to the same D1:
- Daily (time configurable; default early morning facility time): recompute classes, create notifications for new transitions, send web push, send the email digest if configured.
- Idempotent per day via `alert_state` and a job-run table.
- Cron expressions are UTC; convert from facility time (and handle DST if the timezone has it).

### 8.7 Deployment
- Scripts (root `package.json`): `web:dev` (Vite + `wrangler pages dev` with local D1), `web:build`, `web:deploy` (`wrangler pages deploy`), `web:migrate` (local and `--remote`), `web:seed-admin`, `web:seed-demo`, `cron:deploy`.
- `apps/web/wrangler.toml`: `pages_build_output_dir`, D1 binding `DB`, pinned `compatibility_date`, `nodejs_compat` only if needed.
- GitHub Actions workflow: on PR run lint, typecheck, tests; on `main` run the same, apply remote D1 migrations, deploy Pages, deploy the cron Worker. Uses `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. Existing `.github/workflows/tauri.yml` untouched.
- Environments: production, plus Pages preview deployments per branch (preview uses a separate D1).
- Docs: `apps/web/README.md` with one-time setup (`wrangler d1 create`, secrets, first admin).

## 9. Demo data
Reuse the idea of `scripts/seed-demo-data.json` with relative timestamps so every status class, FEFO tie, expired batch, requests in every column and dispensing history are populated. Provide `pnpm web:seed-demo` that targets local D1 or a named remote database only with an explicit flag; refuse to run against production without a confirmation flag.

## 10. Non-functional requirements
- **Performance**: inventory list with thousands of batches stays responsive (server-side pagination or virtualization); P95 API under about 300 ms on D1 for common reads; lean bundle with route-level code splitting.
- **Accessibility**: a11y rules from `AGENTS.md`, labelled forms, keyboard operable, color is never the only status signal (icons/text with Safe/Near/Urgent/Expired).
- **Responsive**: usable on tablet and phone widths (nurses on the floor), though data-entry-heavy screens are desktop-first.
- **Browser support**: current evergreen browsers; Web Push needs a push-capable browser (note iOS requires installing to the home screen).
- **Limits**: Pages Functions CPU/time limits and D1 free-tier row/read limits are respected; avoid N+1 queries.
- **Privacy**: no patient data is stored; only supply and staff data. Update `docs/privacy.md` equivalent for the web app (it is no longer local-first).

## 11. Testing
- Vitest for domain logic (classification, FEFO ordering, deduction planning, threshold validation, timezone day-count, duplicate-batch detection).
- API tests for Functions using a local D1 (miniflare/workerd via `wrangler` or `@cloudflare/vitest-pool-workers`), covering auth, role permissions per route, stock conflicts and audit writes.
- Component tests (Testing Library) for key dialogs and the scan field behavior.
- Cron job tests with a fake clock for transitions, idempotence and timezone boundaries.
- A role-permission matrix test derived from section 4.

## 12. Migration of existing materials
- No data migration. Copy and adapt: expiry domain, FEFO deduct planning, request transitions, report export, analytics widgets, UI primitives, docs content (rewritten for web).
- Remove from the copy: updater, backup/restore, sync, menubar/titlebar, Tauri file dialogs/opener, device tag, `lib/tauri.ts`.

## 13. Milestones (proposed)
1. Scaffold `apps/web`, wrangler config, D1 schema, auth, roles, first-admin script, CI.
2. Items/batches CRUD, expiry classification, FEFO list, dashboard, thresholds settings.
3. Scan field, QR generation, label printing.
4. Requests, dispensing, Quick Deduct, disposals, audit log, Trash.
5. Notifications center, cron Worker, web push, email digest.
6. Analytics, reports export, command palette, docs, demo seed, polish.

## 14. Open questions / assumptions to confirm
- Default facility timezone (assumed `Asia/Manila`).
- Duplicate batch policy (assumed: block and offer merge).
- Exact permission cells flagged as defaults in section 4.
- Whether a user may belong to more than one role (assumed no).
- Digest send time and whether to send on "no changes" days (assumed configurable, default skip).
- Whether Cloudflare Email Service free-tier sending is actually available on the account; if not, drop email.
- Whether the name stays "MediTrack" or becomes "MediTract" in the UI.
- Password reset: admin-initiated only (no email self-service) in v1.
- Whether Pages preview deployments should be enabled and whether they need their own D1.
