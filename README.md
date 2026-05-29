# Sportsmart Marketplace

A multi-seller sports marketplace for India. Turborepo monorepo with a NestJS
backend, 10 Next.js frontends (storefront + admin + seller/franchise/affiliate
portals), a React Native customer app (iOS + Android), and a 47-file modular
Prisma schema. See [`docs/SYSTEM_DESIGN.md`](./docs/SYSTEM_DESIGN.md) for the
full architecture.

---

## Quickstart

```bash
pnpm setup       # validates prereqs, copies .env files, installs, generates Prisma client
pnpm db:setup    # prisma migrate deploy + seed (admin, RBAC, catalog, menu)
pnpm dev         # starts all 9 services (1 API + 8 frontends)
```

Three commands, fresh clone to running stack. Re-run `pnpm setup` at any time —
it's idempotent (won't overwrite `.env` files you've edited).

---

## Prerequisites

| Tool       | Version  | Install |
|------------|----------|---------|
| Node       | ≥22.0.0  | `nvm install 22 && nvm use 22` |
| pnpm       | ≥10.0.0  | `corepack enable && corepack prepare pnpm@10.0.0 --activate` |
| Postgres   | ≥16      | `brew install postgresql@16 && brew services start postgresql@16` <br/>or `docker compose -f infra/docker/docker-compose.yml up -d postgres` |
| Redis      | ≥7       | `brew install redis && brew services start redis` <br/>or `docker compose -f infra/docker/docker-compose.yml up -d redis` |

`pnpm setup` checks all of these and tells you what's missing.

---

## Database setup

After `pnpm setup` and before `pnpm dev`:

```bash
createdb sportsmart_dev          # one-time
pnpm db:setup                    # migrate + seed (idempotent)
```

Customise `DATABASE_URL` in `apps/api/.env` if your Postgres user/password differ
from the defaults. The seed scripts are idempotent (upsert-only); rerunning is
safe.

To wipe the DB and start over:

```bash
pnpm db:reset                    # WARNING: drops sportsmart_dev and re-seeds.
                                 # Guarded by guard-not-prod.ts (refuses if NODE_ENV=production).
```

---

## Running services

`pnpm dev` runs `turbo run dev` which fans out to every workspace package. All 9
services come up in parallel:

| Service                | Port | Purpose                                  |
|------------------------|-----:|------------------------------------------|
| `@sportsmart/api`      | 8000 | NestJS backend (Prisma + Redis + BullMQ) |
| `web-admin-storefront` | 4000 | Storefront ops admin (orders/customers/disputes/payments) |
| `web-admin`            | 4001 | Platform admin (sellers/products/franchises/commissions) |
| `web-franchise-admin`  | 4002 | Franchise network oversight              |
| `web-seller`           | 4003 | Seller dashboard                         |
| `web-franchise`        | 4004 | Franchise location dashboard (POS, staff, inventory) |
| `web-storefront`       | 4005 | Customer-facing storefront               |
| `web-affiliate-admin`  | 4006 | Affiliate program admin                  |
| `web-affiliate`        | 4007 | Affiliate member portal                  |

The React Native mobile app (`apps/mobile-storefront`) is run separately
because Metro owns port 8081 alone and Xcode / Android Studio aren't on
every dev machine. See
[`apps/mobile-storefront/README.md`](./apps/mobile-storefront/README.md)
for the iOS + Android bring-up.

---

## Common commands

```bash
pnpm dev                  # all 9 services
pnpm build                # production build for every package
pnpm typecheck            # type-check the API (fast; no emit)
pnpm smoke                # end-to-end smoke tests against the running API (~10s)
pnpm lint                 # turbo-fan-out lint
pnpm db:status            # `prisma migrate status` — what's applied, what's pending
pnpm db:setup             # apply pending migrations + seed
pnpm db:reset             # drop + recreate + seed (dev only)

# Filter to one app:
pnpm --filter @sportsmart/api dev
pnpm --filter @sportsmart/web-storefront build
```

---

## Where to read more

| Doc | Purpose |
|---|---|
| [`docs/SYSTEM_DESIGN.md`](./docs/SYSTEM_DESIGN.md) | 23-section architecture reference |
| [`docs/plans/MASTER_PLAN.md`](./docs/plans/MASTER_PLAN.md) | 9-phase roadmap (what we build, in what order, why) |
| [`docs/plans/SPRINT_PLAN.md`](./docs/plans/SPRINT_PLAN.md) | 27-sprint schedule (Sprint 1 = Phase 0 foundation) |
| [`docs/plans/STATUS_TRACKER.md`](./docs/plans/STATUS_TRACKER.md) | Per-feature completion status |
| [`docs/architecture/`](./docs/architecture/) | Module boundaries, event catalog, dependency matrix |
| [`docs/decisions/`](./docs/decisions/) | 20 ADRs — modular monolith, idempotency, money/paise, ABAC, outbox, etc. |
| [`docs/runbooks/`](./docs/runbooks/) | 14 operational runbooks (phased cutovers + MFA + incident response) |
| [`docs/flows/commerce-lifecycle.md`](./docs/flows/commerce-lifecycle.md) | 8 end-to-end commerce flows (cart → settlement) |
| [`apps/mobile-storefront/README.md`](./apps/mobile-storefront/README.md) | React Native customer app — bring-up, env, deep links, native config |

---

## Troubleshooting

**`pnpm setup` warns Postgres / Redis unreachable.**
Start them: `brew services start postgresql@16` and `brew services start redis`,
or use the docker-compose under `infra/docker/`.

**`pnpm db:setup` fails with "database does not exist".**
Run `createdb sportsmart_dev` first (or whatever DB name your `DATABASE_URL` points to).

**`pnpm dev` fails with port conflicts.**
Find the process: `lsof -ti :8000 | xargs ps -p`. Kill stale processes:
`lsof -ti :8000 | xargs kill`. The script in `apps/api/.env` binds `PORT=8000`;
do not change it without updating every frontend's `NEXT_PUBLIC_API_URL`.

**API logs 15+ TS errors but still runs.**
Was fixed in Sprint 1 / Story 0.1 (verification-queue schema drift). If you see
new ones, `pnpm typecheck` will print them all at once.

**`prisma migrate status` shows drift on `_add_rbac` migration.**
Cosmetic — the migration directory was renamed (`add_rbac` → `add_admin_rbac`)
after being applied. `prisma migrate deploy` proceeds past it. Harmless.

**The verification queue feature shows missing columns.**
Was fixed in Sprint 1 / Story 0.1 — declarations re-added to `prisma/schema/orders.prisma`.

---

## Status

Sprint 1 (Foundation) is in progress. See
[`docs/plans/SPRINT_PLAN.md`](./docs/plans/SPRINT_PLAN.md) for the current sprint
and [`docs/plans/STATUS_TRACKER.md`](./docs/plans/STATUS_TRACKER.md) for feature
completion.

MVP target: end of Sprint 27 — 2027-05-28.
