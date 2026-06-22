# SportsMart — Staging Deployment Playbook (detailed)

**Audience:** Dev/Ops, little or no prior AWS experience.
**Environment:** Staging — every host is `<name>.staging.sportsmart.com`.
**Outcome:** all 11 frontends + the API + the internal logistics-facade running on AWS ECS Fargate.
**Time:** ~2–3 hours, most of it waiting on Terraform (~20 min), a DNS-delegation propagation wait between
the two Phase-5 applies (usually a few minutes, occasionally longer), and the deploy workflow (~20–30 min).

This is verified against the real code: `infra/aws/terraform/*`, `.github/workflows/deploy.yml`,
`infra/scripts/deploy.sh`. Steps that can only be confirmed by a live `terraform apply` are marked
**[verify on first run]**.

> **How the pieces fit:** Terraform builds the *infrastructure* (network, DB, Redis, ALB, ECR repos,
> empty ECS services, secrets, the OIDC deploy role). The **GitHub "Deploy to ECS" workflow** then
> builds the container images, pushes them to ECR, runs DB migrations, and rolls the services. You run
> Terraform for the first bring-up as a **two-step apply** (Phase 5 — create + delegate the DNS zone, then
> the full apply); after that you re-run it only when infra/env changes. You run the workflow on **every
> code deploy**.

---

## 0. What you will end up with (host reference)

`terraform apply` (Phase 5 — a two-step apply: create + delegate the DNS zone, then apply the rest) + one
`Deploy to ECS` run with `services=all` produces these (region **ap-south-1**, cluster **`sportsmart-staging`**):

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

**0.3 You do NOT need a pre-existing Route 53 zone for staging — but you DO need the ability to add one
DNS record in the parent `sportsmart.com` zone.** Staging runs under a **delegated subdomain**:
`staging.tfvars` sets `create_hosted_zone = true`, so Terraform *creates* the `staging.sportsmart.com`
public hosted zone for you (`infra/aws/terraform/main.tf` → `resource "aws_route53_zone" "primary"`). You
then delegate it by adding **one `NS` record** for `staging` in whoever manages `sportsmart.com` DNS
(GoDaddy / registrar / corporate DNS) — done in **Phase 5.3** using the nameservers Terraform outputs.
> ⚠️ **Do NOT create a Route 53 hosted zone for the apex `sportsmart.com` in this account.** Repointing the
> registrar's nameservers at it would hijack the company's real DNS (website + email/MX). Delegating only the
> `staging` subdomain leaves the apex untouched.
>
> To use a different domain you fully control instead, set `hosted_zone_name`/`env_domain`/
> `auth_cookie_domain` in `staging.tfvars` to it (keep `create_hosted_zone = true` to have Terraform create
> the zone, or set it `false` if that exact zone already exists in this account). Production differs — it
> looks up a pre-existing apex zone; see Appendix D.

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
  RAZORPAY_KEY_ID          rzp_test_…       (Razorpay TEST key — from the dashboard, not live)
  RAZORPAY_KEY_SECRET      …                (TEST secret — from the dashboard)
  RAZORPAY_WEBHOOK_SECRET  …                (a string YOU invent — `openssl rand -hex 32`; see note below)
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

> **`RAZORPAY_WEBHOOK_SECRET` — you invent it; you do NOT need a webhook to exist first.** It's a shared
> secret between Razorpay and your API: Razorpay signs each webhook payload with it (HMAC-SHA256) and the
> API verifies the signature with the *same* string — it is **not** something Razorpay generates for you.
> Generate one now and store it as the value above:
> ```bash
> openssl rand -hex 32
> ```
> You **register** that same secret in the Razorpay dashboard later, in **Phase 8**, once the API URL is
> live. The webhook is **not** required for the Phase 9.2 payment test — the order confirms via the
> synchronous payment verify; the webhook is the async backstop (paid-but-browser-closed) + the dispute /
> chargeback channel. (`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` *do* come from Razorpay: Dashboard →
> Settings → API Keys → generate **Test Mode** keys.)

---

## Phase 5 — Provision the infrastructure

The apply is **deliberately split in two**: Terraform creates the DNS zone, you delegate it, and only then
can the full apply finish — because the ALB's ACM certificate is **DNS-validated**, and the apply **blocks
at `aws_acm_certificate_validation` until the subdomain resolves publicly**. Do these in order.

**5.1 Initialize the backend**
```bash
cd infra/aws/terraform
terraform init -backend-config=staging.s3.tfbackend -reconfigure   # wait for "successfully initialized"
```

**5.2 Create the DNS zone first (targeted), then read its nameservers**
```bash
terraform apply -target=aws_route53_zone.primary -var-file=staging.tfvars   # type: yes — creates 1 resource
terraform output route53_name_servers                                       # 4 AWS nameservers
```
You'll get four like `ns-123.awsdns-45.org`, `ns-678.awsdns-90.co.uk`, …. (The `-target` warning Terraform
prints is expected — this is the one legitimate use of it.) Only `route53_name_servers` is populated at this
stage; the Phase 5.5 outputs (`deploy_role_arn`, etc.) don't exist until the full 5.4 apply creates their
resources.

