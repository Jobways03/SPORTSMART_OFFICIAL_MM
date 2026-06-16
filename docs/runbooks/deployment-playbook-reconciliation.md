# Deployment Playbook — Reconciliation with the As-Built Repo

Staple this to the *SportsMart Cloud Deployment Process Playbook*. The playbook's
**direction is correct** (ECS Fargate / ap-south-1 / Terraform / migrate-gate /
circuit-breaker / Secrets Manager) and most of it is **already implemented** in
`infra/aws/terraform/` + `.github/workflows/deploy.yml` + `infra/scripts/`. This
doc marks every place the playbook **diverges from what's actually built** so the
team builds *with* the repo, not a parallel greenfield plan.

Legend: ✅ matches as-built · ✏️ correction (as-built differs) · ➕ missing, must-add.

See also: `infra/aws/terraform/README.md` (bring-up), `docs/runbooks/release-checklist.md`
(go-live gate), `docs/MIGRATION_ROLLBACK_PLAYBOOK.md`.

---

## 0. Hard blockers the playbook omits (a prod deploy fails without these)

1. **➕ Boot-gate.** With `NODE_ENV=production` the API refuses to boot unless ALL
   are set (`apps/api/src/bootstrap/env/env.schema.ts`):
   - `requiredInProd` secrets: `RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET`,
     `R2_ACCOUNT_ID/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY`, `ADMIN_MFA_ENCRYPTION_KEY`
     (plus always-required: `DATABASE_URL`, `REDIS_URL`, 5 JWT secrets + `AFFILIATE_ENCRYPTION_KEY`).
   - 18 `requiredOnInProd` flags = `"true"` (CRON_HEARTBEAT, OUTBOX_ENABLED, ABAC,
     IDEMPOTENCY, MONEY_DUAL_WRITE, … — see `production.tfvars: api_extra_environment`).
   The playbook's secrets list misses the encryption keys, R2, and the 18 flags.
2. **➕ `prisma` CLI is a prod dependency** (`apps/api/package.json`) — required so the
   migrate-gate RunTask can run from the pruned image.
3. **➕ `NEXT_PUBLIC_*` are baked at `next build`.** The "build once, tag with SHA,
   promote across envs" model **does not work for the frontends** — each env needs its
   own build with `NEXT_PUBLIC_API_URL` as a `--build-arg` (`deploy.yml` does this per target).
4. **➕ First-boot seed is not automated.** `migrate deploy` creates schema only; a fresh
   DB has no roles/ABAC/tax-master and the app is unusable until seeded (seed uses
   `ts-node`, pruned from the prod image — run it via an in-VPC one-off; see release-checklist §6).
5. **➕ Rotate leaked credentials** committed in the tracked root `.env.example`
   (Cloudinary / Gemini / Gmail) before go-live.
6. **➕ ElastiCache `maxmemory-policy=noeviction`** (set via an `aws_elasticache_parameter_group`
   in `data.tf`) — the AWS default `volatile-lru` can evict held cron locks → money crons
   double-run.

---

## 1. Platform recommendation — ✅ correct
ECS Fargate over EKS, ap-south-1 for DPDP/RBI residency: agreed, and it's what's built.
✏️ One nuance: the doc names **Aurora**, but as-built is **plain RDS Postgres 16**
(`aws_db_instance` in `data.tf`), not Aurora (`aws_rds_cluster`). Aurora is a reasonable
future upgrade, but it's a different resource — decide deliberately; don't assume it exists.

## 2. Infrastructure topology
- ✏️ **Accounts:** as-built is **single account, per-env via separate Terraform state keys
  + tfvars** (`staging.s3.tfbackend` / `production.s3.tfbackend`), not a multi-account
  Organization. The dev/stage/prod/shared split is a good **maturity upgrade**, not current state.
- ✏️ **Subnets:** as-built is **2 AZs, 2 tiers** (public + private) — `network.tf`. Data stores
  live in the private subnets, SG-locked (not separate no-NAT "isolated data subnets"). The
  playbook's **3-AZ / 3-tier (public/private/isolated)** is a good upgrade; adopt it deliberately.
- ✏️ **Storage:** media is **Cloudflare R2** (S3-compatible SDK; boot-gate requires `R2_*`),
  **not S3 + CloudFront**. S3 is used for **Terraform state** (`bootstrap/`). Drop S3/CloudFront-for-media.
- ✏️ **Search (OpenSearch):** integrated but **optional + default-OFF**
  (`SEARCH_OPENSEARCH_ENABLED=false` → Postgres fallback) and **not provisioned by the current
  Terraform**. It's not a "core service" yet — standing up a domain + reindex backfill is real work.
