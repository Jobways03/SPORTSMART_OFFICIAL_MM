# SportsMart — Staging Deployment Playbook (corrected)

**Audience:** Dev/Ops, little-to-no prior AWS experience
**Environment:** Staging (`*.staging.sportsmart.com`)
**Outcome:** all frontends + the API + the logistics-facade running on AWS ECS Fargate
**Time:** ~2–3 hours (most of it waiting on Terraform + the deploy workflow)

This is the repo-accurate replacement for the original "Manus AI" playbook. It is
checked against the actual Terraform / CI in `infra/aws/terraform`, `.github/workflows/deploy.yml`
and `infra/scripts/deploy.sh`. Where a step can only be confirmed by a real
`terraform apply` (not possible to verify offline), it is marked **[verify on first run]**.

---

## What changed vs. the original Manus playbook (read this first)

The original playbook was written against an assumed setup and is wrong in several
places that would break the deploy. Corrections, all already applied in the code:

| Original said | Reality / corrected |
|---|---|
| Deploy branch `main` | The infra + app fixes must actually be **on the branch you deploy** (currently they live on `sd001`). Merge first — see Phase 0. |
| GitHub Action "Deploy to ECS" | Workflow is now named **`Deploy to ECS`** ✅ |
| Set var `AWS_ROLE_ARN` on the **staging environment** | Set it as a **repository variable** (the `prep` job has no environment and can't read environment vars). Either `AWS_ROLE_ARN` **or** `AWS_DEPLOY_ROLE_ARN` works. |
| Health returns `{"status":"ok"}` | It returns **HTTP 200** with `{"status":"healthy"}` (or `"degraded"`/503). Check the **200**, not the body. |
| (no logistics-facade) | The facade is now wired as an **internal** service (Cloud Map, port 4100). It deploys with `all` and migrates itself — **no separate database step**. |
| (nothing on the facade DB) | The facade uses a `logistics` **schema** inside the main `sportsmart` DB; its migrate task creates the schema automatically. |

**Known offline-unverifiable items** (need a real apply to confirm — low risk, but check the
first run): the API container booting on linux/amd64 (Prisma engine load), the ECS↔Cloud Map
service-discovery binding + the API resolving `logistics-facade.staging.internal`, and the
facade migrate task's `CREATE SCHEMA` + `prisma migrate deploy`. Watch the first deploy's logs.

---

## Phase 0 — Prerequisite: the code must be on your deploy branch

The deploy workflow builds and ships **whatever branch you run it from** (Phase 7). The
real infrastructure (`infra/aws/terraform/*`), the wired `deploy.sh`, the deploy workflow,
the API boot fix, and the logistics-facade wiring currently live on branch **`sd001`**, not
`main`.

Before deploying:

1. Reconcile and merge `sd001` into the branch you'll deploy (normally `main`):
   ```bash
   git checkout main && git pull          # get main current with origin
   git merge sd001                         # bring in the infra + app work
   git push
   ```
   (Or deploy directly from `sd001` in Phase 7 — the workflow accepts any branch.)
2. Confirm the branch has the infra: `git ls-files infra/aws/terraform/ecs.tf` should print the path.

> If you skip this, `terraform apply` runs an empty module and the deploy script exits 1 — nothing is provisioned.

---

## Phase 1 — AWS account & admin (skip if already done)

1. Create the AWS account (root user), enable **MFA** on the root user, then stop using it.
2. In **IAM → Users → Create user**, create `terraform-admin`, attach **AdministratorAccess**.
3. Create an **access key** (type: CLI) and download the `.csv`. You need the **Access Key ID**
   (starts `AKIA…`) and the **40-character Secret Access Key**.

---

## Phase 2 — Local tools

### 2.1 AWS CLI

```bash
aws configure
```
Enter the **Access Key ID** and the **full 40-char Secret** from the `.csv`, region `ap-south-1`,
output `json`.

> **Gotcha (we hit this):** Terraform reads `~/.aws/credentials` directly. If you used `aws login`
> or a partial paste, that file can end up missing `aws_access_key_id` and Terraform fails with
> *"partial credentials found for profile default."* Verify both lines are present:
> ```bash
> grep -E 'aws_access_key_id|aws_secret_access_key' ~/.aws/credentials
> aws sts get-caller-identity     # must print your terraform-admin ARN
> ```

### 2.2 Terraform

Install Terraform ≥ 1.6, confirm `terraform -version`.

### 2.3 Clone

```bash
git clone https://github.com/Jobways03/SPORTSMART_OFFICIAL_MM.git
cd SPORTSMART_OFFICIAL_MM
git checkout main          # the branch you merged in Phase 0
```

---

## Phase 3 — Bootstrap the Terraform state backend (skip if already done)

```bash
cd infra/aws/terraform/bootstrap
terraform init
terraform apply -var region=ap-south-1     # type yes
```
Creates the S3 state bucket `sportsmart-tfstate` and DynamoDB lock table `sportsmart-tflock`.

---

## Phase 4 — Staging external secrets (Razorpay TEST + Cloudflare R2)

Only the **operator-owned** creds go here; the DB/Redis/JWT secrets **and the facade's
`INTERNAL_API_KEY` / `LOGISTICS_DATABASE_URL` / `LOGISTICS_REDIS_URL` are generated by Terraform**
— do **not** add those by hand.

In **Secrets Manager → Store a new secret → Other type of secret**, add these exact keys:

```
RAZORPAY_KEY_ID          rzp_test_…        (TEST key)
RAZORPAY_KEY_SECRET      …                 (TEST secret)
RAZORPAY_WEBHOOK_SECRET  …                 (staging webhook secret)
R2_ACCOUNT_ID            …
R2_BUCKET                …                 (staging bucket)
R2_ACCESS_KEY_ID         …
R2_SECRET_ACCESS_KEY     …
```

Secret name: **exactly** `staging/app/external`. Store.

> The Terraform creates this secret with empty placeholders on first apply (and then
> `ignore_changes`-es it). You can either create it now, or let `apply` create it and fill the
> values in the console afterward. The API only *requires* these when `node_env=production`; in
> staging it boots without them, but **online payments + media uploads won't work until they're set.**

---

## Phase 5 — Provision the staging infrastructure

```bash
cd infra/aws/terraform                                   # up one level from bootstrap
terraform init -backend-config=staging.s3.tfbackend -reconfigure
terraform apply -var-file=staging.tfvars                 # type yes; ~15–20 min
```

This builds: VPC + public/private subnets, RDS Postgres 16, ElastiCache Redis, an
internet-facing ALB with the `*.staging.sportsmart.com` ACM cert, the ECS cluster, one ECS
service per frontend + the API, **and the internal logistics-facade** (its ECR repo, a Cloud
Map private-DNS namespace `staging.internal`, its ECS service + migrate task). ECR repos are
empty until Phase 7 — services stay **PENDING** until images are pushed; that's expected.

**Prerequisite:** a **Route 53 public hosted zone for `sportsmart.com`** must already exist in
this account, or `apply` fails at plan time (the ALB cert + DNS records reference it).

When it finishes, grab two outputs you'll need next:
```bash
terraform output deploy_role_arn        # → Phase 6
terraform output logistics_facade_internal_url   # informational: http://logistics-facade.staging.internal:4100
```

---

## Phase 6 — GitHub configuration (OIDC)

The deploy workflow authenticates to AWS via GitHub OIDC — no static keys in GitHub.

### 6.1 Create the environments

**Settings → Environments → New environment** → create `staging` (and `production`). Staging needs
no protection rules; on `production` add **required reviewers** later. (The build + rollout jobs
reference `environment: <target>`, so the environment must exist.)

### 6.2 Set the variables — at the **repository** level

**Settings → Secrets and variables → Actions → Variables → New repository variable** (NOT an
environment variable — the `prep` job has no environment and must read these):

```
AWS_REGION      = ap-south-1
AWS_ROLE_ARN    = <paste `terraform output deploy_role_arn`>
```
> The workflow accepts either `AWS_ROLE_ARN` or `AWS_DEPLOY_ROLE_ARN` — use whichever; `AWS_ROLE_ARN`
> matches this playbook.

---

## Phase 7 — First deployment

**Actions tab → `Deploy to ECS` → Run workflow:**

- **Use workflow from:** your deploy branch (e.g. `main`)
- **target:** `staging`
- **services:** `all` (default — includes every frontend, the API, and the logistics-facade)
- **Run … seed:** toggle **true** (first boot — loads admin/ABAC/SLA/tax reference data)

Run it. The run goes **Prep → Build (matrix: API + 10 web apps + logistics-facade → ECR) →
Rollout** (`deploy.sh`: API migrate → optional seed → facade schema+migrate → roll every service
and wait for stability). ~20–30 min.

> **Order matters:** Terraform (Phase 5) must have run first — the workflow only *rolls* services
> that already exist; it doesn't create them.

**Watch on the first run [verify on first run]:** the API task reaching `healthy` (Prisma engine
loads on linux), and the `logistics-facade-migrate` task exiting 0 (it runs
`CREATE SCHEMA IF NOT EXISTS logistics` then `prisma migrate deploy`). Both surface in CloudWatch
under `/ecs/sportsmart-staging/…`.

---

## Phase 8 — DNS (GoDaddy)

In GoDaddy DNS for `sportsmart.com`, **without touching the Name Servers**, add a record:

```
Type: CNAME   Host: *.staging   Value: <the ALB DNS name>   TTL: 1 hour
```

Get the ALB DNS name from **EC2 → Load Balancers → `sportsmart-staging` → DNS name** (e.g.
`sportsmart-staging-123456.ap-south-1.elb.amazonaws.com`). Your live site stays untouched.

---

## Phase 9 — Validation checklist

Wait 15–30 min for DNS to propagate, then verify every item.

### 1. Health & TLS
- `https://api.staging.sportsmart.com/api/v1/health/ready` → **HTTP 200**, body
  `{"success":true,"status":"healthy",…}`. **Check for 200 and `status:"healthy"`** — not `"ok"`.
- `https://shop.staging.sportsmart.com` loads.
- Padlock shows a valid `*.staging.sportsmart.com` certificate.

### 2. Customer & payment flow
- Register a test customer → add to cart → checkout. Razorpay must show **Test Mode**; pay with a
  test card (e.g. Visa `4111 1111 1111 1111`) → order-success page. *(Requires Razorpay TEST keys
  in `staging/app/external` from Phase 4.)*

### 3. Admin & order processing
- Log in to `https://admin.staging.sportsmart.com` (seed admin) → **Orders** → the test order shows
  **CONFIRMED** (proves the Razorpay webhook reached the private subnet).

### 4. Logistics-facade (internal — validated through the admin, not a public URL)
- In the admin, open **Logistics Partners** (Sellers → Logistics, or the seller-admin portal's
  Logistics panel). The partner list (DELHIVERY / SHADOWFAX) must load.
- **Why this is the test:** the facade has **no public URL** — it's reached only inside the VPC via
  Cloud Map. A loaded partner list proves API → facade connectivity (Cloud Map DNS + the
  ecs-to-ecs security-group rule on 4100) works. *"Could not load partners" = the API can't reach
  the facade — check the facade ECS service is RUNNING and the Cloud Map service is healthy.*
- (Shipment/return persistence uses the facade's `logistics` schema; partner listing does not, so
  this passes even if you skip exercising shipment features.)

### 5. Seller-portal scale-up (staging runs these at 0 tasks to save money)
```bash
aws ecs update-service --cluster sportsmart-staging --service web-d2c-seller --desired-count 1
# wait ~60s, open https://d2c-seller.staging.sportsmart.com — it should load
aws ecs update-service --cluster sportsmart-staging --service web-d2c-seller --desired-count 0
```

When all pass, staging is validated.

---

## Troubleshooting quick-reference

| Symptom | Likely cause / fix |
|---|---|
| `terraform apply` → "partial credentials" | `~/.aws/credentials` missing the access-key-id — re-run `aws configure` (Phase 2.1 gotcha). |
| OIDC / AssumeRole fails in the `prep` job | Role var set as an *environment* variable, not *repository* (Phase 6.2). |
| Deploy fails at the facade migrate | `CREATE SCHEMA` / `prisma migrate` error — check `/ecs/sportsmart-staging/logistics-facade-migrate` logs. |
| Admin "Could not load partners" | Facade service not RUNNING, or Cloud Map / SG-4100 not wired — check the `logistics-facade` ECS service. |
| API task crash-looping | Read `/ecs/sportsmart-staging/api`; a missing required env/secret fails the boot-gate fast. |
| Online payment / image upload broken | `staging/app/external` (Razorpay TEST / R2) not populated (Phase 4). |

---

## Notes for the Production playbook (later)
- `production.tfvars` sets `node_env=production` → the API boot-gate **requires** the external
  secrets + the `requiredOnInProd` flags, and the **facade requires real `SHADOWFAX_*`/`DELHIVERY_*`
  partner creds** (its strict prod schema rejects placeholders). Provision those before a prod
  facade deploy or the facade crash-loops.
- Production uses `production-latest` image tags + required-reviewer gates on the `production`
  environment.