**5.3 Delegate `staging` in the parent `sportsmart.com` DNS — this gates 5.4.**
In whoever manages `sportsmart.com` DNS (GoDaddy / registrar / corporate DNS console), add **one** record —
**do not touch the existing apex records or nameservers**:
```
Type: NS    Host/Name: staging    Value: <the 4 nameservers from 5.2, one per line>    TTL: 300
```
**Host/Name** is the subdomain label *relative to the zone you're editing* — usually just `staging`, though
some panels (and the Route 53 console) want the full `staging.sportsmart.com`. That delegates only
`staging.sportsmart.com` to Terraform's zone; the live site + email are untouched. Wait for it to go live,
then verify (do **NOT** start 5.4 until this returns the 4 AWS nameservers):
```bash
dig +short NS staging.sportsmart.com @8.8.8.8
```
> If you skip ahead, 5.4 just sits at `aws_acm_certificate_validation.wildcard: Still creating…` until the
> delegation propagates (it then completes on its own); it times out after ~75 min if you never delegate.
> Add the `NS` record **before** anything first resolves `staging.sportsmart.com`: a premature query (or an
> early 5.4) makes the parent zone answer `NXDOMAIN`, which ACM's resolvers cache for the parent zone's
> SOA-minimum TTL — so validation can stay stuck *past* the 300s `NS` TTL even after `dig` already shows the
> nameservers. If that happens, wait out the parent SOA TTL; don't cancel and re-apply — ACM recovers on its own.

**5.4 Full apply — everything else (incl. the ALB + ACM cert)**
```bash
terraform apply -var-file=staging.tfvars                            # review plan, type: yes; ~15–20 min
```
This builds (all prefixed `sportsmart-staging`): VPC + public/private subnets + NAT, RDS Postgres 16
(`db.t4g.micro`), ElastiCache Redis (`cache.t4g.micro`), an internet-facing ALB with the
`*.staging.sportsmart.com` ACM cert (now validating against your delegated zone), the ECS cluster, **one ECS
service per app + the internal logistics-facade** (its own ECR repo, a Cloud Map namespace `staging.internal`,
an ECS service + migrate task), the two Secrets Manager secrets, and the GitHub-OIDC deploy role. It also
creates the per-host alias records (`api.staging.sportsmart.com` → ALB, etc.) **inside the delegated zone —
so there is NO separate "add a CNAME" step later.** **ECR repos are empty now — the ECS services stay
PENDING until Phase 7 pushes images. That's expected.**

**5.5 Grab the outputs you need next**
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

## Phase 8 — Register the Razorpay webhook (now that the API URL is live)

The webhook is the **async backstop** (a payment captured even if the customer closed the browser) and the
**dispute / chargeback** channel. Register it once the API is reachable (DNS was delegated back in Phase 5.3;
the API itself comes up after the Phase 7 deploy):

1. Razorpay Dashboard → **Settings → Webhooks → Add New Webhook**.
2. **Webhook URL:** `https://api.staging.sportsmart.com/api/v1/payments/webhooks/razorpay`
3. **Secret:** paste the **exact same** value you stored as `RAZORPAY_WEBHOOK_SECRET` in Phase 4 (this is why
   you generated it yourself — Razorpay doesn't create it).
4. **Active events:** `payment.captured`, `payment.failed`, `payment.authorized`, and the dispute events
   `payment.dispute.created`, `payment.dispute.won`, `payment.dispute.lost`, `payment.dispute.closed`.
5. Save → Razorpay's webhook page (or your first test payment) shows the delivery returning **HTTP 200**.

> Mismatched secret ⇒ endpoint returns **401 "Invalid webhook signature"** and the event is dropped. Secret
> unset on the server ⇒ **401 "Webhook secret not configured on server"** (the API still boots — the secret
> is optional at boot — but the webhook won't function until set on **both** sides). The webhook is **not**
> required to pass Phase 9.2 (the order confirms via the synchronous verify); set it up for production-like
> reconciliation + disputes.

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

**9.3 Admin & payment confirmation** — log in at `https://admin.staging.sportsmart.com` (seed admin) →
**Orders** → your test order shows **CONFIRMED**. This is driven by the **synchronous** payment-verify call
on the success page — **not** the webhook. To separately confirm the **webhook** (Phase 8) works, check
Razorpay Dashboard → Webhooks → your webhook → recent deliveries: a `payment.captured` delivery should show
**200** (proving Razorpay reached the API in the private subnet).

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
| Full `apply` stuck at `aws_acm_certificate_validation … Still creating…` | The `staging` subdomain isn't delegated yet, so ACM can't validate the cert. Add the `NS` record (Phase 5.3) and confirm `dig +short NS staging.sportsmart.com @8.8.8.8` returns the 4 AWS nameservers — the apply then finishes on its own. **Still stuck after `dig` passes?** A premature lookup cached a parent-zone `NXDOMAIN`; wait out the parent zone's SOA-minimum TTL — don't cancel/re-apply, ACM recovers on its own. |
| `apply` fails at the Route 53 **data** lookup ("no matching hosted zone") | `create_hosted_zone=false` (e.g. production) but the zone doesn't exist. Staging sets it `true`, so Terraform creates the zone — see Phase 0.3 / 5.2. |
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
- Production leaves `create_hosted_zone` unset (so it defaults to `false`) and **looks up a pre-existing apex
  `sportsmart.com` Route 53 zone** (`production.tfvars`: `hosted_zone_name = env_domain = "sportsmart.com"`).
  That means a full registrar Name-Server cutover for the whole domain to Route 53 — not a single
  delegated-subdomain `NS` record like staging. Create that apex zone and point the registrar's nameservers at
  it **before** applying production, or the apply fails at the Route 53 data lookup. Because that cutover is
  done out-of-band first, production needs **no** targeted-zone step (`create_hosted_zone=false` means the
  `aws_route53_zone.primary` resource doesn't exist to `-target`): a single
  `terraform apply -var-file=production.tfvars` works, since the zone is already public and ACM can validate
  immediately — covered in the Production playbook.
