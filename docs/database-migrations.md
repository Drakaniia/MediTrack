# Database Migration Rules

Migrations live in `apps/web/migrations/` and are applied to Cloudflare D1 by
`wrangler d1 migrations apply` (locally through `pnpm web:migrate`, remotely by the
`deploy` job in `.github/workflows/web.yml`). **Once a migration has been applied to a
shared database (preview or production), its file must never change again.**

## The rule

| Action | Allowed |
|--------|---------|
| Adding a new `NNNN_name.sql` | Yes, always |
| Changing or deleting a migration that has been applied remotely | **Never** |
| Changing a migration that has only ever run on your local database | Yes, then reset your local D1 |

## Why

D1 records each applied migration by file name in its `d1_migrations` table and never
re-runs it. Editing an applied file therefore does nothing on databases that already ran
it, while a fresh database gets the new version. The schema silently diverges between
environments, and the difference only shows up as a broken query in production.

Deleting an applied file is just as bad: the next fresh database (a new preview, a
restore, a teammate's clone) is missing a step every other environment has.

## Doing it right

Create the next numbered file and apply it locally:

```
apps/web/migrations/0002_some_change.sql
pnpm web:migrate
```

To fix a mistake in a migration that already shipped, add `0003_...` that corrects it.
Never squash, reword or amend an applied migration to keep history tidy, not even a
comment.

If a migration has only run locally, you may edit it. Stop `web:dev`, delete
`apps/web/.wrangler`, and start again so your local database is rebuilt from the files.

## Writing a migration

- A file must not open its own transaction (`BEGIN` / `COMMIT`); D1 rejects them.
- Keep each migration forward-only. D1 has no down migrations.
- Prefer additive changes (new tables, new nullable columns) so the previously deployed
  Functions keep working until the new build is live.
