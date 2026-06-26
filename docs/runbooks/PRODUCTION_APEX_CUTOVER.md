# Production Apex Cutover — `sportsmart.com`

Serve the **new platform** at the apex `sportsmart.com`; relocate the existing
**Shopify** store to `classic.sportsmart.com`. **Clean launch — no catalog and no
customer data are migrated from Shopify.** The old store keeps all its data and
simply lives on at `classic.sportsmart.com`.

This runbook assumes the repo prep on branch `feat/prod-apex-cutover-prep` is
merged. Email and the store must stay up throughout.

---

## A. What the prep branch already changed (code-done — no prod-day work)

| Area | Change | Files |
|---|---|---|
| **Apex serving** (gated `var.serve_apex`, default false; **`true` only in `production.tfvars`** so staging is untouched) | apex added as ACM **SAN** (`*.sportsmart.com` does not cover the bare apex; `www` is covered by the wildcard); validation `for_each` rekeyed to the record name to dedup the shared apex/wildcard CNAME; apex host-header listener rule → `web-storefront` TG; `www`→apex 301 rule; apex+www **A and AAAA** alias to the (dual-stack) ALB; apex+www added to `CORS_ORIGINS` | `infra/aws/terraform/{variables,alb,locals,production.tfvars}.tf`, new `apex.tf` |
| **Storefront canonical URL** (was `http://localhost:4005` in prod — SEO bug) | `NEXT_PUBLIC_STOREFRONT_URL` now baked at build time per env (apex in prod, `shop.<env>` otherwise) via a new SSM param | `locals.tf`, `migrate.tf`, `outputs.tf`, `Dockerfile.web`, `.github/workflows/deploy.yml` |
| **Deferred admin-MFA + step-up migrations** (unrelated to Shopify — real platform debt) | additive `ADD COLUMN IF NOT EXISTS` migration for the 8 `admins` MFA columns + `admin_sessions.step_up_verified_at`; `prisma generate` + removal of the `as any` casts | `apps/api/prisma/schema/migrations/20260626120000_add_admin_mfa_and_step_up/`, admin-mfa code |

`auth_cookie_domain=".sportsmart.com"` already covers the apex; `NEXT_PUBLIC_API_URL=https://api.sportsmart.com` is unchanged.

> **Not included (clean launch):** no Shopify catalog import, no customer import,
> no `mustResetPassword`, no Shopify→platform 301 redirect map. Old inbound links
> to `sportsmart.com/products/...` will **404** on the new platform (the catalog
> is different). If that link equity matters, add a host/path redirect to
> `classic.sportsmart.com` — decide in Phase 6 (optional, not built).

---

## B. Prerequisites
- Tools: Terraform ≥1.6, AWS CLI v2, `gh`, Docker, `dig`, `openssl`, `jq`.
- AWS: `terraform-admin` access; region `ap-south-1`.
- The `sportsmart.com` Route53 hosted zone must **pre-exist** before
  `terraform apply` (`create_hosted_zone` stays `false`). **Never set it `true`** —
  that mints a new empty zone with no MX.
- Repo vars: `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION` (repository-level). `production`
  GitHub environment with required reviewers.
- LIVE creds procured (Razorpay / R2 / Delhivery) — paste into Secrets Manager in Phase 3.
- ⚠️ **Sign-offs not started** — §194-O TDS (finance/legal) + CA money-paise. These
  gate treating prod as *authoritative* and are the calendar long-pole; start now.

---

