# SportsMart — Staging Deployment Playbook (detailed)

**Audience:** Dev/Ops, little or no prior AWS experience.
**Environment:** Staging — every host is `<name>.staging.sportsmart.com`.
**Outcome:** all 11 frontends + the API + the internal logistics-facade running on AWS ECS Fargate.
**Time:** ~2–3 hours, most of it waiting on Terraform (~20 min) and the deploy workflow (~20–30 min).

This is verified against the real code: `infra/aws/terraform/*`, `.github/workflows/deploy.yml`,
`infra/scripts/deploy.sh`. Steps that can only be confirmed by a live `terraform apply` are marked
**[verify on first run]**.

> **How the pieces fit:** Terraform builds the *infrastructure* (network, DB, Redis, ALB, ECR repos,
> empty ECS services, secrets, the OIDC deploy role). The **GitHub "Deploy to ECS" workflow** then
> builds the container images, pushes them to ECR, runs DB migrations, and rolls the services. You run
> Terraform **once** (and again only when infra/env changes); you run the workflow on **every code
> deploy**.

---

## 0. What you will end up with (host reference)

`terraform apply` + one `Deploy to ECS` run with `services=all` produces these (region **ap-south-1**,
cluster **`sportsmart-staging`**):

| Service (ECS name) | URL | Default tasks in staging |
|---|---|---|
| `api` | `https://api.staging.sportsmart.com` | **1** |
| `web-storefront` (customer shop) | `https://shop.staging.sportsmart.com` | **1** |
| `web-admin-storefront` (super admin) | `https://admin.staging.sportsmart.com` | **1** |
| `web-d2c-seller` | `https://d2c-seller.staging.sportsmart.com` | 0 (scale on demand) |
| `web-d2c-seller-admin` | `https://d2c-admin.staging.sportsmart.com` | 0 |
| `web-retail-seller` | `https://retail-seller.staging.sportsmart.com` | 0 |
| `web-retail-seller-admin` | `https://retail-admin.staging.sportsmart.com` | 0 |
| `web-franchise` | `https://franchise.staging.sportsmart.com` | 0 |
| `web-franchise-admin` | `https://franchise-admin.staging.sportsmart.com` | 0 |
| `web-affiliate` | `https://affiliate.staging.sportsmart.com` | 0 |
| `web-affiliate-admin` | `https://affiliate-admin.staging.sportsmart.com` | 0 |
| `logistics-facade` | **internal only** — `http://logistics-facade.staging.internal:4100` (AWS Cloud Map) | 1 |

Two important naming facts:
- **ECS service name ≠ subdomain.** Scale/roll commands use the **service name** (`web-d2c-seller`),
  not the subdomain (`d2c-seller`). The D2C *admin* subdomain is `d2c-admin`, **not** `d2c-seller-admin`.
- **8 of the 10 web apps default to 0 tasks** in staging to save money. Their URL returns 503 until you
  scale them up (Phase 9.5). `api`, `web-storefront`, `web-admin-storefront` run at 1.

---

## Phase 0 — Prerequisites (do these once, in order)

**0.1 The code must be on the branch you deploy.** The workflow builds whatever branch you run it from
(default `main`). Make sure your `main` actually contains the infra + app code:
```bash
git checkout main && git pull
git ls-files infra/aws/terraform/ecs.tf        # must print the path
```
> If `ecs.tf` isn't on the branch, `terraform apply` builds nothing and `deploy.sh` exits 1.

**0.2 (local dev only — NOT an AWS-deploy step) After any merge/pull, regenerate the Prisma client.**
The generated client lags `prisma/schema/*`, so skipping this causes confusing `'field does not exist on
type'` errors locally that look like code bugs:
```bash
cd apps/api && npx prisma generate
```
> You only need this — and the `migrate diff` in Appendix A — to keep your **local** dev DB + typecheck
> in sync. The **AWS deploy does not require either**: the Docker build runs `prisma generate` itself, and
> the pipeline runs migrations on the RDS database automatically (Appendix A). If you're only deploying
> from `main`, you can skip 0.2 entirely.

