# SPORTSMART — AWS ECS Fargate (Terraform)

Phase 1 (2026-06-15). Provisions one full environment (`staging` or
`production`) on **ECS Fargate** — serverless containers, no cluster ops.
This replaces the Phase-9 EKS skeleton; the `infra/ci-cd/k8s/` manifests are
kept only as reference.

> Container images are pushed by `deploy.yml` / `deploy.sh` (Phase 2). After
> a fresh `apply` the ECR repos are empty, so ECS services exist but their
> tasks stay **pending** until the first image push. That is expected.

## What it creates

| Concern | File | Notes |
|---|---|---|
| VPC, 2×public + 2×private subnets, NAT | `network.tf` | single NAT (staging); 1/AZ for prod HA |
| Security groups (alb→ecs→rds/redis) | `security.tf` | least-privilege chain |
| RDS Postgres 16, ElastiCache Redis | `data.tf` | private; password generated |
| ECR repo per service | `registry.tf` | `sportsmart-<env>/<service>` |
| Secrets Manager (generated + external) + KMS | `secrets.tf` | DB/Redis/JWT generated; Razorpay/R2 operator-filled |
| IAM task-execution + task roles | `iam.tf` | |
| CloudWatch log group per service | `logs.tf` | 30-day retention |
| ALB + ACM wildcard + listeners | `alb.tf` | HTTP→HTTPS redirect |
| ECS cluster + per-service task/service/TG/rule/DNS | `ecs.tf` | `for_each local.services` |

Services come from **`local.services`** in `locals.tf` (1 api + 10 web-*,
mirroring `deploy.yml`). Add/remove a service there and everything fans out.

## Prerequisites

- A registered domain with a **Route53 public hosted zone** in this account
  (set `hosted_zone_name`). Each service is published at
  `<subdomain>.<env_domain>` and a single ACM wildcard `*.<env_domain>`
  covers them. Edit the `subdomain`s in `locals.tf` to taste.
- Set **`github_repo`** (in the tfvars) to your real `owner/name` — it scopes
  the OIDC deploy-role trust (cicd.tf). A wrong value makes every GitHub
  Actions deploy fail at `sts:AssumeRoleWithWebIdentity`. Verify with
  `git remote -v`.
- AWS credentials with permission to create the above.

## Bring-up

```bash
# 0. One-time per account: create the S3 state bucket + DynamoDB lock table.
cd infra/aws/terraform/bootstrap
terraform init
terraform apply -var region=ap-south-1
cd ..

# 1. Init the root module against the staging state key.
terraform init -backend-config=staging.s3.tfbackend

# 2. Review + apply staging.
terraform plan  -var-file=staging.tfvars
terraform apply -var-file=staging.tfvars
```

`apply` prints `ecr_repository_urls`, `service_urls`, `ecs_cluster_name`, and
the two secret ARNs. Hand `ecs_cluster_name` + the ECR URLs to Phase 2
(`deploy.sh`) to push images and roll out.

## Secrets model

Two Secrets Manager secrets, referenced key-by-key by the API task def:

- **`<env>/app/generated`** — Terraform owns it: `DATABASE_URL`, `DIRECT_URL`,
  `REDIS_URL` (composed from RDS/Redis outputs) and the JWT + encryption keys
  (generated via `random_password`/`random_id`). These satisfy the
  *always-required* boot-gate with zero manual entry.
- **`<env>/app/external`** — you own it: `RAZORPAY_*`, `R2_*`. Created once with
  placeholders; the version has `ignore_changes`, so **edit the real values in
  the AWS console** and Terraform won't revert them. Required only when
  `node_env=production` (the prod boot-gate enforces them).

All secret values land in Terraform **state** — that's why the S3 backend is
encrypted. Treat state as sensitive.

## Staging vs production

