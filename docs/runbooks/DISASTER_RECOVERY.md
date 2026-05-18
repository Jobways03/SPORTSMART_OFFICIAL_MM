# Disaster Recovery — runbook

**Audience:** on-call engineer + platform operator.
**Scope:** what to do when SportSmart loses a stateful component
(Postgres, Redis, Cloudinary) or an entire region.

**Last updated:** 2026-05-16 (Phase 14). Owners: platform team.

---

## Service Level Objectives

| Objective | Target | Rationale |
|-----------|--------|-----------|
| **RPO** (max data loss) | **1 hour** | Postgres PITR + Redis AOF combine to <60s in normal operation; the 1h SLO leaves headroom for a region-wide outage where the replica lags. |
| **RTO** (max downtime) | **30 minutes** | The blue/green deploy primitive + RDS read-replica promote take ~10min combined; the remaining budget covers DNS, smoke tests, and ops triage. |
| **MTTD** (mean time to detect) | **5 minutes** | OpsAlertHandler fires on `accounts.imbalance_detected`, `http.error_rate.elevated`, `cron.silent`; pager covers under-5-min response in business hours. |

Define stricter targets per data class (payments, PII) only when the
business demands it — over-tightening here means more deploy ceremony
without reducing customer harm. The numbers above are the **floor**.

---

## §1 Postgres — Backup + Point-in-Time Restore (PITR)

### Configuration (RDS)

RDS Postgres MUST be configured with:

```
BackupRetentionPeriod = 14 days
PreferredBackupWindow = 18:00-19:00 UTC   # 23:30-00:30 IST, low-traffic
DeletionProtection    = true
StorageEncrypted      = true (KMS-managed, alias/sportsmart-rds)
MultiAZ               = true              # synchronous standby for failover
EnableIAMDatabaseAuthentication = true    # role-based DB access
```

Terraform: `infra/aws/terraform/rds/` (skeleton landed in Phase 9).
Fill in the module body before the first prod apply.

### What PITR gives us

* **Automated backups** every 5 minutes (RDS-managed WAL shipping).
* **Restore to any second** in the retention window (14 days).
* **Read-replica failover** within the same AZ in ~60s; cross-AZ
  ~5min via the MultiAZ standby.

### Restore procedure

```bash
# 1. Identify the target instant (UTC) — typically "just before the
#    bad migration / accidental delete".
TARGET="2026-05-16T14:30:00Z"

# 2. Restore to a NEW instance — never overwrite live.
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier sportsmart-prod \
  --target-db-instance-identifier sportsmart-prod-restore-$(date -u +%Y%m%d-%H%M%S) \
  --restore-time "$TARGET" \
  --db-subnet-group-name sportsmart-prod-private \
  --vpc-security-group-ids sg-xxxxxxxx

# 3. Wait for it (~10–20 minutes for a 100GB DB).
aws rds wait db-instance-available --db-instance-identifier <new-name>

# 4. Verify shape against a known-good fixture — DO NOT swap DNS yet.
psql -h <restore-endpoint> -U sportsmart_admin -d sportsmart \
  -c "SELECT count(*) FROM master_orders WHERE created_at > '$TARGET'::timestamptz;"

# 5. Stop the live API so writes pause:
kubectl -n production scale deployment/sportsmart-api --replicas=0

# 6. Rename the live instance, rename the restore to take its place:
aws rds modify-db-instance --db-instance-identifier sportsmart-prod \
  --new-db-instance-identifier sportsmart-prod-corrupted-$(date -u +%Y%m%d) \
  --apply-immediately
aws rds modify-db-instance --db-instance-identifier <new-name> \
  --new-db-instance-identifier sportsmart-prod \
  --apply-immediately

# 7. Wait for the rename then scale the API back up:
kubectl -n production scale deployment/sportsmart-api --replicas=2
kubectl -n production rollout status deployment/sportsmart-api

# 8. Smoke: /health/deps + a checkout in staging traffic shifted to prod.
```

Cross-link: `docs/MIGRATION_ROLLBACK_PLAYBOOK.md` covers the
"PITR for a bad migration" sub-case in more detail.

### Verifying PITR readiness

Quarterly drill:

1. Pick a random non-prod RDS instance.
2. Restore to a point 1h in the past.
3. Run the smoke suite against the restored instance.
4. Record: end-to-end duration, any manual interventions, whether the
   smoke suite caught any drift.

If a quarterly drill exceeds the 30-minute RTO target, file a
follow-up: either tune the backup window, scale instance size, or
revise the SLO.

---

## §2 Redis — Persistence + Failover

### Configuration

Dev (`infra/docker/docker-compose.yml`) runs Redis with `--appendonly yes
--appendfsync everysec`. Prod runs ElastiCache Redis with the
following parameter-group overrides:

```
appendonly         yes
appendfsync        everysec     # worst-case data loss = 1 sec
maxmemory-policy   allkeys-lru  # evict cold keys when full, never deny writes
```

ElastiCache snapshot retention: 7 days. The combination of AOF +
daily snapshots means a node loss recovers from AOF in <30 seconds;
a corruption event restores from snapshot.

### What Redis holds (and why persistence matters)

| Key prefix | Purpose | Loss-impact if Redis dies |
|------------|---------|---------------------------|
| `lock:*` | Distributed locks (outbox publisher, cron leader) | Crons may double-run for one tick; CAS predicates in DB catch it |
| `idem:*` | Stripe-style idempotency keys (refunds, payouts) | Retried POSTs may re-do work — DB unique constraints catch most |
| `rate:*` | Sliding-window rate limiters | Counters reset to 0; brief burst window after restart |
| `session:*` | Refresh token bindings | Active sessions lose their server-side reference and force a re-login |
| `cache:*` | Read-through caches (post-office lookup, etc.) | Slower first read after restart; no correctness impact |

### Failure handling

* **Node restart in same AZ:** AOF replay restores state in <30s.
  Application traffic continues to hit the same endpoint.
* **AZ failover:** ElastiCache promotes the read replica; DNS
  TTL is 15s. Application reconnects automatically (ioredis has
  retry-with-backoff built in).
* **Cluster-wide corruption:** drop the AOF, restore from the most
  recent snapshot, accept the data-loss window (<24h). Active
  sessions force re-login; idempotency replays may double-spend for
  in-flight refunds — surface manually via the wallet-ledger-recon
  cron.

---

## §3 Cloudinary — Asset durability

Cloudinary is Cloudinary's problem. We don't replicate their CDN.

Our responsibility is the **mapping between DB rows and Cloudinary
publicIds**:

* Every upload writes a `Banner`, `ProductImage`, or `VariantImage`
  row with the Cloudinary publicId before the asset URL is exposed.
* The Phase 14 Cloudinary orphan-sweeper cron deletes Cloudinary
  assets whose owning Product is soft-deleted — no lingering PII
  in Cloudinary outside our retention window.
* If Cloudinary loses an asset (rare), the user-facing surface
  falls back to the placeholder; admin restores from the original
  upload source (S3 staging bucket).

---

## §4 Application Tier — Multi-AZ + Stateless

The API runs as a stateless Deployment behind a load balancer with
N≥2 replicas across at least 2 availability zones. No node holds
durable state; every restart re-attaches to RDS + ElastiCache.

Failure modes:

* **Single pod crash:** kubelet restarts within 10s. SIGTERM handler
  (Phase 10) drains in-flight requests up to `SHUTDOWN_GRACE_MS`
  (30s default).
* **AZ outage:** the LB stops routing to the dead AZ. The remaining
  replicas absorb the load; the HPA spins up replacements in the
  surviving AZ within ~2 minutes.
* **Region outage:** the runbook for that is "wait for AWS." Multi-
  region active-active is not in scope for the current size; the
  business accepts a regional outage as a recoverable event.

---

## §5 Recovery Drills

Quarterly:

* [ ] PITR drill (above).
* [ ] Redis AOF replay drill — kill the node, time the recovery.
* [ ] App-tier chaos: kill a random pod during a smoke run, confirm
      zero customer-visible errors with the existing SIGTERM drain.
* [ ] Cloudinary asset audit — `scripts/audit-cloudinary-orphans.ts`
      (TBD) reports Cloudinary publicIds with no DB row.

Annually:

* [ ] Full DR drill: spin up a staging environment from prod
      backups, run a full purchase flow, then tear down. Time the
      end-to-end RTO; revise SLOs if needed.
