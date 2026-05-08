# Phase 7 — Evidence integrity, retention, and erasure runbook

**Owner**: Platform / Compliance / SRE
**ADR**: [012 — Evidence integrity, retention, and data erasure](../decisions/012-evidence-retention-erasure.md)
**Status**: Ready to soak

This runbook walks through enabling four independent surfaces:

1. File hashing (PR 7.1) — already runs on every direct upload as
   soon as the migration is applied. No flag.
2. Integrity verifier cron (PR 7.5) — `INTEGRITY_VERIFIER_ENABLED`.
3. Retention enforcer cron (PR 7.2) — `RETENTION_ENFORCER_ENABLED` +
   `RETENTION_ENFORCER_DRY_RUN`.
4. Erasure processor cron (PR 7.4) — `ERASURE_PROCESSOR_ENABLED`.

URL audit + TTL caps (PR 7.3) are unconditional once the migration
applies. They're wired into the existing `FileService.getSecureUrl`
read path during the integrations sub-PR.

## Pre-flight

### 1. Migrations

```bash
pnpm --filter @apps/api exec prisma migrate deploy
```

Required tables:
* `file_metadata` columns `content_sha256`, `hash_algorithm`,
  `hashed_at`, `last_verified_at` (PR 7.1)
* `retention_policies`, `retention_executions` (PR 7.2)
* `file_url_audits` (PR 7.3)
* `data_erasure_requests` (PR 7.4)

Verify column presence:

```sql
\d file_metadata
\d retention_policies
\d data_erasure_requests
```

### 2. Verify hashing on direct uploads

After deploy, post a multipart file to `/files/upload` and check:

```sql
SELECT id, content_sha256, hashed_at, last_verified_at
FROM file_metadata
WHERE created_at > NOW() - INTERVAL '5 minutes'
  AND status = 'READY';
```

Every row should have a 64-character hex `content_sha256` and matching
`hashed_at` ≈ `created_at`. If `content_sha256` is NULL, either the
upload went through the S3-confirm path (deferred hash, expected) or
the migration didn't apply.

### 3. Audit-query helpers

Save these as Grafana panels or Metabase questions before flipping
any cron flag:

```sql
-- Files with no hash yet (the verifier's backfill queue)
SELECT COUNT(*) FROM file_metadata
WHERE status = 'READY' AND deleted_at IS NULL AND hashed_at IS NULL;

-- Files due for re-verification
SELECT COUNT(*) FROM file_metadata
WHERE status = 'READY' AND deleted_at IS NULL
  AND last_verified_at < NOW() - INTERVAL '30 days';

-- Daily URL-audit denies (rate-limit hits)
SELECT date_trunc('hour', created_at) AS hour, COUNT(*) AS denies
FROM file_url_audits
WHERE denied = true
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY 1 ORDER BY 1 DESC;

-- Pending erasure backlog by age
SELECT
  date_trunc('day', created_at) AS day,
  COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
  COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
  COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected
FROM data_erasure_requests
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY 1 ORDER BY 1 DESC;
```

## Flip 1 — `INTEGRITY_VERIFIER_ENABLED=true`

Pure observability. The verifier doesn't mutate anything except the
`hashed_at` / `last_verified_at` timestamps and emits two events on
boundary cases:

* `file.integrity.backfill_pending` — the cron found a READY file
  with no hash yet AND can't fetch it (the storage-adapter download
  isn't wired in v1; ADR-012 §"Inline-hash backfill" describes the
  follow-up).
* `file.integrity.violation` — re-hash returned a different value
  than the stored one. **High-priority alert.**

### Soak

```bash
kubectl -n staging set env deploy/api INTEGRITY_VERIFIER_ENABLED=true
```

Watch logs for the `integrity verifier: backfilled=X reverified=Y violations=Z`
summary line every hour. Violations should be 0 in normal operation;
any non-zero count means a file in storage diverges from what we
hashed at upload.

### Rollback

```bash
kubectl -n staging set env deploy/api INTEGRITY_VERIFIER_ENABLED=false
```

## Flip 2 — `RETENTION_ENFORCER_ENABLED=true` (DRY_RUN first)

### Seed the policy table

There's no shipped seed for retention policies — every team's needs
differ. Insert your policies directly:

```sql
INSERT INTO retention_policies
  (id, resource_type, purpose, retain_days, action, enabled, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'file', 'KYC_DOCUMENT',     365 * 7, 'ARCHIVE', true,
   'KYC docs: 7 years for tax + financial regulator audit.', NOW(), NOW()),
  (gen_random_uuid(), 'file', 'INVOICE',          365 * 7, 'ARCHIVE', true,
   'Invoices: 7 years for tax.', NOW(), NOW()),
  (gen_random_uuid(), 'file', 'QC_EVIDENCE',      365,     'DELETE',  true,
   'QC photos: 1 year after inspection (covers appeals window).', NOW(), NOW()),
  (gen_random_uuid(), 'file', 'DISPUTE_EVIDENCE', 365 * 2, 'ARCHIVE', true,
   'Dispute evidence: 2 years for legal defensibility.', NOW(), NOW()),
  (gen_random_uuid(), 'file', '*',                90,      'DELETE',  true,
   'Catch-all for files without a more specific policy.', NOW(), NOW());
```

