# `prisma/migrations/` — intentionally empty

The Prisma migrations for this project live one directory deeper, at:

```
apps/api/prisma/schema/migrations/
```

That layout is the consequence of the **multi-file schema** setup in
`apps/api/prisma.config.ts`, which points Prisma at `prisma/schema/`
as the schema root. Prisma then resolves the `migrations/` directory
relative to the schema root, **not** the conventional
`prisma/migrations/` next to a single `schema.prisma`.

This directory is kept (with a `.gitkeep`) only so that operators
running an older Prisma CLI or following an out-of-date guide don't
accidentally write a stray empty migration here and break the
migration lock. Always use the canonical path.

## Verifying which migrations are tracked

```sh
pnpm --filter @sportsmart/api exec prisma migrate status
```

The output lists every migration the CLI has applied. The
authoritative source of truth is `prisma/schema/migrations/` plus the
`_prisma_migrations` table in the live database — never this
directory.

## Rollback

A bad migration is reverted via the procedure documented in
`docs/MIGRATION_ROLLBACK_PLAYBOOK.md`. Do not run
`prisma migrate reset` against staging or prod; that drops every
table.