- ➕ **WAF** is listed but **not built** — add `aws_wafv2_web_acl` on the ALB if required.
- ✅ Cache (ElastiCache Redis, cluster-mode-disabled, primary+replica via `redis_ha`), VPC/ALB/NAT/Route53,
  Secrets Manager + KMS — all as-built. (Note: `endpoints.tf` adds VPC endpoints; `nat_per_az` toggles per-AZ NAT for prod.)

## 3. Step-by-step — corrections
- **Step 1 (Terraform):** ✅ but order is: run `bootstrap/` first (creates the state bucket +
  lock table), then `terraform init -backend-config=<env>.s3.tfbackend`. RDS not Aurora; 2-AZ not 3.
- **Step 2 (Secrets):** ✅ Secrets Manager + task-exec role, never bake `.env`. ➕ Add the
  full boot-gate set (§0.1). As-built uses **two** secrets: `<env>/app/generated` (TF-managed:
  DB/Redis URLs + JWT/keys) and `<env>/app/external` (operator-filled: Razorpay/R2). ➕ Add the
  **GitHub OIDC deploy role** (`cicd.tf`) — the pipeline assumes a role via OIDC, no static keys.
- **Step 3 (CI/CD):** ✅ gitleaks → build → ECR → SHA-tag. ✏️ Frontends also need the per-env
  `NEXT_PUBLIC_*` build-arg (§0.3), so the SHA image is env-specific for web. ✅ migrate-deploy
  one-shot Fargate task before the API (`migrate.tf` + `deploy.sh`).
- **Step 4 (deploy order):** ✏️ **There are no separate "BullMQ worker" services.** No BullMQ
  dependency exists; the notification queue is a *custom* Redis-backed queue
  (`redis-notification-queue.ts`) and the crons (outbox-sweep, reconciliation, etc.) + the queue
  worker run **in-process inside `apps/api`** via `@nestjs/schedule` + `LeaderElectedCron`. Actual
  deployables: **`apps/api`, `apps/logistics-facade`, 10 web frontends.** (Mobile RN app ships via a
  separate app-store pipeline, not ECS.)
- **Step 5 (rollout):** ✏️ As-built is an **ECS rolling update with the deployment circuit
  breaker** (`min-healthy 100% / max 200%`, auto-rollback) — **not** weighted blue/green. The
  "10%→50%→100% over 15 min" canary needs the **CodeDeploy** ECS blue/green controller +
  weighted ALB target groups, which is **not configured**. Either adopt CodeDeploy explicitly or
  correct this to "rolling + circuit-breaker rollback."

## 4. Scaling — ✅ (minor)
Application Auto Scaling on CPU is built (`autoscaling.tf`, api + web-storefront).
✏️ Target is **60%** (playbook says 70%) with scale-out 60s / scale-in 300s cooldowns — reconcile
the number. ✏️ Connection math: `DATABASE_URL` sets **`connection_limit=10`** (not 20), and tasks
autoscale to 6 — recompute (~60 max) and size RDS / consider RDS Proxy accordingly.

## 5. Monitoring — ✅ (one add)
CloudWatch alarms + SNS are built (`monitoring.tf`: ECS unhealthy hosts, ALB 5xx, RDS CPU/storage,
Redis memory) — just **➕ wire the SNS email/Slack subscription** (`alarm_emails`). `/metrics`
(token-gated) and OpenTelemetry tracing (`tracing.ts`) exist. ✏️ Logger is a **custom
`AppLoggerService`** (structured JSON + `X-Request-Id`), **not Pino**.

## 6. DR & rollback — ✅ (note)
✅ Expand-and-contract / forward-only migrations, don't drop columns until the next release —
correct and matches `MIGRATION_ROLLBACK_PLAYBOOK.md`. ✏️ Backups: as-built RDS PITR is **14-day**
(prod, `rds_backup_retention_days`), not Aurora 35-day — adjust if Aurora is adopted. ✅ Rollback:
the circuit breaker auto-reverts a failed image; a bad migration follows the rollback playbook
(forward-fix / revert image tag / PITR).

---

## Net
Use the playbook as the **target-state north star**, but execute against the as-built repo
(Phases 0–3 + the Redis/commission hardening are done and tested). The four upgrades worth
adopting from the playbook: **multi-account Organization, 3-AZ/3-tier subnets, WAF, and
(optionally) Aurora + OpenSearch** — each is net-new work, not current state. The six §0 blockers
are non-negotiable for a successful prod boot.
</content>
