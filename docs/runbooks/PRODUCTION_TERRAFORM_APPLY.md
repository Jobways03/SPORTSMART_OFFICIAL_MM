# Production Provisioning Checklist — first-ever `terraform apply`

How to stand up the **production** AWS infrastructure and put the apps live on
their subdomains. Run top-to-bottom. Companion docs:
[PRODUCTION_APEX_CUTOVER.md](./PRODUCTION_APEX_CUTOVER.md) (the DNS/Shopify
sequence) and [PRODUCTION_SECRETS_CHECKLIST.md](./PRODUCTION_SECRETS_CHECKLIST.md)
(the keys to paste).

> **What this does:** creates everything in AWS for production (network, database,
> cache, load balancer, HTTPS cert, the app services, secrets) and then the first
> deploy builds + ships the app images. **It does NOT move `sportsmart.com` off
> Shopify** — the apex stays on Shopify until the separate manual DNS flip
> ([cutover Phase 5](./PRODUCTION_APEX_CUTOVER.md)).
> After this checklist, the new platform is live on `shop.`/`api.`/`admin.` etc.

---

## Before you start — gates (all must be true)

- [ ] **You're logged in to AWS as an admin** (the `terraform-admin` user). Check: `aws sts get-caller-identity` shows account **943189351633**. *(These commands use your local admin keys — NOT the GitHub deploy role; that role is only for the deploy pipeline later.)*
- [ ] **State backend exists.** Already created for staging (same account), so **nothing to do**. *(Only if this were a brand-new AWS account: `cd infra/aws/terraform/bootstrap && terraform init && terraform apply -var region=ap-south-1` once.)*
- [ ] **The `sportsmart.com` Route53 zone exists and the registrar's nameservers point to it, and that has propagated.** This comes from [cutover Phases 0–2](./PRODUCTION_APEX_CUTOVER.md). **Verify — this is the hard gate:**
  ```
  dig +short NS sportsmart.com @8.8.8.8        # must return ONLY the 4 AWS (Route53) nameservers
  ```
  If this still shows the old DNS host, **stop** — the apply will hang on the HTTPS-certificate step (ACM validates by reading public DNS).
- [ ] **`production.tfvars` reviewed** — already set for you: `env=production`, `node_env=production`, `serve_apex=true`, `github_repo` correct, `github_oidc_provider_arn` reusing the existing provider. Optional: uncomment `alarm_emails` to get CloudWatch alerts.

---

## The apply (≈15–20 min)

```
cd infra/aws/terraform

# 1. Point Terraform at the PRODUCTION state file.
terraform init -backend-config=production.s3.tfbackend -reconfigure

# 2. Preview (expect a big list of NEW resources, 0 to destroy).
terraform plan -var-file=production.tfvars

# 3. Re-confirm the DNS gate right before applying.
dig +short NS sportsmart.com @8.8.8.8         # only Route53 NS

# 4. Build it. Type "yes" when prompted. (~15–20 min; it pauses on the
#    cert step until DNS validates — that's why the gate above matters.)
terraform apply -var-file=production.tfvars

# 5. Capture outputs you'll need next.
terraform output deploy_role_arn app_secret_external_arn
```

**What gets created:** VPC + subnets + NAT, RDS Postgres, ElastiCache Redis, the
load balancer + HTTPS certificate, the ECS cluster and all app services, the two
secrets (`production/app/generated` filled automatically, `production/app/external`
**empty**), the deploy IAM role, the deploy SSM parameters, and the one-off
migrate + seed tasks.

> **Normal:** right after the apply the app services show **no running tasks /
> "pending"** — there's no image in the registry yet. The first deploy (below)
> pushes the images and they start. Don't panic.

---

## After the apply — make it live (subdomains)

1. [ ] **Paste the production secrets** into `production/app/external` →
   [PRODUCTION_SECRETS_CHECKLIST.md](./PRODUCTION_SECRETS_CHECKLIST.md).
   **Do this BEFORE the deploy below** — under `NODE_ENV=production` the app
   crash-loops until the real keys are present.
2. [ ] **Point the GitHub deploy variable at production.** In the repo's GitHub
   **Settings → Secrets and variables → Actions → Variables**, set:
   - `AWS_DEPLOY_ROLE_ARN` = the `deploy_role_arn` from step 5 above
   - `AWS_REGION` = `ap-south-1`

   Confirm a **`production` environment** exists with a **required reviewer**.
   > ⚠️ **`AWS_DEPLOY_ROLE_ARN` is a single shared repo variable**, but staging and
   > production have **separate** deploy roles. Point it at the **production** role
   > for production deploys; switch it back to the staging role for staging
   > deploys. *(Cleaner long-term fix: make `deploy.yml` pick the role from
   > `inputs.target` — small change, worth doing if you deploy both often.)*
3. [ ] **Run the first production deploy** (the migrations apply automatically here,
   including the admin-MFA one):
   ```
   gh workflow run deploy.yml -f target=production -f services=all -f run_seed=true
   ```
   Then **approve** it in the `production` environment when GitHub prompts. It
   builds the images, runs the DB migration, seeds reference data once, rolls all
   services, and smoke-tests them.
4. [ ] **Verify:**
   ```
   curl -fsS https://api.sportsmart.com/api/v1/health/ready     # expect HTTP 200
   ```
   Open `https://shop.sportsmart.com` and `https://admin.sportsmart.com`; do one
   **live** Razorpay test transaction.

At this point the platform is live on its subdomains. **`sportsmart.com` itself is
still Shopify** until the manual apex flip in
[cutover Phase 5](./PRODUCTION_APEX_CUTOVER.md).

---

## Quick gotcha list
- **Cert step hangs?** Route53 isn't authoritative yet — re-check the `dig NS` gate.
- **App won't start / crash-loops?** A required key in `production/app/external` is missing or still a placeholder, or one of the 18 prod flags isn't set (they're already in `production.tfvars`).
- **Changed an env var / flag and nothing happened?** Env/flag changes need a fresh `terraform apply` — a bare redeploy reuses the old settings.
- **`run_seed=true`** only on this very first deploy (it loads admin/roles/tax reference data once); use `false` afterward.
- **Rollback of this provisioning** isn't a "revert" — it's `terraform destroy` (heavy). The apex DNS flip, by contrast, is the cheap/instant rollback and is a separate step.