**0.3 A Route 53 PUBLIC hosted zone for your domain must already exist** in the AWS account
(`infra/aws/terraform/main.tf` does `data "aws_route53_zone" "primary" { name = "sportsmart.com"; private_zone = false }`).
If you use a different registered domain, change `hosted_zone_name`/`env_domain`/`auth_cookie_domain` in
`infra/aws/terraform/staging.tfvars` to match. **No zone ⇒ `terraform apply` fails at plan.**

**0.4 The OIDC trust is pinned to the repo.** `staging.tfvars` has
`github_repo = "Jobways03/SPORTSMART_OFFICIAL_MM"` — it MUST equal your real GitHub remote, or every
Actions deploy fails at AssumeRole. Change it there if your repo differs.

---

## Phase 1 — AWS account & the `terraform-admin` user

1. Create the AWS account (root user); enable **MFA** on the root user; then stop using root.
2. **IAM → Users → Create user** → name `terraform-admin` → attach **AdministratorAccess**.
3. On the user → **Security credentials → Create access key → Command Line Interface (CLI)** → download
   the `.csv`. You need the **Access Key ID** (`AKIA…`) and the **40-character Secret Access Key**.

---

## Phase 2 — Local tools

**2.1 AWS CLI**
```bash
aws configure
# AWS Access Key ID:     <AKIA… from the csv>
# AWS Secret Access Key: <the full 40-char secret>
# Default region name:   ap-south-1
# Default output format:  json
```
> **Gotcha we hit:** Terraform reads `~/.aws/credentials` directly. If a partial paste (or `aws login`)
> leaves out a key, Terraform fails with *"partial credentials found for profile default."* Verify both
> lines exist and the identity resolves:
> ```bash
> grep -E 'aws_access_key_id|aws_secret_access_key' ~/.aws/credentials   # both must be present
> aws sts get-caller-identity                                            # must print the terraform-admin ARN
> ```

**2.2 Terraform** ≥ 1.6 → `terraform -version`.

**2.3 Clone** (and check out the deploy branch from 0.1)
```bash
git clone https://github.com/Jobways03/SPORTSMART_OFFICIAL_MM.git
cd SPORTSMART_OFFICIAL_MM && git checkout main
```

---

## Phase 3 — Bootstrap the Terraform state backend (one-time per AWS account)

Terraform stores its state in S3 (with a DynamoDB lock). That bucket/table must exist **before** the main
module can use the S3 backend — so bootstrap runs first with local state.
```bash
cd infra/aws/terraform/bootstrap
terraform init
terraform apply -var region=ap-south-1        # type: yes
```
Creates **S3 bucket `sportsmart-tfstate`** (versioned, KMS-encrypted, public-access-blocked, TLS-only) and
**DynamoDB table `sportsmart-tflock`**. If you override the names, also edit `../staging.s3.tfbackend` and
`../production.s3.tfbackend` to match.

---

## Phase 4 — External secrets (Razorpay TEST + Cloudflare R2)

There are **two** Secrets Manager secrets. Know which is which:

- **`staging/app/generated`** — **Terraform owns it. Do NOT touch.** It holds DB/Redis URLs, the JWT/AES
  keys, and the logistics-facade secrets (`INTERNAL_API_KEY`, `LOGISTICS_DATABASE_URL`, `LOGISTICS_REDIS_URL`)
  — all generated on `apply`.
- **`staging/app/external`** — **you fill it.** Exactly these 7 keys (`lifecycle ignore_changes` so a later
  `apply` never reverts your edits):
  ```
  RAZORPAY_KEY_ID          rzp_test_…       (Razorpay TEST key — not live)
  RAZORPAY_KEY_SECRET      …                (TEST secret)
  RAZORPAY_WEBHOOK_SECRET  …                (staging webhook secret)
  R2_ACCOUNT_ID            …
  R2_BUCKET                …                (staging bucket)
  R2_ACCESS_KEY_ID         …
  R2_SECRET_ACCESS_KEY     …
  ```

