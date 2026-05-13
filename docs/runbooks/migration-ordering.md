# Runbook — Migration Deploy Ordering

Owner: platform-security team. Phases 1 / 2 / 7 / 10.

## What it is

The safe deploy ordering for a schema-changing release is:

```
1.  prisma migrate deploy        # apply schema in prod DB
2.  prisma generate              # regenerate the typed client (CI build step)
3.  deploy the API image         # code now references the new columns
4.  run any data backfill        # populate new columns from existing rows
5.  flip the read-path flag      # services start reading the new columns
6.  monitor for the soak window  # 2 weeks for ADR-007-class changes
7.  drop the legacy columns      # only after the soak with no incidents
```

Skipping any step OR doing them out of order silently corrupts data or produces 500s that are hard to roll back. The four common failure modes (each with a section below) are: code-before-schema, flag-before-schema, read-switch-before-backfill, and schema-rollback-after-code-adopted.

Every Phase 1 / 2 / 7 / 10 PR followed this pattern; the load-bearing instances are catalogued in the **Specific migrations** section.

## Symptoms & responses

### Code deployed before schema (`column does not exist`)

Symptom: API logs flood with `PostgresError: column "X" of relation "Y" does not exist` on every request that exercises the new code path. The 500-rate alert fires.

Cause: the API image references a column that the prod DB doesn't yet have. Either the migration step was skipped, or the image was redeployed without re-running `prisma migrate deploy`.

**Response**:

