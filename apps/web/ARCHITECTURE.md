# MediTract Web — architecture contract

Read this BEFORE writing code. It freezes the decisions that let many people build in
parallel. The product spec is `meditract-web-spec.md` (repo root); this file says *how* it is
built. `AGENTS.md` is a hard contract on top of everything here.

## 1. Shape

```text
Browser SPA (Vite · React 19 · TanStack Router file routes + Query · Tailwind 4 · @cmis/ui)
   │  fetch /api/*   (cookie session, x-meditract-csrf header on writes)
   ▼
Cloudflare Pages ── functions/api/[[route]].ts ──► server/api.ts ──► router ──► server/routes/*.ts ──► services ──► D1 (DB)
                                                                                        ▲
workers/cron  (scheduled, same D1) ── imports apps/web/shared + apps/web/server by RELATIVE path ─┘
```

```text
apps/web/
  functions/            thin Pages Functions shims only (_middleware.ts, api/[[route]].ts)
  server/               Workers-only code. RELATIVE imports only. No node:* imports.
    env.ts http.ts route-types.ts            (written: the contract)
    router.ts api.ts guards.ts audit.ts settings-store.ts log.ts   (PLATFORM)
    auth/*                                    (PLATFORM) password, session, csrf, rate-limit, crypto
    routes/<slice>.ts                         one RouteDef[] module per slice, composed by routes/registry.ts
    services/<slice>/*.ts                     business logic called by routes (and by cron)
  shared/               isomorphic code. RELATIVE imports only. No node:* imports. Web APIs only.
    roles.ts permissions.ts dates.ts expiry.ts api.ts session.ts settings.ts   (written)
    schemas/inventory.ts                      cross-slice DTOs (written, owned by INV afterwards)
    schemas/<slice>.ts                        zod input schemas + DTO types of a slice
  src/                  the SPA. Aliases: @/ = src/, @shared/ = shared/, @cmis/ui/* = packages/ui/src/*
  migrations/0001_init.sql                    the complete schema (written)
  test/harness.ts                             node:sqlite stand-in for D1 (written)
  test/app.ts                                 API test app (PLATFORM)
  public/                                     static files, _headers, _routes.json, sw.js
workers/cron/           scheduled Worker (alerts, web push, email digest)
```

Why one catch-all Function: the whole API is testable by calling `handleApi(request, env)` with a
fake D1 (no workerd), the permission table is enforced in one place, and Pages' per-file routing
cannot silently leave a route unguarded.

## 2. Hard rules (everyone)

1. **Code standards (`AGENTS.md`)**: no barrel files, no `console.*` (server: `server/log.ts`;
   SPA: toasts), explicit types on exported functions, no `any`, `for…of`, arrow callbacks, early
   returns, top-level regex literals, small functions, no nested ternaries, kebab-case file names,
   a11y rules (labels, keyboard handlers, semantic elements, `rel="noopener"`). Run
   `pnpm exec vp lint <paths you own>` — NEVER on the whole repo or on files you do not own.
2. **`shared/`, `server/`, `functions/` use RELATIVE imports only** (wrangler's esbuild does not
   know the SPA aliases) and only Web APIs (`crypto.subtle`, `crypto.randomUUID`, `TextEncoder`,
   `Intl`, `fetch`, `URL`). Tests may use `node:*`.
3. **Time is injected.** Server code uses `ctx.now` / a `now: Date` parameter, never `new Date()`
   or `Date.now()` in services. "Today" is the facility-local date: `todayInZone(now, tz)`.
4. **Expiry class is never stored.** Compute with `shared/expiry.ts` (`assessExpiry`,
   `classBoundaries`, `expiryClassCase`, `expiryClassWhere`). Thresholds and timezone come from settings.
5. **SQL**: parameterised only; dynamic identifiers only from whitelists; `LIKE` text through
   `escapeLike()` + `ESCAPE '\'`; ≤ 90 bound params per statement (`chunk()`/`placeholders()` in
   `server/http.ts`); no `exec()`; no N+1 (use joins/aggregates or `IN (…)` chunks); keep a `db.batch()` under ~100 statements.
