# Migration rollback playbook

**Audience:** on-call engineer + database operator working together.
**Scope:** the steps to recover from a Prisma migration that landed
in staging/prod and turned out to be broken.

**Last updated:** 2026-05-16 (Phase 9). Owners: platform team.

---

## When to use this

A migration is "bad" when any of the following is true after it
applies in staging or production:

1. Boot fails: API can't start because the new schema disagrees with
   the running Prisma client (column was renamed and the client
   wasn't redeployed in lock-step).
2. Runtime errors: queries throw `P2022` (column not found),
   `P2003` (FK violation), or `P2025` (record not found) at a rate
   not seen in staging.
3. Data corruption: a column was added with the wrong default, or a
   data migration's UPDATE clause overwrote the wrong rows.
4. Performance regression: an index was dropped that a hot query
   depended on, and p99 latency spiked.

Cases 1 and 2 usually surface within minutes of the deploy. Case 3
may take hours. Case 4 typically shows up in dashboards 5–30 min in.

---

## Core principle: Prisma migrations are forward-only

Prisma's `migrate` workflow does **not** generate a `down.sql` file.
A "rollback" is always one of three things:

* **Forward-fix:** write a new migration that undoes the bad change.
* **Code revert:** redeploy the previous API image, leaving the
  schema as-is. Only works if the new schema is a strict superset of
  the old one (e.g. you added a nullable column).
* **Restore from backup:** point-in-time-restore the database to
  before the migration. Drops all writes that happened between PITR
  point and now. Last resort.

Choose the lightest option that closes the incident.

---

## Step 0 — Triage (first 5 minutes)

```sh
# Identify the offending migration. Latest applied row first.
pnpm --filter @sportsmart/api exec prisma migrate status
```

Capture:

* migration name (e.g. `20260516010000_product_variant_sku_unique`)
* timestamp it applied in prod
* the symptom (boot failure / query error / data shape / latency)

Open an incident channel. Page the database operator. Pause the
deploy workflow:

```sh
# Disable the deploy workflow so nobody else ships on top.
gh workflow disable Deploy --repo <org>/sportsmart-marketplace
```

---

## Step 1 — Decide the rollback class

### A. Forward-fix migration (most common)

Use when:

* The bad migration **added** something (column, table, index, FK).
* The new column/table is empty or contains only test data that can
  be regenerated.

Procedure:

1. Author a new migration that drops what the bad one created, **or**
   alters it back to the previous shape.
2. Generate the migration file manually under
   `apps/api/prisma/schema/migrations/<ts>_rollback_<bad-name>/`.
3. Apply with `prisma migrate deploy` — this records the rollback as
   a forward migration in `_prisma_migrations`. The bad migration
   row STAYS in that table; the new row is the corrective action.
4. Redeploy the API image that matches the post-rollback schema.

Example: the bad migration added `seller_product_mappings.foo`
column. The rollback migration is:

```sql
-- 20260517090000_rollback_add_seller_product_mapping_foo/migration.sql
ALTER TABLE "seller_product_mappings" DROP COLUMN "foo";
```

### B. Code revert (no schema change)

Use when:

* The new schema is **backward compatible** with the previous API
  image (added nullable column, added optional table, added index).
* The runtime error is in the API code, not in the schema itself.

Procedure:

1. Redeploy the previous API image tag via the deploy workflow:
   `deploy.yml` → target=production, services=api, image_tag=<prev>.
2. Leave the schema in place. Open a forward-fix PR at leisure.

### C. Point-in-time restore (PITR)

Use **only** when A and B are not viable — i.e. the migration mutated
or destroyed live data and the corruption is spreading.

Procedure (RDS Postgres):

1. Identify the PITR target time **just before** the bad migration
   applied. Add a 30s buffer.
2. Create a new RDS instance from PITR:
   ```sh
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier sportsmart-prod \
     --target-db-instance-identifier sportsmart-prod-restore-<ts> \
     --restore-time <iso8601>
   ```
3. **Do NOT swap DNS yet.** Connect to the restore as read-only and
   diff a few critical tables to confirm the data shape matches the
   pre-incident state.
4. Stop the running API to freeze writes:
   ```sh
   kubectl -n production scale deployment/sportsmart-api --replicas=0
   ```
5. Swap RDS endpoints (rename trick): rename the live instance to
   `<name>-corrupted-<ts>` and rename the restore to `<name>`. This
   keeps the original around for forensics.
6. Scale the API back up. Verify health endpoint, then deploy traffic.
7. Lost writes since PITR are written up as a separate incident.

**Pre-condition:** RDS PITR retention must cover the gap. Check now:
```sh
aws rds describe-db-instances --db-instance-identifier sportsmart-prod \
  --query 'DBInstances[0].BackupRetentionPeriod'
```
Anything under 7 days is a separate ticket — fix the retention before
the next incident.

---

## Step 2 — Verify

After A, B, or C completes:

```sh
# Schema state matches expectations
pnpm --filter @sportsmart/api exec prisma migrate status

# API boots
kubectl -n production rollout status deployment/sportsmart-api

# Smoke test the affected flow
pnpm smoke -- --target=production --suite=<area>
```

Document in the incident channel:

* Which class of rollback you used (A / B / C).
* Why.
* The forward-fix migration ID or the API image tag you reverted to.
* Any data loss window (only relevant for C).

---

## Step 3 — Post-mortem checklist

Open a follow-up ticket within 24h with:

* [ ] Why staging didn't catch this.
* [ ] Did the migration include a data-migration step? If yes, what
      sample data was missing from staging?
* [ ] Add a regression smoke test exercising the broken flow.
* [ ] Update `docs/MIGRATION_REVIEW_CHECKLIST.md` if the issue maps
      to a new rule (e.g. "always provide a default before adding
      NOT NULL").

---

## Reference — Prisma commands cheat sheet

| Goal | Command |
|------|---------|
| List applied migrations | `prisma migrate status` |
| Apply pending migrations | `prisma migrate deploy` |
| Mark a migration as applied (record only) | `prisma migrate resolve --applied <name>` |
| Mark a failed migration as rolled back (record only) | `prisma migrate resolve --rolled-back <name>` |
| Open shell with current schema | `prisma db pull` then inspect |

`migrate resolve` only touches the `_prisma_migrations` table — it
does NOT undo DDL. Use it after a manual SQL rollback so Prisma's
view of the world matches reality.

---

## Anti-patterns

* `prisma migrate reset` — drops every table in the database. NEVER
  run against staging or prod.
* Editing a migration file in-place after it has applied anywhere.
  This produces a checksum mismatch the next time anyone runs
  `migrate status` against that environment.
* Renaming a migration directory. The directory name IS the migration
  identifier; rename = "migration disappeared" + "new unknown
  migration appeared", which breaks the lock.