1. Roll back the API image to the previous build (the version that doesn't reference the column). 500-rate stops within seconds.
2. Apply the migration: `pnpm --filter @sportsmart/api prisma migrate deploy`. Verify in psql that the column exists: `\d <table>`.
3. Redeploy the current image. 500s should not return.

If rolling back the image isn't an option (e.g. the previous build has its own incident), the alternative is to apply the migration immediately. This is faster but risks an in-flight write hitting a partially-applied schema — only do it if the alert is acute and the migration is purely additive.

### Flag flipped before schema deployed

Symptom: same `column does not exist` errors as above, but only for traffic that exercises the new code path gated by the flag. Most requests succeed.

Cause: a feature flag was flipped to `true` while the migration was still pending, activating code that reads / writes the new column.

**Response**:

1. Flip the flag back to `false` immediately (faster than redeploying the image).
2. Apply the migration.
3. Re-flip the flag once the column exists.

Validator-detected pre-emptions: the env-validator interlocks (`OUTBOX_AUTHORITATIVE` requires `OUTBOX_ENABLED` + `OUTBOX_DUAL_WRITE`) catch some of these classes. They do NOT catch every column-flag dependency — only the explicit interlock pairs.

### Read-switch before backfill complete

Symptom: services start returning zero / NULL / wrong values for fields the user knows are populated. No 500s — silent corruption.

Cause: the read-path flag (e.g. `MONEY_DUAL_WRITE_ENABLED` followed by the read-switch in PR 1.4b) was flipped before the legacy-row backfill completed. Old rows have the legacy column populated and the new column NULL; the read path returns the NULL.

**Response**:

1. Flip the read-switch flag back. Reads return to the legacy column.
2. Run the backfill query for the affected rows. The pattern (paise siblings example):
   ```sql
   UPDATE returns
      SET refund_amount_in_paise = ROUND(refund_amount * 100)::BIGINT
    WHERE refund_amount IS NOT NULL
      AND refund_amount_in_paise IS NULL;
   ```
3. Run the per-table parity query from `money-paise-migration.md`. Zero drift before re-flipping the switch.

Critical: the read-switch flag is one-way without a re-soak. If you've flipped it on, soaked, then flipped it off due to an incident, treat the next flip-on as a fresh rollout with a fresh 2-week soak.

### Schema rollback after code adopted

Symptom: dropping a column that the running code references produces the same `column does not exist` as code-before-schema, but the cause is reversed.

Cause: someone ran a "down" migration (or manually dropped the column) before the running code stopped referencing it.

**Response**: do not drop columns from code that still reads them. The "drop legacy columns" step (step 7 above) only runs after the running image references only the new columns. If a drop is genuinely needed mid-flight:

1. Deploy a code change that stops reading the legacy column.
2. Soak that build for a release cycle.
3. Then drop the column.

If the drop already happened: restore from backup OR re-add the column as nullable with no default. The historical data is lost; the schema can be re-added so the code stops 500ing.

## Specific migrations

### Phase 1 — Outbox (`outbox_events`, `outbox_dead_letters`, `event_deduplication`)

Migration: `20260505130000_add_outbox`.

Three-step flag cutover after the schema lands:

1. `OUTBOX_ENABLED=true` — publisher cron starts draining the table (no-op until rows exist).
2. `OUTBOX_DUAL_WRITE=true` — writers create outbox rows in the same transaction as the aggregate mutation. The direct-emit path still runs (events go out twice; consumers are deduped via `event_deduplication`).
3. `OUTBOX_AUTHORITATIVE=true` — publisher becomes the sole emitter; direct emit short-circuits.

Required order: schema deploy → ENABLED → DUAL_WRITE → 2-week soak → AUTHORITATIVE. The env-validator enforces the AUTHORITATIVE-requires-ENABLED-and-DUAL_WRITE interlock; the soak duration is a policy, not enforced by code. See `transactional-outbox.md` for the full procedure.

### Phase 1 — Idempotency (`idempotency_keys`)

Migration: `20260505100000_add_idempotency_keys`.

Single-flag cutover: `IDEMPOTENCY_ENABLED=true` after the schema lands. The middleware short-circuits when off. No backfill needed (the table is write-only; it has no legacy data to migrate).

The sweeper cron runs regardless of the flag in Phase 6+ but it's a no-op on an empty table.

### Phase 7 — Paise migration (`*_in_paise` columns)

Migrations: spanning `20260512130000_wallet_int_to_bigint` and surrounding (12 total touching `_in_paise`). PR 1.4 added the columns + backfill, PRs 7.1–7.8 wired the dual-write helper across the call-sites.

Full four-stage cutover:

1. **Schema deploy + backfill** — adds the `*_in_paise BIGINT` columns next to every Decimal money column; the same migration backfills `ROUND(value * 100)` into the paise column. After deploy, run the per-table parity query from `money-paise-migration.md`; expect zero drift.

2. **Dual-write soak** — `MONEY_DUAL_WRITE_ENABLED=true`. Every write goes through `MoneyDualWriteHelper.applyPaise(...)` which populates both columns in the same transaction. Soak for 2 weeks; rerun parity weekly.

3. **Read-switch** — flip the per-service read flag to read from `*_in_paise` instead of the Decimal column. This is the most dangerous step: a row whose paise column is NULL (i.e. wasn't dual-written and wasn't backfilled) silently returns 0 paise. Pre-flight: per-table parity query must show zero drift AND zero NULL paise columns for non-NULL Decimal columns.

4. **Drop legacy** — drop the Decimal columns. Only after read-switch has soaked for 2 weeks with no parity-query alerts AND no reports of zero-amount surprises.

If step 3 reveals NULL paise on a row with non-NULL Decimal, the backfill missed it. Re-run the backfill query for that table; do NOT proceed with the read-switch until parity is clean.

### Phase 10 — Admin MFA (`admins.mfa_*` columns)

Migration: not yet materialized in `prisma/schema/migrations/`. The columns are declared in `prisma/schema/admin.prisma` but operators must generate the migration with `pnpm --filter @sportsmart/api prisma migrate dev --name add_admin_mfa` in a non-prod environment, then apply with `prisma migrate deploy` in prod.

Required order: migration applied → `prisma generate` (the generated client picks up the new columns; without this the API build will fail the type-check on `mfa_secret_ciphertext` references) → API deploy → admin enrollment via `/admin/mfa/enroll/begin`.

The PR 10.10 type-cast caveats (`as any` on `mfa_*` Prisma calls) exist precisely because the migration hasn't been generated yet — once it is, the casts can be removed. See `admin-mfa.md` for the enrollment procedure.

### Phase 10 — Step-up auth (`admin_sessions.step_up_verified_at`)

Same status as the MFA columns: declared in the prisma schema, awaiting `prisma migrate dev` to materialize. The `StepUpGuard` reads this column on every request to a `@RequiresStepUp()` route; deploying the guard before the column exists results in `column does not exist` errors on every guarded route.

Required order: migration applied → `prisma generate` → API deploy with the guard → progressively apply `@RequiresStepUp()` to routes.

## Operating envelope

| Practice | Default | Required |
|---|---|---|
| Schema migration step | not skipped | always run `prisma migrate deploy` before API deploy on every release that touches `prisma/schema/` |
| Generated-client regeneration | CI build step | `prisma generate` runs in CI; if generation is skipped, type-check fails on new columns |
| Backfill verification | per-table parity query | the new column population must reach parity before the read-flag flips |
| Soak duration | ADR-driven | 2 weeks for ADR-007 / ADR-008 class changes; shorter for additive-only schema |
| Down-migrations | discouraged | the codebase favors additive schema; "down" SQL exists for emergency restore only |
| Column drops | step 7 only | only after the running image has stopped referencing the legacy column for a full release cycle |
| Dual-mode flags | favored | every cutover uses a flag-gated mode (dual-write, read-switch) rather than a hard cutover |

## Rollback

The rollback path depends on which step you've reached:

| Failed at | Rollback |
|---|---|
| Step 1 (schema deploy) | If migration is purely additive and only partially applied: complete the migration. If it added a column that broke replication: revert the migration; restore from backup if data is dirty. |
| Step 2 (client regenerate) | No rollback needed — the generated client is a build artifact. Rebuild from the previous prisma schema. |
| Step 3 (code deploy) | Roll back the image. The schema can stay (additive). |
| Step 4 (backfill) | Re-run the backfill. Idempotent because the query is `UPDATE ... WHERE new_column IS NULL`. |
| Step 5 (read-switch flag) | Flip the flag back. The legacy column is still being dual-written, so reads return correct values. |
| Step 6 (soak) | Operational issue, not a rollback target — keep the flag on and resolve the underlying issue. |
| Step 7 (drop legacy) | Add the column back. Backfill from the new column via the inverse query. Historical data outside the dual-write window is lost. |

If you find yourself running a "down" migration in prod, stop and page platform-security. The codebase intentionally doesn't ship reversible down-migrations for additive schema (they're a foot-gun: a partial down can leave the DB in a state no committed migration describes).