> **You can skip this for first bring-up.** `staging.tfvars` sets `node_env=staging`, which skips the
> prod-only boot-gate, so the API boots with these empty. But **online payments + image upload (R2) won't
> work until you fill them** — do it before Phase 9.2. Terraform creates the secret with empty placeholders
> on `apply`; fill it in the console (Secrets Manager → `staging/app/external` → Retrieve/Edit), or via CLI
> after Phase 5:
> ```bash
> aws secretsmanager put-secret-value --secret-id staging/app/external --region ap-south-1 \
>   --secret-string '{"RAZORPAY_KEY_ID":"rzp_test_…","RAZORPAY_KEY_SECRET":"…","RAZORPAY_WEBHOOK_SECRET":"…","R2_ACCOUNT_ID":"…","R2_BUCKET":"…","R2_ACCESS_KEY_ID":"…","R2_SECRET_ACCESS_KEY":"…"}'
> ```

---

## Phase 5 — Provision the infrastructure

```bash
cd infra/aws/terraform
terraform init -backend-config=staging.s3.tfbackend -reconfigure   # wait for "successfully initialized"
terraform apply -var-file=staging.tfvars                            # review plan, type: yes; ~15–20 min
```

This builds (all prefixed `sportsmart-staging`): VPC + public/private subnets + NAT, RDS Postgres 16
(`db.t4g.micro`), ElastiCache Redis (`cache.t4g.micro`), an internet-facing ALB with the
`*.staging.sportsmart.com` ACM cert, the ECS cluster, **one ECS service per app + the internal
logistics-facade** (its own ECR repo, a Cloud Map namespace `staging.internal`, an ECS service + migrate
task), the two Secrets Manager secrets, and the GitHub-OIDC deploy role. **ECR repos are empty now — the
ECS services stay PENDING until Phase 7 pushes images. That's expected.**

After it finishes, grab the outputs you need next:
```bash
terraform output deploy_role_arn               # → GitHub variable (Phase 6)
terraform output app_secret_external_arn       # the Razorpay/R2 secret to populate (Phase 4)
terraform output logistics_facade_internal_url # informational: http://logistics-facade.staging.internal:4100
```

---

## Phase 6 — GitHub: OIDC variables + environments

The workflow authenticates to AWS with **GitHub OIDC** (no static keys in GitHub). All three jobs assume
the deploy role via `role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN || vars.AWS_ROLE_ARN }}`.

**6.1 Set the variables at the REPOSITORY level** — **Settings → Secrets and variables → Actions → Variables → New repository variable**:
```
AWS_REGION           = ap-south-1
AWS_DEPLOY_ROLE_ARN  = <paste `terraform output deploy_role_arn`>     # AWS_ROLE_ARN is also accepted
```
> **Why repository-level, not environment-level:** the `prep` job (which authenticates to read SSM + compute
> the image tag) has **no `environment:`**, so it only sees *repository* variables. If you set these only on
> the `staging`/`production` *environment*, `prep` fails OIDC. (`gh` CLI: `gh variable set AWS_DEPLOY_ROLE_ARN --body "$(terraform -chdir=infra/aws/terraform output -raw deploy_role_arn)"` and `gh variable set AWS_REGION --body ap-south-1`.)

**6.2 Create the environments** — **Settings → Environments** → create **`staging`** and **`production`**.
The `build` and `rollout` jobs reference `environment: <target>`, so the environment must exist. Staging
needs no rules; on **`production`** add **required reviewers** (that gate also blocks the image PUSH, not
just the rollout).

---

## Phase 7 — Deploy

**Actions → `Deploy to ECS` → Run workflow:**

| Field | Value |
|---|---|
| Use workflow from | your deploy branch (e.g. `main`) |
| **target** | `staging` |
| **services** | `all` (default — every app + the logistics-facade) |
| **run_seed** | **true** for the first deploy (loads admin/ABAC/SLA/tax reference data; idempotent). `false` thereafter. |

(CLI equivalent: `gh workflow run "Deploy to ECS" -f target=staging -f services=all -f run_seed=true`.)

**What runs (≈20–30 min):**
1. **prep** — gitleaks secret scan → compute tag `staging-<sha7>` → OIDC auth → read `…/deploy/api_url` from
   SSM (baked into web images as `NEXT_PUBLIC_API_URL`).
