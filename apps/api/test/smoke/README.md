# Smoke tests

Lightweight end-to-end checks for the API's main paths. Runs in <30 s
and exits non-zero on any regression.

## Run

```bash
pnpm smoke                  # from repo root
```

Requires the API + DB + Redis to be up. `pnpm dev` in another terminal,
or just `pnpm --filter @sportsmart/api dev`.

## What's covered (v1)

| Check                          | Validates                                |
|--------------------------------|------------------------------------------|
| `GET /health/live`             | API process is alive and answering       |
| `GET /health`                  | DB + Redis reachability via the API      |
| `POST /admin/auth/login`       | Seed admin exists, password hash matches |
| `GET /admin/auth/me`           | JWT issuance + AdminAuthGuard            |
| `GET /admin/sellers`           | DB → seller module → controller          |
| `GET /admin/orders`            | DB → orders module → controller          |
| `GET /admin/products`          | DB → catalog → admin-products controller |

## What's scaffolded but skipped (v2)

These will turn on once a `seed-smoke-actors.ts` lands. It needs to
create one of each non-admin actor (customer, seller, franchise,
affiliate) with deterministic credentials, plus the minimum fixtures
for order placement: a serviceable pincode, a seller product mapping
with stock, a COD-eligible rule.

- Customer / seller / franchise / affiliate logins
- Cart → checkout → place online order
- Cart → checkout → place COD order
- Notification log entry written after order placement

## Configuration

| Env var                   | Default                          |
|---------------------------|----------------------------------|
| `SMOKE_API_BASE`          | `http://localhost:8000/api/v1`   |
| `SMOKE_ADMIN_EMAIL`       | falls back to `ADMIN_SEED_EMAIL` (default `admin@sportsmart.com`) |
| `SMOKE_ADMIN_PASSWORD`    | falls back to `ADMIN_SEED_PASSWORD` |
| `SMOKE_REQUEST_TIMEOUT_MS`| `5000`                           |

## Why these, not unit tests / e2e?

- **Unit tests** verify a function does what it claims in isolation —
  silent on integration drift.
- **Full E2E with Playwright** is slow, flaky in CI, and requires a
  browser. Overkill for a 30-second sanity check before you `pnpm dev`.
- **Smoke** sits in between: real HTTP, real DB, real Prisma, but only
  the paths the next sprint actually depends on. Fast, reliable, exits
  non-zero on regressions.

## Track record

- 2026-05-13: caught **admin login completely broken** in two ways:
  1. `admins` table missing 5 MFA columns the schema declared
     → fixed in `20260513100000_add_admin_mfa_columns`
  2. `admin_sessions` table missing `step_up_verified_at`
     → fixed in `20260513110000_add_admin_session_step_up`

  Both would have shipped to staging unnoticed without this smoke
  suite (the typecheck pass from Story 0.1 only checked types, not
  DB column existence).