Staging boots with `node_env=staging` (skips the prod-only requirement for
Razorpay/R2 + the `requiredOnInProd` flags) so you get a running env fast.
`production.tfvars` flips `node_env=production`, enables RDS Multi-AZ + 14-day
PITR + deletion protection, bumps instance sizes, and sets the 18
`requiredOnInProd` flags (without them the prod API refuses to boot).

```bash
terraform init -backend-config=production.s3.tfbackend -reconfigure
terraform plan  -var-file=production.tfvars
terraform apply -var-file=production.tfvars
```

## Deploy/ownership split

Terraform owns infrastructure **and** the ECS task definitions; the task defs
reference the moving `:<image_tag>` tag (e.g. `staging-latest`). A deploy
(Phase 2) re-pushes that tag to ECR and runs
`aws ecs update-service --force-new-deployment` — no task-def churn, and the
deployment **circuit breaker** auto-rolls-back a release whose tasks fail the
ALB health check. Only `desired_count` is `ignore_changes` (autoscaling +
manual scaling own it).

> **Env/flag changes need `terraform apply`.** Because the `environment[]`
> block (including the `api_extra_environment` `requiredOnInProd` flags) is
> part of the TF-owned task def, changing a flag and running a bare
> `force-new-deployment` will **not** pick it up — it reuses the existing
> revision. Run `terraform apply` to mint a new revision when you change env
> vars/flags (e.g. flipping the money-paise cutover flags in prod).

> **First apply = empty ECR.** With no image pushed yet, the initial ECS
> deployment can't pull and lands in a FAILED/ROLLED_BACK state (this does
> NOT fail `terraform apply`). The first Phase-2 image push + deploy clears it.

## Deploying (Phase 2 — wired)

After `terraform apply`, deployment runs through `.github/workflows/deploy.yml`
(manual `workflow_dispatch`, choose `target` + `services`). One-time setup:

```bash
# Set the GitHub repo variables the workflow needs (Settings → Variables):
terraform output -raw deploy_role_arn   # → repo variable AWS_DEPLOY_ROLE_ARN
#                                          repo variable AWS_REGION = your region
```

The workflow: **prep** (OIDC auth, compute `<target>-<sha7>` tag, read the API
URL from SSM) → **build** (build + push each image to ECR, baking
`NEXT_PUBLIC_API_URL` into the web images) → **rollout** (`infra/scripts/deploy.sh`:
runs `prisma migrate deploy` as a one-shot Fargate task, then
`update-service --force-new-deployment` per service, with circuit-breaker
rollback). Migrations run automatically when `api` is in the deploy set.

## Production go-live checklist

1. **Populate the external secret BEFORE pushing prod images.** With
   `node_env=production` the API boot-gate requires the Razorpay + R2 creds;
   they ship as empty placeholders in `<env>/app/external`. If you push images
   and deploy before filling them in (AWS console → Secrets Manager), every
   API task **crash-loops forever**. Fill them first, then deploy.
2. `production.tfvars` already flips the prod toggles: `redis_ha=true` (2-node
   Redis + failover + TLS `rediss://`), `nat_per_az=true` (no egress SPOF),
   Multi-AZ RDS + 14-day PITR + deletion protection, the 18 `requiredOnInProd`
   flags, and `secret_recovery_window_days=30`.
3. Set `alarm_emails` so the CloudWatch alarms (monitoring.tf) actually page.
4. Confirm `deploy.yml` passes `NEXT_PUBLIC_API_URL` as a per-env Docker
   `--build-arg` (it's baked at `next build`; the runtime env here is a
   fallback only).

## Known follow-ups (not in this module)

- **Optional further hardening:** WAF on the ALB, ALB access logs to S3, RDS
  `sslmode=verify-full` with the RDS CA bundle (engine already enforces TLS
  via `rds.force_ssl`), a least-privilege bucket policy on the state bucket
  scoped to the CI/operator role, and storefront on the apex domain (extra
  ACM SAN + record). NAT-per-AZ, VPC endpoints, Redis HA, autoscaling, and
  CloudWatch alarms are already built and toggle on for production.
```