2. **build** (matrix) — build + push each of the 11 apps **and** the logistics-facade to ECR
   (`:staging-<sha7>` and the moving `:staging-latest`), `linux/amd64`.
3. **rollout** (`infra/scripts/deploy.sh`), in this exact order:
   - **DB migrate** (only because `api` is in `all`): one-shot Fargate `prisma migrate deploy` task; waits for
     exit 0 **before** anything rolls. Logs: `/ecs/sportsmart-staging/migrate`.
   - **Facade migrate** (only because `logistics-facade` is in `all`): a second one-shot task that does
     `CREATE SCHEMA IF NOT EXISTS logistics` then applies the facade migrations. Logs:
     `/ecs/sportsmart-staging/logistics-facade-migrate`.
   - **Seed** (because `run_seed=true`): one-shot `seed-prod.ts`.
   - **Preflight** — every requested service must already exist + be ACTIVE (Terraform created them).
   - **Roll** — `update-service --force-new-deployment` per service, then wait for `rolloutState=COMPLETED`
     (a circuit-breaker rollback surfaces as `FAILED` and fails the deploy).
   - **Smoke test** — `smoke.sh` curls each public service through the ALB.

**[verify on first run]** watch the **API task reaching `healthy`** (the Prisma engine loading on linux) and
the **`logistics-facade-migrate` task exiting 0**. Both are in CloudWatch under `/ecs/sportsmart-staging/…`.

> **Targeted deploys later:** `services=api,web-storefront` deploys just those two. **Migrations only run when
> `api` is in the list** (facade migrations only when `logistics-facade` is). Service names are matched
> exactly and comma-delimited — `web-d2c-seller` does **not** also select `web-d2c-seller-admin`.

---

## Phase 8 — DNS (GoDaddy)

In GoDaddy DNS for `sportsmart.com`, **without touching the Name Servers**, add:
```
Type: CNAME    Host: *.staging    Value: <ALB DNS name>    TTL: 1 hour
```
Get the ALB DNS name from **EC2 → Load Balancers → `sportsmart-staging` → DNS name** (or
`terraform output alb_dns_name`). This routes every `*.staging.sportsmart.com` host to the staging ALB; your
live site is untouched. Wait 15–30 min for propagation.

---

## Phase 9 — Validation checklist (every box must pass)

**9.1 Health + TLS**
```bash
curl -fsS https://api.staging.sportsmart.com/api/v1/health/ready
```
Expect **HTTP 200** and a body like `{"success":true,"status":"healthy","checks":{…}}`.
> ⚠️ The top-level `status` is **`"healthy"`** (or `"degraded"`/503), **never `"ok"`**. Judge health by the
> **200 status code**, not the body string. (The per-dependency leaves inside `checks{}` are `"ok"`/`"error"`
> — a different field.) `https://shop.staging.sportsmart.com` must load; padlock shows a valid
> `*.staging.sportsmart.com` cert.

**9.2 Customer & payment** — register a test customer on the storefront → add to cart → checkout. Razorpay
must show **Test Mode**; pay with Visa test card **`4111 1111 1111 1111`** → order-success page.
*(Needs the Razorpay TEST keys in `staging/app/external` from Phase 4.)*

**9.3 Admin & webhook** — log in at `https://admin.staging.sportsmart.com` (seed admin) → **Orders** → your
test order shows **CONFIRMED** (proves the Razorpay webhook reached the private subnet).