## Test in pre-prod

```bash
# 1. Apply migrations to staging. Capture the migration list.
pnpm --filter @sportsmart/api prisma migrate deploy
psql $STAGING_DATABASE_URL -c "\dt"

# 2. Regenerate the client. Required after every prisma/schema/ change.
pnpm --filter @sportsmart/api prisma generate

# 3. Confirm the API can build with the new schema.
pnpm --filter @sportsmart/api typecheck

# 4. For paise-class migrations: backfill + parity query.
pnpm --filter @sportsmart/api prisma db execute --file scripts/backfill-paise.sql
psql -c "
  SELECT count(*) FILTER (
    WHERE refund_amount IS NOT NULL
      AND refund_amount_in_paise IS NULL
  ) AS unbackfilled FROM returns;
"
# Expect: 0.

# 5. For outbox-class migrations: deploy ENABLED + DUAL_WRITE, watch
#    the table.
psql -c "SELECT state, count(*) FROM outbox_events GROUP BY state;"
# Expect: PENDING → PUBLISHED within a few seconds.

# 6. For MFA-class migrations: confirm columns exist before deploying
#    the API.
psql -c "\d admins" | grep mfa_
psql -c "\d admin_sessions" | grep step_up_

# 7. Out-of-order simulation (DO NOT run in prod): deploy the image
#    BEFORE running `prisma migrate deploy` in a fresh staging DB
#    that has no admin_sessions.step_up_verified_at column. Trigger
#    a @RequiresStepUp route. Expect: 500 with "column does not exist".
#    This is the failure mode the runbook protects against.
```

A successful staging migration → backfill → flag-flip → soak → smoke-test sequence is the gate for promoting the same change to prod. Repeating the sequence in prod must follow the same step order.
