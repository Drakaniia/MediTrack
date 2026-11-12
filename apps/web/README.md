# MediTract Web

Hosted, role-based medical supply expiry tracking and FEFO dispensing: a React SPA
(`src/`) served by Cloudflare Pages, a JSON API as Pages Functions (`functions/`, logic in
`server/`), one D1 database (`migrations/`), and a scheduled Worker
([`workers/cron`](../../workers/cron)) for alerts, web push and the email digest.

- Product spec: [`meditract-web-spec.md`](../../meditract-web-spec.md)
- How it is built (read before coding): [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Privacy statement: [`docs/privacy-web.md`](../../docs/privacy-web.md)

All commands run from the **repository root** unless stated otherwise. Windows, macOS and
Linux are supported; the dev scripts are plain Node and need no shell.

## Local development

```text
pnpm install
pnpm web:dev
```

| URL                     | What                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| `http://localhost:3002` | **Open this.** Vite (HMR). It proxies `/api/*` to the API server below.      |
| `http://127.0.0.1:8788` | `wrangler pages dev`: the Functions API with a local D1. Not the app itself. |

`pnpm web:dev` does three things first so a fresh clone just works:

1. creates `apps/web/.dev.vars` from `.dev.vars.example` with a random `SESSION_PEPPER` (gitignored);
2. applies pending local migrations (`pnpm web:migrate`) into `apps/web/.wrangler/state`;
3. starts both servers with `[api]` / `[web]` prefixed output. **Ctrl+C stops both**, including
   the `workerd` process (on Windows via `taskkill /T /F`).

Other everyday commands:

```text
pnpm web:migrate                 # local D1 (default)
pnpm test:web                    # server (node) + client (jsdom) vitest projects
pnpm check-types:web             # vp build + tsc --noEmit
pnpm exec vp lint apps/web workers/cron
pnpm cron:dev                    # the scheduled Worker, with a manual trigger (see its wrangler.toml)
```

To start over with an empty local database, stop `web:dev` and delete `apps/web/.wrangler`.

### Why the API is on another port, and the CSRF check

Writes are checked with `Origin === new URL(request.url).origin`. The browser is on
`localhost:3002`, so the proxied request must still say `Host: localhost:3002`. The Vite proxy
in `vite.config.ts` therefore sets `changeOrigin: false`; do not change it, or every POST in
dev fails with `403 csrf_failed / origin_mismatch`.

## One-time production setup

You need a Cloudflare account (the free plan is enough) and `pnpm install` done.

```text
cd apps/web

# 1. Databases. Paste each printed database_id into wrangler.toml
#    (top-level [[d1_databases]] AND [[env.production.d1_databases]] get the same id;
#     [[env.preview.d1_databases]] gets the id of meditract-preview) and into
#    workers/cron/wrangler.toml (same id as production).
pnpm exec wrangler d1 create meditract
pnpm exec wrangler d1 create meditract-preview      # optional, only for PR previews

# 2. Pages project (once).
pnpm exec wrangler pages project create meditract --production-branch main

# 3. Secrets.
pnpm exec wrangler pages secret put SESSION_PEPPER --project-name meditract
```

`SESSION_PEPPER` is a long random string, for example
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
Changing it later signs everybody out. Preview deployments take their own value from the
dashboard (Workers & Pages > meditract > Settings > Variables and Secrets > Preview).

Web push (optional): generate a VAPID key pair, then keep the halves apart.

```text
node scripts/web-vapid-keys.mjs
```

- the **public** key goes into `VAPID_PUBLIC_KEY` under `[vars]` of `apps/web/wrangler.toml`
  (each env block) and of `workers/cron/wrangler.toml`;
- the **private** key is a secret of the cron Worker only:
  `cd workers/cron && pnpm exec wrangler secret put VAPID_PRIVATE_KEY`.

Then migrate the remote database and create the first admin:

```text
pnpm web:migrate --remote

# comes with the SEED slice: reads credentials from the environment, never from the repo
set WEB_ADMIN_USERNAME=admin            (cmd; use `export` on macOS/Linux)
set WEB_ADMIN_PASSWORD=<a long passphrase>
set WEB_ADMIN_EMAIL=you@example.org     (optional)
pnpm web:seed-admin --remote
```

The admin must change the password at first sign-in. Without `--remote` the same command seeds
the local database used by `pnpm web:dev`. `pnpm web:migrate` refuses `--remote` while
`database_id` is still `REPLACE_WITH_D1_ID` and tells you which block to fix.

Deploy by hand (CI does the same on every push to `main`):

```text
pnpm web:deploy                 # builds, then wrangler pages deploy to project "meditract"
pnpm cron:deploy                # the scheduled Worker
```

### Environments

| Environment | Selected by                          | D1                 | `APP_ENV`    |
| ----------- | ------------------------------------ | ------------------ | ------------ |
| local       | `pnpm web:dev`                       | `.wrangler/state`  | `local`      |
| preview     | any branch other than `main`         | `meditract-preview`| `preview`    |
| production  | branch `main`                        | `meditract`        | `production` |

`pnpm web:migrate --remote --env preview` / `--env production` target the matching block.

## CI/CD

`.github/workflows/web.yml` (`ci.yml` separately runs the repo-wide lint, typecheck, test and build):

- **verify** on every PR and push touching web paths: lint, typecheck and tests for web
  and cron, and a cron bundle dry-run.
- **deploy** on push to `main` (needs `verify`, GitHub environment `production`): build,
  `wrangler d1 migrations apply meditract --remote --env production`, `wrangler pages deploy`, cron Worker.
- **preview** (optional) for same-repo PRs when the repository variable `WEB_PREVIEW_ENABLED` is
  `true`: migrations on the preview database, then a Pages deployment named after the branch.

Configure in GitHub (Settings > Secrets and variables > Actions):

| Name                    | Kind     | Value                                                                              |
| ----------------------- | -------- | ---------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | secret   | token with Pages: Edit, Workers Scripts: Edit, D1: Edit (account-scoped)            |
| `CLOUDFLARE_ACCOUNT_ID` | secret   | your Cloudflare account id                                                         |
| `WEB_PREVIEW_ENABLED`   | variable | `true` to enable PR previews (needs the preview D1 id in `wrangler.toml`)          |

Also create a GitHub environment named `production` (add required reviewers if you want a
manual gate). The D1 ids committed in the two `wrangler.toml` files are identifiers, not secrets.

## Cron Worker

`workers/cron` wakes every 15 minutes and decides, in the facility's timezone and with its
configured digest time (DST included), what is due. It shares the web app's D1 and is
idempotent per day. Deploy with `pnpm cron:deploy` after the `database_id` and `[vars]`
(`VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `EMAIL_FROM`, `APP_URL`) are filled in, and
`VAPID_PRIVATE_KEY` is set as a secret.

### Email digest and the free tier

The digest uses Cloudflare Email Service through the optional `EMAIL` binding. On the free
tier it can only deliver to **verified destination addresses**: add each recipient under
Email > Email Routing > Destination addresses and confirm the verification mail. Anything
else, an unconfigured binding or an empty `EMAIL_FROM` degrades gracefully: the digest is
skipped and logged, in-app notifications and web push still work.

## Security headers

`public/_headers` ships a strict CSP (`script-src 'self'`, no inline scripts, no third-party
origins), `X-Frame-Options: DENY`, HSTS, `nosniff`, a locked-down `Permissions-Policy` and
cache rules (`/assets/*` immutable; `sw.js`, `index.html`, `manifest.webmanifest` no-cache).
`public/_routes.json` runs Functions only for `/api/*`. If a library needs a looser CSP, change
the library or discuss it first; do not widen `script-src`.

Note for exports: jsPDF and xlsx run in the browser and create `blob:` / `data:` URLs for
downloads; `img-src` already allows both. They must not load scripts or fonts remotely.

## Troubleshooting

| Symptom                                                  | Cause / fix                                                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Port 3002 is already in use`                            | A previous `web:dev` is still running (`taskkill /IM workerd.exe /F` on Windows). Vite uses `--strictPort` on purpose. |
| `403 csrf_failed` on every write in dev                  | You opened `127.0.0.1:8788` or a different port. Use `http://localhost:3002`.                        |
| `SESSION_PEPPER is not configured`                       | `apps/web/.dev.vars` missing or empty (delete it and rerun `pnpm web:dev`), or the Pages secret is unset. |
| `no such table`                                          | Migrations not applied: `pnpm web:migrate` (add `--remote` for production).                          |
| `database_id ... is still the placeholder`               | Run `wrangler d1 create`, paste the id into the named block of `apps/web/wrangler.toml`.             |
| CI: `Authentication error` / `10000`                     | `CLOUDFLARE_API_TOKEN` lacks a permission (Pages, Workers Scripts, D1) or the account id is wrong.   |
| CI deploy fails at `d1 migrations apply`                 | `[env.production]` still has the placeholder id, or a migration has a SQL error. Fix forward with a new migration; never edit an applied one. |
| Local data seems to vanish                               | State lives in `apps/web/.wrangler/state`. `web:dev` and `web:migrate` must use the same one (they do; do not pass another `--persist-to`). |
| Lots of leftover `workerd.exe` after a crash             | `taskkill /IM workerd.exe /F` (Windows) / `pkill workerd`.                                           |
