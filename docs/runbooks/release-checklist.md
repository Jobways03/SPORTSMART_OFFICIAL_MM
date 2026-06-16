# Release / Go-Live Checklist

The promotion gate for SPORTSMART. Staging is the rehearsal; a clean staging
sequence is the prerequisite for production. Nothing reaches prod that hasn't
passed every staging gate below.

Related: `infra/aws/terraform/README.md` (deploy), `docs/runbooks/migration-ordering.md`,
`docs/MIGRATION_ROLLBACK_PLAYBOOK.md`, `docs/runbooks/DISASTER_RECOVERY.md`,
`docs/runbooks/prod-boot-failures.md`, `docs/QA_UAT_CHECKLIST.md`.

---

## One-time prerequisites (per account)

- [ ] Route53 **public hosted zone** for the domain exists; `hosted_zone_name`
      + `env_domain` set in the tfvars.
- [ ] `github_repo` in the tfvars matches `git remote -v` (scopes the OIDC
      deploy-role trust — wrong value = every deploy fails at AssumeRole).
- [ ] State backend bootstrapped (`infra/aws/terraform/bootstrap` applied).
- [ ] GitHub repo variables set: `AWS_DEPLOY_ROLE_ARN` (= `terraform output
      -raw deploy_role_arn`), `AWS_REGION`.
- [ ] Phase-0 leaked credentials **rotated** (Cloudinary, Gemini, Gmail app
      password) — they remain in git history.

---

## Stage 1 — Staging soak (must pass before prod)

- [ ] `terraform apply -var-file=staging.tfvars` is clean (no unexpected diff).
- [ ] First deploy run (`Actions → Deploy → staging, all`) is green end-to-end:
      build → ECR push → migrate task exit 0 → rollout steady → **smoke passes**.
- [ ] `prisma migrate status` against the staging DB is clean (no pending /
      failed migrations). Migration order followed per `migration-ordering.md`.
- [ ] API boots: no boot-gate failures in the `api` service logs
      (`/ecs/sportsmart-staging/api`); `/api/v1/health/ready` = 200,
      `/api/v1/health/deps` healthy.
- [ ] Seed reference data loaded (roles / ABAC / SLA / tax-master); an admin
      can log in.
- [ ] `pnpm smoke` (or the deploy smoke gate) green; walk `QA_UAT_CHECKLIST.md`
      for the flows in this release.
- [ ] CloudWatch alarms exist and are not firing; `alarm_emails` set and a test
      notification was received.
- [ ] Rollback rehearsed at least once: a deliberately-bad image is caught by
      the deployment circuit breaker and auto-rolled-back (deploy reports FAILED).

## Stage 2 — Production readiness

- [ ] `production.tfvars` reviewed: `node_env=production`, `redis_ha=true`,
      `nat_per_az=true`, RDS Multi-AZ + `rds_backup_retention_days>=14` +
      `rds_deletion_protection=true`, all 18 `requiredOnInProd` flags = `"true"`.
- [ ] **External secrets populated BEFORE pushing prod images:** Razorpay
      (`KEY_ID`/`KEY_SECRET`/`WEBHOOK_SECRET`) + R2
      (`ACCOUNT_ID`/`BUCKET`/`ACCESS_KEY_ID`/`SECRET_ACCESS_KEY`) set in the
      `production/app/external` Secrets Manager secret. (Empty = API crash-loops
      the prod boot-gate.)
- [ ] GitHub `production` environment has **required reviewers** configured
      (the gate on both the build and rollout jobs).
- [ ] DR: RDS PITR confirmed; a snapshot-restore drill done within the DR
      cadence (`DISASTER_RECOVERY.md`); `MIGRATION_ROLLBACK_PLAYBOOK.md` re-read.
- [ ] Money / dual-write flags flipped in order `ENABLED → DUAL_WRITE →
      AUTHORITATIVE` per `MONEY_PAISE_CUTOVER.md` (via `terraform apply` — a
      bare force-new-deployment does NOT propagate env/flag changes).
- [ ] **Sign-offs obtained** (block prod): finance/legal §194-O TDS section
      determination + historical 10% correction; CA sign-off on the
      money-paise Decimal-column drops.

## Stage 3 — Production cutover

- [ ] Off-peak window chosen; on-call available.
- [ ] `terraform apply -var-file=production.tfvars` clean.
- [ ] Trigger `Deploy → production, all`; approve the environment gate.
- [ ] Migrate task exits 0; rollout steady; **smoke passes** against the prod
      hostnames.
- [ ] Post-deploy: error rate / latency / 5xx normal on the dashboards for
      ~30 min; no alarms; a real synthetic order/payment/refund flow works.

## Rollback trigger

If smoke fails, alarms fire, or the synthetic flow breaks: the deployment
circuit breaker auto-rolls-back a bad image release. For a bad **migration**,
follow `MIGRATION_ROLLBACK_PLAYBOOK.md` (forward-fix / code-revert image tag /
PITR) — Prisma is forward-only, there are no down migrations.