## Phase 0 — Discovery (read-only; store & email untouched)
- [ ] Identify the current DNS host + registrar for `sportsmart.com`; confirm Shopify + registrar + AWS access.
- [ ] Export EVERY record: A/AAAA/CNAME/MX/TXT(SPF,DKIM,DMARC)/CAA/SRV/NS.
- [ ] **DNSSEC check (catastrophic if missed):** `dig DS sportsmart.com +short` and check the registrar. If signed, a NS flip to Route53 → DS mismatch → **SERVFAIL = total web + email outage.** If signed: remove the DS at the registrar, wait the DS TTL, *then* migrate; re-enable Route53 DNSSEC only after soak.
- [ ] **CAA audit:** the target CAA must allow **both** `amazon.com` (ACM) **and** `letsencrypt.org` (Shopify's cert for `classic`). A copy-exact of a restrictive CAA silently blocks one issuer.
- [ ] **Enumerate every email-auth record:** MX, single SPF TXT, provider DKIM (M365 = `selector1/2._domainkey` CNAMEs; Google = `google._domainkey` TXT), any transactional-relay DKIM/return-path, `_dmarc`, all verification TXT tokens.

## Phase 0.5 — Lower TTLs at the *current* provider (untouched answers)
- [ ] In the **current** zone, set TTL = 60s on apex `A`, `www`, **and `MX`**, 24–48h before the NS flip.
- [ ] If DNSSEC present: remove the DS at the registrar now; wait the DS TTL.

## Phase 1 — Move Shopify to `classic` (store stays on apex)
- [ ] Shopify admin → Settings → Domains → **Connect existing domain → Connect MANUALLY** for `classic.sportsmart.com` (never "Transfer", never "Connect automatically").
- [ ] Add `CNAME classic → shops.myshopify.com` in the **current** DNS; verify `https://classic.sportsmart.com` serves with a valid cert.
- [ ] **Keep apex PRIMARY on Shopify** — do NOT set `classic` primary yet (that 301s apex→classic for the whole soak).

## Phase 2 — Migrate DNS authority to Route53, zero answer change
Operator-owned, **outside** the platform Terraform.
- [ ] Create the `sportsmart.com` public hosted zone in Route53.
- [ ] Replicate every record byte-identical, with: apex `A` → the **current live Shopify IP** (`dig +short sportsmart.com`); exactly **one** SPF TXT (Route53 re-chunks long TXT — verify); corrected CAA (both issuers); **exclude** the old apex `NS`/`SOA` (Route53 makes its own — read its 4 NS); apex/`www`/`MX` TTL = 60s; lower the Route53 **SOA negative-cache TTL** to ~60s.
- [ ] **Verify against the Route53 NS *before* the flip:** `dig @ns-XXX.awsdns-YY.net MX/TXT/A sportsmart.com` matches the live zone.
- [ ] Change registrar NS → the 4 Route53 NS. Expect a **dual-authority window up to 48h** (`.com` delegation TTL); keep both zones identical until it closes.
- [ ] Re-verify: `dig @8.8.8.8 NS` returns only Route53; email flows; Shopify still serves apex + classic.

## Phase 3 — App production prereqs (store & email untouched)
- [ ] Populate `production/app/external` with the LIVE creds (Razorpay, R2 incl `R2_PUBLIC_BASE_URL`, MAIL, DELHIVERY prod host `track.delhivery.com`). **Placeholders crash-loop under `node_env=production`.**
- [ ] Rotate leaked creds; wire `alarm_emails`.
- [ ] Money-paise cutover order (ENABLED→DUAL_WRITE→AUTHORITATIVE); §194-O + CA sign-offs.
- [ ] (Admin MFA + step-up migrations apply automatically via the migrate task — no manual step; they're committed in this branch.)
- [ ] Decide HA: `redis_ha`/`rds_multi_az`/`nat_per_az` are `false` (cost-lean) — single-AZ DB + single-node Redis = downtime windows. (Per the current decision, leaving lean.)

## Phase 4 — Provision + deploy subdomains only (apex still Shopify)
**Gate:** don't start until `dig @8.8.8.8 NS sportsmart.com` returns only Route53 — `aws_acm_certificate_validation` **blocks the apply** (up to 72h) against a stale provider.
```
cd infra/aws/terraform
terraform init -backend-config=production.s3.tfbackend -reconfigure
terraform apply -var-file=production.tfvars
gh workflow run deploy.yml -f target=production -f services=all -f run_seed=true   # approve in prod env
```
- [ ] Validate `shop.`/`api.`(`/health/ready` 200)/`admin.` + facade + a LIVE Razorpay test txn. Shopify still serves the apex.
- [ ] `noindex` `shop.sportsmart.com` during the soak (it duplicates the coming apex catalog).

## Phase 5 — Apex go-live: **DNS-first, remove-from-Shopify-LAST**
1. [ ] Confirm `classic` is live with valid SSL.
2. [ ] `terraform apply -var-file=production.tfvars` lands the apex SAN + listener rules + alias + CORS (`serve_apex=true`; new API task-def revision). Confirm the new cert is ISSUED and covers the apex.
3. [ ] **Prove the ALB serves the apex before any DNS change** (until the rule exists the listener default is a 404): `curl -I --resolve sportsmart.com:443:<ALB_IP> https://sportsmart.com/` → storefront 200 + valid cert.
4. [ ] Flip Route53 apex `A` **and `AAAA`** Shopify IP → ALB alias; repoint `www` (60s TTL).
5. [ ] Set `classic` PRIMARY on Shopify (only now).
6. [ ] **Leave `sportsmart.com` + `www` ADDED in Shopify** (DNS points away → Shopify out of path, but its cert stays warm for fast rollback). Removal is Phase 6.
7. [ ] Keep apex **HSTS max-age short / no preload** until decommission.
8. [ ] **Manually curl the apex** — the smoke gate only covers subdomains.

## Phase 6 — Soak & decommission
- [ ] Soak with short HSTS; keep `classic` as a fallback ops URL.
- [ ] 301 `shop.` → apex; drop the soak `noindex` on apex; keep `classic` noindex/canonical→? to avoid duplicate content.
- [ ] **Optional SEO:** if old `sportsmart.com/...` inbound links matter, add a redirect from old paths to `classic.sportsmart.com` (the new catalog can't satisfy them) — decide and build separately.
- [ ] Re-implement analytics/pixels fresh on the new platform.
- [ ] Only after soak: remove `sportsmart.com` + `www` from Shopify; re-enable Route53 DNSSEC. Keep Shopify admin/billing to fulfill pre-cutover orders + the returns window; gift cards / store credit stay on Shopify (not migrated).

---

## Rollback (apex)
Revert the Route53 apex `A` + `AAAA` back to the Shopify IP (60s TTL → minutes). Works **only because** apex was kept in Shopify (warm cert). The platform stays up on its subdomains regardless.

## Top landmines
1. **DNSSEC** not removed before the NS flip → SERVFAIL total outage.
2. **Email auth** mis-replicated (single SPF, provider DKIM CNAMEs, DMARC, return-path) → broken mail.
3. **CAA** must allow Amazon *and* Shopify's CA simultaneously.
4. **ACM apply blocks** unless Route53 is authoritative first.
5. **Wildcard ≠ apex** — the `sportsmart.com` SAN is mandatory (handled in `alb.tf`).
6. **Cutover order** — DNS-first, Shopify-removal-last.
7. **`create_hosted_zone=true`** would mint a new empty zone (no MX) — keep it `false`.
8. **Placeholder secrets** crash-loop under `node_env=production`.
9. **Single-AZ RDS + single-node Redis** = downtime windows for a revenue store.