### Soak in DRY-RUN

```bash
kubectl -n staging set env deploy/api \
  RETENTION_ENFORCER_ENABLED=true \
  RETENTION_ENFORCER_DRY_RUN=true
```

The cron runs at 03:00 daily. After the first run, inspect the
execution audit:

```sql
SELECT policy_id, action, COUNT(*) AS would_act
FROM retention_executions
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND legal_hold = false
  AND deny_reason ILIKE '%DRY-RUN%'
GROUP BY 1, 2
ORDER BY would_act DESC;
```

Cross-check against the legal-hold rejections:

```sql
SELECT policy_id, COUNT(*) AS held, COUNT(DISTINCT legal_hold_reason) AS distinct_reasons
FROM retention_executions
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND legal_hold = true
GROUP BY 1;
```

If the legal-hold reason coverage looks too narrow (e.g. nothing for
"open dispute" when you know there are dispute-evidence files), the
`LegalHoldService.checkAttachment` switch needs another resource type.
Open a ticket; do NOT proceed to wet-run.

### Wet-run

```bash
kubectl -n production set env deploy/api \
  RETENTION_ENFORCER_DRY_RUN=false
```

The next run actually deletes / archives. The execution audit table
is the source of truth for "what we did":

```sql
SELECT executed_at, resource_id, action
FROM retention_executions
WHERE legal_hold = false
  AND executed_at > NOW() - INTERVAL '24 hours'
ORDER BY executed_at DESC
LIMIT 100;
```

### Rollback

```bash
kubectl -n production set env deploy/api \
  RETENTION_ENFORCER_ENABLED=false
```

The cron stops. Already-deleted rows stay deleted (soft-delete is
recoverable by clearing `deleted_at`; archived rows similar; redacted
rows are NOT recoverable since the PII is gone).

## Flip 3 — `ERASURE_PROCESSOR_ENABLED=true`

### Pre-conditions

* Compliance signs off on the outcome JSON shape: confirm the
  `redacted` + `blocked` keys cover what regulators ask for.
* Confirm the 24h `notBefore` cooldown is acceptable. The runbook
  query for "requests pending past their cooldown" should always
  return reasonable counts:

```sql
SELECT COUNT(*) FROM data_erasure_requests
WHERE status = 'PENDING' AND not_before < NOW();
```

If this number grows unbounded, the processor isn't running or the
batch limit is too small.

### Soak

The processor is hourly. After enabling, file a test request via the
admin UI / API and watch:

```sql
SELECT id, status, source, requested_by_actor_type, processing_started_at,
       completed_at, outcome
FROM data_erasure_requests
ORDER BY created_at DESC
LIMIT 5;
```

Expected for a clean USER request (no open disputes):

```
status: COMPLETED
outcome: { "redacted": ["users.first_name", "users.last_name", "users.email", "users.phone_number"], "blocked": [] }
```

Expected for a USER with an open dispute:

```
status: REJECTED
outcome: { "redacted": [], "blocked": [{"table": "disputes", "reason": "Open dispute D-2026-..."}] }
```

### Rollback

```bash
kubectl -n production set env deploy/api ERASURE_PROCESSOR_ENABLED=false
```

In-flight requests stop processing. Existing PENDING / IN_PROGRESS
rows stay where they are; flipping back to enabled resumes them.

## Common gotchas

* **Hash mismatch alerts firing constantly on the same file.** The
  cron deliberately doesn't update `last_verified_at` on a violation,
  so the file gets re-checked on every run. After ops resolves
  (either the file is OK and we re-stamp the stored hash, or the
  file is corrupt and we restore from backup), update
  `last_verified_at` manually to silence the alert. The runbook for
  the alert itself documents this.
* **Retention enforcer "did nothing".** Check that `RETENTION_ENFORCER_DRY_RUN`
  is false and that there's no legal-hold blocker. Run the
  `legal_hold = true` rollup; if every candidate is held, that's the
  expected behaviour — no PII to delete.
* **An admin-action erasure request still respects the 24h cooldown.**
  Wrong: only USER_REQUEST source has the cooldown. ADMIN_ACTION /
  REGULATOR_NOTICE skip it. If admin requests are stuck PENDING,
  check `source` was set correctly in the create call.
* **URL rate limit hitting legitimate users.** The default is 30
  issuances per (file, requester) per 10min — a UI that re-mints the
  URL on every render WILL hit this. The fix is a short-term cache on
  the client side, not raising the limit. Tracking this in an issue.