6. **Every mutation is ONE `db.batch([...])`** holding the writes, the `stock_movements` rows (when a
   quantity changes) and `auditStatement(...)`, so a ledger/audit row can never be missing or orphaned.
7. **Stock safety.** `batches.qty` has `CHECK (qty >= 0)`: an over-deduction THROWS and rolls the
   whole batch back. Map it with `batchOrConflict()` → `409 stock_conflict`, re-plan once, then give up.
   For other preconditions (e.g. `UPDATE requests … WHERE id=? AND status='pending'`) follow the update with
   `guardChanged(db, 1)`: a statement that raises when the previous write changed ≠ 1 rows, aborting the batch
   (`SELECT CASE WHEN changes() = ? THEN 1 ELSE abs(-9223372036854775808) END`, verified on SQLite 3.50).
8. **Permissions are enforced server-side** by the route's `access` (a `Permission`, `"authenticated"` or
   `"public"`); the router refuses to register a route without one. Handlers add only finer checks
   (e.g. "own request") and throw `HttpError("forbidden", …)`. The SPA only *hides* what a role cannot do.
9. Never return `password_hash`, session ids/tokens or the VAPID private key. No patient data anywhere.
10. **Do not** run `pnpm install/add`, edit any `package.json`/lockfile, or run `git add/commit/stash/reset`.
    Need a dependency? Say so in your report and work around it.
11. Edit only files you own (section 7). Cross-slice needs → use the contract (sections 5–6) or report.
    A few shared append-only files may get a minimal additive edit (re-read right before editing): `shared/api.ts`
    (new error code), `src/lib/api/invalidate.ts` (new query root).

## 3. Wire conventions

- Success `{ "data": T, "meta"?: { total, limit, offset, nextCursor } }`; errors
  `{ "error": { "code", "message", "details"? } }` — codes in `shared/api.ts` (`HttpError(code, message, details)`).
  Helpers: `ok()`, `created()`, `noContent()`, `parseJson(ctx, schema)`, `parseQuery(ctx, schema)`, `readPaging(ctx)`.
- JSON keys camelCase; DB columns snake_case (map in the service). Ids are strings (uuid). Timestamps ISO UTC
  (`2026-11-12T02:55:53.123Z`). Dates `YYYY-MM-DD` (facility calendar). Booleans are JSON booleans (DB 0/1).
- Lists: `?limit` (default 50, max 200) & `?offset`, response `meta.total`. Filters are query params; lists are comma-separated.
- Writes need header `x-meditract-csrf: 1` and a same-origin `Origin`; cookie `mt_session` is `HttpOnly; SameSite=Lax; Path=/` (+`Secure` on https).
- 401 `unauthenticated` → SPA goes to `/login`; 403 `password_change_required` → `/change-password`; 403 `forbidden`.
- Bad input → 400 `validation_error` with `details.issues[{path,message}]`. Stock conflict → 409. Missing → 404 `not_found`.

## 4. Database rules (see `migrations/0001_init.sql` — it is the schema)

- Soft delete = `deleted_at` on `items`/`batches` (Trash is a view over those rows; deleting an item sets
  `deleted_with_item=1` on its live batches; restore reverses exactly those). Purge = hard delete; history tables keep snapshots (`item_name`, `batch_number`) and nullable FKs.
- `stock_movements` is the append-only ledger (kinds `receive|dispense|undo_dispense|dispose|adjust`); one row per batch touched, `qty_after` = quantity after the change
  (`INSERT … SELECT … b.qty FROM batches b WHERE b.id = ?` AFTER the UPDATE inside the same batch).
- FEFO: `ORDER BY expiry IS NULL, expiry, received_on, batch_number_lower, id`; eligible = `deleted_at IS NULL AND status='active' AND qty>0 AND (expiry IS NULL OR expiry >= today)`.
- `available` = Σqty over eligible batches; `onHand` = Σqty over active batches (incl. expired awaiting disposal). Low stock: `lowStockThreshold > 0 && available < lowStockThreshold`; "out" when `available = 0` and `lowStockThreshold > 0` (computed on `available`).
- Batch `code`: 10 chars Crockford base32 (QR payload), `UNIQUE`; generate with `generateBatchCode()`, retry on UNIQUE violation.
- Migrations are forward-only (`0002_*.sql`, …). Never edit `0001_init.sql` once a real database has it. A slice that needs schema changes adds the NEXT free number and tells the orchestrator in its report.
- Password hash string: `pbkdf2-sha256$<iterations>$<salt base64url>$<hash base64url>` (16-byte salt, 32-byte key, iterations ≤ 100 000 — the Workers WebCrypto ceiling).
- Session cookie token → `sessions.id = hex(sha256(token + SESSION_PEPPER))`.