**9.4 Logistics-facade (internal — validated through the admin, not a URL)** — in the admin, open
**Logistics Partners** (Sellers → Logistics, or a seller-admin portal's Logistics panel). The partner list
(DELHIVERY / SHADOWFAX) must load. **Why:** the facade has no public URL — it's reached only inside the VPC
via Cloud Map on port 4100. A loaded list proves API → facade connectivity works. *"Could not load partners"*
= the API can't reach the facade → check the `logistics-facade` ECS service is RUNNING and its Cloud Map
service is healthy.

**9.5 Seller-portal scale-up** (the 8 zeroed portals) — e.g. for D2C seller:
```bash
aws ecs update-service --cluster sportsmart-staging --service web-d2c-seller --desired-count 1 --region ap-south-1
# wait ~60s, then open https://d2c-seller.staging.sportsmart.com  (note: subdomain is d2c-seller)
aws ecs update-service --cluster sportsmart-staging --service web-d2c-seller --desired-count 0 --region ap-south-1
```
> Use the **service name** (`web-d2c-seller`), not the subdomain. These manual counts are NOT reverted by a
> later `terraform apply` (the services `ignore_changes = [desired_count]`).

When all boxes pass, staging is validated → proceed to the Production playbook.

---

## Appendix A — Migrations & schema (how the DB stays in sync)

- **AWS staging RDS is migrate-managed and AUTOMATIC.** `deploy.sh` runs `prisma migrate deploy` as a one-shot
  Fargate task (and waits for exit 0) **before** apps roll — every deploy that includes `api`. **Do NOT
  hand-run `prisma migrate deploy` against the AWS DB** — that risks a partial/competing migration. The facade
  gets its own one-shot migrate into the `logistics` schema.
- **The local/dev DB is different — it's `db push`-managed** (no `_prisma_migrations` table), so
  `prisma migrate status`/`deploy` are meaningless locally. To check for drift after pulling new schema:
  ```bash
  cd apps/api
  # DIRECT_URL = the DIRECT (port 5432) connection, NOT the pooled DATABASE_URL (6543)
  npx prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel ./prisma/schema --script
  ```
  If it prints additive SQL (and **no** `DROP`/`ALTER COLUMN`), apply it: `… --script | psql "$DIRECT_URL"`.
  Empty output = in sync.
- **Always re-run `npx prisma generate` (apps/api) after any merge/pull** that touched `prisma/schema/*`.

---

## Appendix B — Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `terraform apply` → "partial credentials found" | `~/.aws/credentials` missing a key — re-run `aws configure` (Phase 2.1). |
| `apply` fails at the Route 53 data lookup | No public hosted zone for the domain (Phase 0.3). |
| Deploy fails in `prep` at AssumeRole / empty role | Role var set as an *environment* var, not *repository* (Phase 6.1), or `github_repo` mismatch (Phase 0.4). |
| `tsc`/build: `'<field>' does not exist on type` | Stale generated Prisma client — `cd apps/api && npx prisma generate` (Phase 0.2). |
| Deploy fails at DB/facade migrate | Check CloudWatch `/ecs/sportsmart-staging/migrate` or `…/logistics-facade-migrate`. |
| Rollout `FAILED` | ECS circuit-breaker rolled back a bad image — check the service's task logs. |
| Admin "Could not load partners" | `logistics-facade` service not RUNNING or Cloud Map/SG-4100 issue — not a URL problem. |
| `d2c-seller.staging…` returns 503 | That portal defaults to 0 tasks — scale it up (Phase 9.5). |
| Online payment / image upload broken | `staging/app/external` (Razorpay TEST / R2) not populated (Phase 4). |

---

## Appendix C — Day-2 operations

- **Re-deploy after a code change:** `Deploy to ECS` → `target=staging`, `services=all` (or a subset),
  `run_seed=false`. Include `api` whenever the schema changed (so migrations run).
- **Scale a portal:** `aws ecs update-service --cluster sportsmart-staging --service <name> --desired-count <n> --region ap-south-1`.
- **Read deploy wiring:** `aws ssm get-parameter --name /sportsmart/staging/deploy/<cluster|api_url|migrate_task_family|…> --query Parameter.Value --output text`.
- **Tear down:** `terraform destroy -var-file=staging.tfvars` (staging has `rds_deletion_protection=false`).

---

## Appendix D — Production differences (for later)

- `production.tfvars` sets `node_env=production` → the API boot-gate **requires** the `staging/app/external`
  equivalents + the `requiredOnInProd` flags, and the **facade requires real `SHADOWFAX_*`/`DELHIVERY_*`
  partner creds** (its strict prod schema rejects placeholders) — provision those first or it crash-loops.
- Production uses `production-latest` image tags and the `production` environment's required-reviewer gate.
- Production DNS is a Name-Server cutover (not a CNAME) — covered in the Production playbook.
