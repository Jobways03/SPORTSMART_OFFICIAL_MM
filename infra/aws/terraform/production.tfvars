# Production inputs. Apply with:
#   terraform init -backend-config=production.s3.tfbackend -reconfigure
#   terraform apply -var-file=production.tfvars
#
# Before applying:
#   1. Populate the operator secret (Razorpay + R2) — either via
#      `external_secrets` here (NOT recommended to commit) or, preferred,
#      edit the <env>/app/external secret in the console after first apply.
#   2. node_env=production makes the API boot-gate REQUIRE those creds AND
#      the requiredOnInProd flags below — boot fails otherwise.

region   = "ap-south-1"
env      = "production"
node_env = "production"

hosted_zone_name   = "sportsmart.com"
env_domain         = "sportsmart.com"
auth_cookie_domain = ".sportsmart.com"

# OIDC deploy-role trust — MUST equal the real GitHub remote, else every
# Actions deploy fails at AssumeRole.
github_repo = "Jobways03/SPORTSMART_OFFICIAL_MM"

# Public Google OAuth Web Client ID for storefront "Sign in with Google" — baked
# into the web build (NEXT_PUBLIC_GOOGLE_CLIENT_ID) + used by the API as the
# ID-token verify audience (GOOGLE_CLIENT_ID). Public value, safe to commit; the
# one client's Authorized JS origins cover localhost/staging/prod.
google_client_id = "187571482262-6e2u007g6n8ctlsrsvnti8ng5ruta1et.apps.googleusercontent.com"

# Outbound email — support@sportsmart.com (cPanel webmail). The login + password
# (MAIL_USER / MAIL_PASS) live in the production/app/external secret, not here.
# ⚠️ CONFIRM the exact host from cPanel → Email Accounts → Connect Devices (the
# SSL/TLS settings): mail.sportsmart.com is the usual cPanel value, but the TLS
# cert is often issued for the server's own hostname — use whatever cPanel lists
# to avoid a cert mismatch on port 465.
mail_host   = "mail.sportsmart.com"
mail_port   = 465
mail_secure = "true"
mail_from   = "Sportsmart <support@sportsmart.com>"
# cPanel/GoDaddy shared cert (*.prod.phx3.secureserver.net) doesn't match
# mail.sportsmart.com, so skip TLS hostname verification (still encrypted).
mail_tls_reject_unauthorized = "false"

image_tag                  = "production-latest"
logistics_facade_image_tag = "production-latest"

# COST-LEAN production sizing (~$210/mo). Provisioned for a low-traffic MVP,
# NOT an uptime SLA. Every resilience buy-back (Multi-AZ, Redis HA, per-AZ NAT,
# bigger instances) is a single-line flip below — re-enable as traffic/revenue
# justify. See docs/runbooks/aws-cost-estimate.md.
#
# Single-AZ Postgres: no automatic failover (an AZ/instance failure or routine
# maintenance is a downtime window). PITR backups stay on — keep the 14-day
# window (the migration-rollback playbook's pre-condition); data durability is
# unaffected, only availability drops. db.t4g.small (burstable 2 vCPU / 2 GB)
# is the floor — if CPUCreditBalance depletes under load, step up to
# db.t4g.medium before reaching for Multi-AZ.
rds_instance_class           = "db.t4g.small"
rds_multi_az                 = false
rds_backup_retention_days    = 14
rds_deletion_protection      = true
rds_max_allocated_storage_gb = 100
elasticache_node_type        = "cache.t4g.small"

# Single-node Redis (redis_ha=false): no failover, and transit TLS turns OFF
# (REDIS_URL becomes redis:// — safe, Redis is reachable only from Fargate in
# the private subnets). Redis backs locks/idempotency/throttler/SSE and /ready
# folds it in, so a node failure is an API-unavailability window until
# ElastiCache replaces it. Watch the redis-memory alarm (noeviction policy).
redis_ha = false

# Single shared NAT (egress SPOF) + VPC interface endpoints OFF. At MVP traffic
# the 5 interface endpoints (~$95/mo) cost far more than the NAT data they
# would save, so ECR/Secrets/KMS/Logs egress falls back through the one NAT —
# which also puts it on the task-launch critical path. Re-enable
# (nat_per_az=true, enable_vpc_endpoints=true) when egress/deploy volume grows.
nat_per_az           = false
enable_vpc_endpoints = false

# 30-day secret recovery window (prod safety).
secret_recovery_window_days = 30

# Keep api + customer storefront at 2 tasks (rolling deploys + crash
# redundancy), admin storefront at 1, and spin the 8 seldom-hit seller/
# franchise/affiliate portals to 0 — scale on demand:
#   aws ecs update-service --cluster sportsmart-production --service <svc> --desired-count 1
# 13 always-on tasks -> 5; autoscale burst capped at 3 (api + web-storefront).
service_desired_count = {
  api                     = 2
  web-storefront          = 2
  web-admin-storefront    = 1
  web-d2c-seller          = 0
  web-d2c-seller-admin    = 0
  web-retail-seller       = 0
  web-retail-seller-admin = 0
  web-franchise           = 0
  web-franchise-admin     = 0
  web-affiliate           = 0
  web-affiliate-admin     = 0
}
autoscaling_max_count = 3

# 14-day log retention — enough prod forensic depth, bounded cost.
log_retention_days = 14

# Wire real alerting before go-live.
# alarm_emails = ["oncall@sportsmart.com"]

# requiredOnInProd flags — the API refuses to boot in production unless every
# one of these is "true" (apps/api/src/bootstrap/env/env.schema.ts). Flip the
# outbox/money pair in order ENABLED -> DUAL_WRITE -> AUTHORITATIVE per the
# money-paise cutover runbook before treating prod as authoritative.
api_extra_environment = {
  CRON_HEARTBEAT_ENABLED       = "true"
  SLA_BREACH_DETECTOR_ENABLED  = "true"
  AUDIT_CHAIN_ANCHOR_ENABLED   = "true"
  IDEMPOTENCY_ENABLED          = "true"
  INTEGRITY_VERIFIER_ENABLED   = "true"
  ERASURE_PROCESSOR_ENABLED    = "true"
  WALLET_LEDGER_RECON_ENABLED  = "true"
  EVENT_DEDUP_ENABLED          = "true"
  OUTBOX_ENABLED               = "true"
  OUTBOX_DUAL_WRITE            = "true"
  REFUND_GATEWAY_RECON_ENABLED = "true"
  RETENTION_ENFORCER_ENABLED   = "true"
  ABAC_ENABLED                 = "true"
  REFUND_SAGA_ENABLED          = "true"
  COD_REFUND_PENDING_ENABLED   = "true"
  MONEY_DUAL_WRITE_ENABLED     = "true"
  PERMISSIONS_GUARD_STRICT     = "true"
  RBAC_ORPHAN_SWEEP_ENABLED    = "true"
}