## 5. API route table (all under `/api`)

PLATFORM
- `POST /auth/login` public · `POST /auth/logout` · `POST /auth/logout-all` · `GET /auth/me` → `MeResponse` · `POST /auth/change-password` (the last three + logout are `allowPasswordChangePending`) · `GET /health` public
- `GET|POST /users`, `PATCH /users/:id`, `POST /users/:id/disable|enable|reset-password` — `users.manage` (never delete; not the last active admin; not yourself)
- `GET|PUT /settings` — `settings.manage` (`AppSettings`, `SettingsPatch` from `shared/settings.ts`)
- `GET /audit` — `audit.view` — filters `from,to,actorId,action,entityType,q,limit,offset`

INV (items · categories · batches · FEFO · bulk · trash)
- `GET /items` (`search,categoryId,status,stock,sort,dir,limit,offset`) → `ItemSummaryDto[]` · `POST /items` (item + optional `batches[]`) `inventory.write` · `GET /items/:id` → `ItemDetailDto` · `PATCH /items/:id` · `DELETE /items/:id` `inventory.delete` · `GET /items/:id/history` · `GET /items/:id/fefo` · `POST /items/bulk` (paste/sheet import)
- `GET|POST /categories`, `PATCH|DELETE /categories/:id` (`inventory.write`)
- `GET /fefo` → `FefoEntryDto[]` (facility-wide "use first": each item's next batch)
- `POST /items/:id/batches` (blank `batchNumber` → server suggests; duplicate → `409 duplicate_batch {existingBatchId, existingQty}` unless `mergeIntoExisting:true`) · `GET /batches/:id` · `PATCH /batches/:id` (number, expiry, supplier, barcode, receivedOn — NOT qty) · `DELETE /batches/:id` · `GET /batches/suggest-number?itemId=`
- `GET /trash` · `POST /trash/:type/:id/restore` · `DELETE /trash/:type/:id` (purge) — `trash.manage`, `type` = `item|batch`

EXP (expiry · low stock · quarantine · stock operations)
- `GET /expiry` (`class,categoryId,search,from,to,sort,limit,offset`) + `GET /expiry/summary` · `GET /low-stock` · `PATCH /items/:id/threshold` (`inventory.write`) · `GET /quarantine`
- `POST /batches/:id/adjust` `stock.adjust` (`{newQty}` or `{delta}`, `reason`, `note?`) · `POST /batches/:id/dispose` `stock.dispose` (`{reason: expired|damaged|recalled|other, note?}`; whole remaining qty) · `GET /disposals`

REQ (requests · dispensing · quick deduct)
- `GET /requests` · `POST /requests` (`{lines:[{itemId,qty,unit?}], reason?, requestor?}` → one request per line) · `GET|PATCH /requests/:id` · `POST /requests/:id/transition` (`requests.process`) · `POST /requests/:id/dispense` (FEFO deduct, re-validates expiry, partial allowed) · `POST /requests/:id/cancel` · `POST /requests/reorder` · `POST /requests/archive-claimed`
- `GET /dispensing` (`dispensing.view`) · `POST /quick-deduct` · `POST /quick-deduct/:recordId/undo` (same user, ≤ `QUICK_DEDUCT_UNDO_SECONDS`)

SCAN
- `GET /scan?code=` `scan.use` → `{kind:'batch', batch, item}` | `{kind:'item', item}` | `{kind:'ambiguous', items}`; 404 `scan_not_found {code, canRegister}`. Resolution: batch `code` (normalised) → batch `barcode` → item `barcode` → item `sku`.

ALERTS (+ CRON for `POST /alerts/run`)
- `GET /alerts` · `GET /alerts/banner` · `POST /alerts/read-all` · `POST /alerts/:id/read` · `POST /alerts/:id/dismiss` · `GET /push/config` · `POST /push/subscribe` · `POST /push/unsubscribe` · `GET /push/subscriptions` — `alerts.view`; `POST /alerts/run` — `settings.manage`

DASH · ANALYTICS
- `GET /dashboard?month=YYYY-MM` `dashboard.view` · `GET /analytics` `analytics.view` · `GET /reports/stock?month=` and `GET /reports/expiry?month=` `reports.view` (on screen) · `GET /reports/stock/export?month=&format=pdf|xlsx` and `GET /reports/expiry/export?month=&format=` `reports.export` (same payload, audited as `report.export`; PDF/XLSX are built in the browser only from these responses)

## 6. SPA conventions

- Routes are flat dotted files in `src/routes/` (TanStack file routing, `autoCodeSplitting`). `routeTree.gen.ts` is generated and committed.
- Every route's `beforeLoad` calls `requirePermission(context, "<permission>")` (SHELL, `src/lib/auth/guards.ts`).
- Data: TanStack Query hooks per slice in `src/features/<slice>/hooks/*.ts`, calling `apiGet/apiPost/apiPatch/apiPut/apiDelete` from `@/lib/api/client` (they unwrap `data`; `apiGetPage` also returns `meta`; errors are `ApiError {status, code, message, details}`).
  Query key roots (first element): `auth`, `inventory` (items, batches, fefo, expiry, low-stock, quarantine, trash, categories), `requests`, `dispensing`, `dashboard`, `analytics`, `reports`, `alerts`, `audit`, `users`, `settings`, `scan`.
  After any stock-affecting mutation call `invalidateStockQueries(queryClient)` (`src/lib/api/invalidate.ts`).
- Facility context from `/auth/me`: `useFacility()` → `{ name, timezone, today, urgentDays, nearDays }`; `useCan("permission")`; `<Can permission="…">`; `formatDate`, `formatDateTime`, `formatRelativeDay` in `src/lib/format.ts` (facility timezone, never the browser's).
- Shared UI from SHELL: `PageHeader`, `ExpiryBadge` (icon + text + colour), `DataState` (loading / error / empty), `Can`, `CommandPalette` (Ctrl+K, also owns the `?` `ShortcutsDialog`). Primitives from `@cmis/ui/components/*` (button, dialog, input, popover, command, calendar, …). Keep feature CSS next to the feature (`import "./x.css"`); do not edit `src/index.css`.
- Hotkeys: `useHotkey("mod+n", handler, { enabled })` from `src/lib/hotkeys.ts`. Reserved: `mod+k` palette, `mod+n` new request, `mod+d` quick deduct, `shift+/` shortcuts.
- Forms validate with the shared zod schema; per spec §7.4, show field errors only AFTER the user submits.
- Lists > 200 rows: `@tanstack/react-virtual` or server paging (infinite query). Color is never the only signal (text/icon too). Tablet/phone widths must remain usable.
- Component tests: Testing Library + `src/test/mock-api.ts` (`mockApi({ "GET /api/items": … })`) — no real network.

### Integration points (SHELL creates stubs in wave 1; the named owner replaces them)

| Stub file (src/) | Export | Owner |
|---|---|---|
| `features/alerts/components/notification-bell.tsx` | `NotificationBell` | ALERTS |
| `features/alerts/components/alert-banner.tsx` | `AlertBanner` | ALERTS |
| `features/scan/components/global-scan-field.tsx` | `GlobalScanField` | SCAN |
| `features/requests/new-request-dialog-context.tsx` | `NewRequestDialogProvider`, `useNewRequestDialog(): { openNewRequest(opts?: { itemId?: string; qty?: number }): void }` | REQ |
| `features/requests/quick-deduct-dialog-context.tsx` | `QuickDeductDialogProvider`, `useQuickDeductDialog(): { openQuickDeduct(opts?: { itemId?: string }): void }` | REQ |
| `features/inventory/stock-item-detail-dialog-context.tsx` | `StockItemDetailDialogProvider`, `useStockItemDetailDialog(): { openItemDetail(itemId: string, opts?: { batchId?: string }): void }` | INV |
| `components/command-palette.tsx`, `components/shortcuts-dialog.tsx` | `CommandPalette`, `ShortcutsDialog` | wave 3 |

### SPA routes

| Path | File (`src/routes/`) | Permission | Owner |
|---|---|---|---|
| `/login`, `/change-password` | `login.tsx`, `change-password.tsx` | public / authenticated | SHELL |
| `/` | `index.tsx` | `dashboard.view` | DASH |
| `/inventory`, `/inventory/add`, `/inventory/fefo` | `inventory.index.tsx`, `inventory.add.tsx`, `inventory.fefo.tsx` | view / `inventory.write` / view | INV |
| `/inventory/expiry`, `/low-stock`, `/quarantine` | `inventory.expiry.tsx`, `inventory.low-stock.tsx`, `inventory.quarantine.tsx` | `inventory.view` | EXP |
| `/trash` | `trash.tsx` | `trash.manage` | INV |
| `/scan`, `/labels` | `scan.tsx`, `labels.tsx` | `scan.use` / `inventory.write` | SCAN |
| `/requests`, `/dispensing` | `requests.tsx`, `dispensing.tsx` | `requests.view` / `dispensing.view` | REQ |
| `/notifications` | `notifications.tsx` | `alerts.view` | ALERTS |
| `/analytics`, `/reports` | `analytics.tsx`, `reports.tsx` | `analytics.view` / `reports.view` | ANALYTICS |
| `/audit`, `/users`, `/settings` | `audit.tsx`, `users.tsx`, `settings.tsx` | `audit.view` / `users.manage` / authenticated (tabs by permission) | ADMIN |
| `/docs`, `/docs/$slug` | `docs.tsx`, `docs.$slug.tsx` | authenticated | wave 3 |

## 7. Ownership (wave 1 → wave 2 → wave 3)

| Agent | Owns |
|---|---|
| orchestrator (done) | `migrations/0001_init.sql`, `server/{env,http,route-types}.ts`, `shared/{roles,permissions,dates,expiry,api,session,settings}.ts` (+tests), `shared/schemas/inventory.ts` (initial), `test/harness.ts`, this file |
| INFRA | root `package.json` scripts, `vite.config.ts`, `.gitignore`, `scripts/web-dev.mjs`, `scripts/web-migrate.mjs`, `.github/workflows/web.yml`, `apps/web/wrangler.toml`, `.dev.vars.example`, `public/_headers`, `public/_routes.json`, `workers/cron/{wrangler.toml,src/index.ts}` |
| PUSHMAIL | `workers/cron/src/push/*`, `workers/cron/src/email/*`, `scripts/web-vapid-keys.mjs` |
| DOMAIN | `shared/{fefo,deduct-plan,batch-code,low-stock}.ts` (+tests) |
| PLATFORM | `server/{router,api,guards,audit,settings-store,log}.ts`, `server/auth/*`, `server/routes/{registry,auth,users,settings,audit,health}.ts` + a stub module for every other slice, `functions/**`, `shared/schemas/{users,audit}.ts`, `test/app.ts`, route-matrix test |
| SHELL | `index.html`, `components.json`, `public/{theme-init.js,manifest.webmanifest,icons}`, all of `src/` except slice folders: `main.tsx`, `index.css`, `routes/{__root,login,change-password}.tsx` + route stubs, `lib/**`, `hooks/**`, `components/**` (shell, expiry-badge, page-header, …), `app/nav-config.ts`, `test/**` |
| INV · EXP · REQ · SCAN · ALERTS · CRON · DASH · ANALYTICS · ADMIN · SEED | their `server/routes/<slice>.ts`, `server/services/<slice>/**`, `shared/schemas/<slice>.ts`, `src/features/<slice>/**`, their route files, and tests for all of it |

## 8. Commands

```text
pnpm --filter web test                                  # both vitest projects (server = node, client = jsdom)
pnpm --filter web exec vitest run --project server <f>  # focused server/shared/API test
pnpm --filter web exec vitest run --project client <f>  # focused SPA test
pnpm --filter web check-types                           # vp build + tsc --noEmit
pnpm exec vp lint <paths>                               # lint (oxlint)
pnpm web:dev  ·  pnpm web:migrate  ·  pnpm web:build  ·  pnpm web:deploy
```
