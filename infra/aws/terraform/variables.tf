# Phase 1 (2026-06-15) — Terraform root inputs (ECS Fargate target).

variable "region" {
  description = "AWS region (e.g. ap-south-1)."
  type        = string
}

variable "env" {
  description = "Environment slug — staging or production."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.env)
    error_message = "env must be 'staging' or 'production'."
  }
}

variable "node_env" {
  description = <<-EOT
    Value injected as the container's NODE_ENV. Drives the API boot-gate:
    NODE_ENV=production enforces https/CORS hardening + the requiredInProd
    secret list (Razorpay/R2/MFA) + the requiredOnInProd flag list, so the
    process refuses to boot unless they are all set. NODE_ENV=staging boots
    without those external creds — convenient for first bring-up. Set to
    'production' once the external secrets + flags are populated.
  EOT
  type        = string
  default     = "staging"
  validation {
    condition     = contains(["staging", "production"], var.node_env)
    error_message = "node_env must be 'staging' or 'production' (the app's NODE_ENV enum)."
  }
}

variable "hosted_zone_name" {
  description = "Route53 public hosted zone the service hostnames live under (e.g. staging.sportsmart.com). Looked up when create_hosted_zone=false, or created by this module when true. Service records are <subdomain>.<env_domain> inside it."
  type        = string
}

variable "create_hosted_zone" {
  description = <<-EOT
    true  → Terraform creates the Route53 public zone named hosted_zone_name.
            Use for a DELEGATED SUBDOMAIN (e.g. staging.sportsmart.com): after
            the first apply, add its `route53_name_servers` output as an NS
            record in the parent corporate zone to delegate it — the apex zone
            (corporate website, email/MX) is never touched.
    false → the zone already exists and is only looked up (data source);
            registrar/parent delegation was done out-of-band (production apex).
  EOT
  type        = bool
  default     = false
}

variable "env_domain" {
  description = <<-EOT
    Base domain for this environment's service hostnames. Each service is
    published at <subdomain>.<env_domain> (e.g. api.staging.sportsmart.com),
    and a single ACM wildcard cert *.<env_domain> covers them all. Must be a
    subdomain of hosted_zone_name (so the wildcard + DNS validation resolve
    in that zone).
  EOT
  type        = string
}

variable "auth_cookie_domain" {
  description = "Injected as AUTH_COOKIE_DOMAIN so auth cookies are shared across the env's subdomains (e.g. .staging.sportsmart.com). Leading dot intended."
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Container image tag to deploy for every service, e.g. staging-latest or staging-<sha7> (matches deploy.yml's tag scheme). Repos are empty until Phase 2 pushes images; services stay pending until then."
  type        = string
  default     = "staging-latest"
}

variable "vpc_cidr" {
  description = "CIDR block for the env's VPC."
  type        = string
  default     = "10.20.0.0/16"
}

# ── Data stores ─────────────────────────────────────────────────────────

variable "rds_instance_class" {
  description = "RDS Postgres instance class. db.t4g.medium is fine for staging; bump for prod."
  type        = string
  default     = "db.t4g.medium"
}

variable "rds_allocated_storage_gb" {
  description = "RDS allocated storage (GiB). Autoscales up to rds_max_allocated_storage_gb."
  type        = number
  default     = 20
}

variable "rds_max_allocated_storage_gb" {
  description = "RDS storage autoscaling ceiling (GiB)."
  type        = number
  default     = 100
}

variable "rds_multi_az" {
  description = "RDS Multi-AZ. false for staging (cost), true for production (HA)."
  type        = bool
  default     = false
}

variable "rds_backup_retention_days" {
  description = "RDS automated-backup / PITR retention. >=14 recommended for prod (the migration rollback playbook's PITR pre-condition)."
  type        = number
  default     = 7
}

variable "rds_deletion_protection" {
  description = "Block accidental RDS deletion. Leave false for staging, true for prod."
  type        = bool
  default     = false
}

variable "postgres_version" {
  description = "RDS Postgres engine version. Major-only (\"16\") so RDS picks the latest minor and auto_minor_version_upgrade keeps it current without plan drift (engine_version is ignore_changes'd). Matches local docker-compose postgres:16."
  type        = string
  default     = "16"
}

variable "elasticache_node_type" {
  description = "ElastiCache Redis node type."
  type        = string
  default     = "cache.t4g.small"
}

variable "redis_ha" {
  description = "Prod-grade Redis: 2 nodes + automatic failover + multi-AZ + transit encryption (REDIS_URL becomes rediss://). false = single node, plaintext (staging). Redis backs idempotency keys + distributed locks, so production should be true."
  type        = bool
  default     = false
}

variable "nat_per_az" {
  description = "One NAT gateway per AZ (true) vs a single shared NAT (false). Single NAT is a cheaper staging choice but a whole-environment egress SPOF; production should be true."
  type        = bool
  default     = false
}

variable "use_nat_instance" {
  description = "Use a low-cost NAT instance (~$3-4/mo) instead of the managed NAT gateway (~$40/mo) for private-subnet egress. Non-prod cost saving; a single instance has no managed failover, so production should keep this false. Reverting is a one-flag apply (the managed gateway comes back). Ignores nat_per_az when true."
  type        = bool
  default     = false
}

variable "nat_instance_type" {
  description = "EC2 instance type for the NAT instance when use_nat_instance=true (fck-nat arm64 image)."
  type        = string
  default     = "t4g.nano"
}

variable "enable_vpc_endpoints" {
  description = "Create VPC endpoints (S3 gateway + ECR/Secrets Manager/KMS/Logs interface endpoints) so task-startup AWS-API traffic skips the NAT (lower cost + removes NAT from the image-pull/secret-read critical path)."
  type        = bool
  default     = true
}

variable "secret_recovery_window_days" {
  description = "Secrets Manager recovery window. 0 lets a destroyed env be re-applied immediately (staging); 7-30 protects prod from accidental deletion (but blocks rebuild-within-window unless force-deleted)."
  type        = number
  default     = 0
}

variable "service_desired_count" {
  description = "Per-service desired task count override (keyed by service name, e.g. {api=1, web-storefront=1}). Unset services use the catalog default in locals.tf. Lets staging run leaner than prod without editing the shared catalog."
  type        = map(number)
  default     = {}
}

# ── Observability / scaling ─────────────────────────────────────────────

variable "alarm_emails" {
  description = "Email addresses subscribed to the CloudWatch-alarm SNS topic. Empty disables the email subscription (the topic + alarms still exist)."
  type        = list(string)
  default     = []
}

variable "enable_autoscaling" {
  description = "Enable ECS target-tracking autoscaling (CPU) for the api + web-storefront services."
  type        = bool
  default     = true
}

variable "autoscaling_max_count" {
  description = "Max task count for autoscaled services (api, web-storefront)."
  type        = number
  default     = 6
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention (days) for the per-service log groups. Lower for staging to bound cost; keep a longer forensic/audit window in prod."
  type        = number
  default     = 30
}

# ── App config / secrets ────────────────────────────────────────────────

variable "api_extra_environment" {
  description = <<-EOT
    Extra non-secret env vars merged into the API container's `environment`.
    For NODE_ENV=production you MUST include the requiredOnInProd flags, or
    the API refuses to boot:
      CRON_HEARTBEAT_ENABLED, SLA_BREACH_DETECTOR_ENABLED,
      AUDIT_CHAIN_ANCHOR_ENABLED, IDEMPOTENCY_ENABLED,
      INTEGRITY_VERIFIER_ENABLED, ERASURE_PROCESSOR_ENABLED,
      WALLET_LEDGER_RECON_ENABLED, EVENT_DEDUP_ENABLED, OUTBOX_ENABLED,
      OUTBOX_DUAL_WRITE, REFUND_GATEWAY_RECON_ENABLED,
      RETENTION_ENFORCER_ENABLED, ABAC_ENABLED, REFUND_SAGA_ENABLED,
      COD_REFUND_PENDING_ENABLED, MONEY_DUAL_WRITE_ENABLED,
      PERMISSIONS_GUARD_STRICT, RBAC_ORPHAN_SWEEP_ENABLED  (all "true").
  EOT
  type        = map(string)
  default     = {}
}

variable "external_secrets" {
  description = <<-EOT
    Externally-issued secret values that Terraform cannot generate, merged
    into the app Secrets Manager secret on FIRST create only (the secret
    version ignores subsequent changes, so you can also rotate them in the
    console without TF reverting them). Keys consumed by the API boot-gate
    in production: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET, R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY. Leave empty for a staging bring-up (NODE_ENV=staging
    does not require them). Prefer populating these in Secrets Manager directly
    rather than committing them to a .tfvars file.
  EOT
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "db_username" {
  description = "RDS master username. The password is generated by Terraform (random_password) and stored in the app secret."
  type        = string
  default     = "sportsmart_app"
}

variable "db_name" {
  description = "Initial database name created on the RDS instance."
  type        = string
  default     = "sportsmart"
}

# ── Logistics facade (internal service) ─────────────────────────────────

variable "logistics_facade_image_tag" {
  description = "Container image tag for the logistics-facade service + its migrate task (e.g. staging-latest). Kept separate from var.image_tag so the facade rolls independently of the api/web set. The ECR repo is empty until CI pushes; the service stays pending until then."
  type        = string
  default     = "staging-latest"
}

variable "logistics_facade_desired_count" {
  description = "Desired Fargate task count for the internal logistics-facade. Not autoscaled (the autoscaling set is hardcoded); set statically."
  type        = number
  default     = 1
}

variable "logistics_facade_cpu" {
  description = "Fargate CPU units for the logistics-facade task."
  type        = number
  default     = 256
}

variable "logistics_facade_memory" {
  description = "Fargate memory (MiB) for the logistics-facade task."
  type        = number
  default     = 512
}

# ── CI/CD (GitHub Actions OIDC) ─────────────────────────────────────────

variable "github_repo" {
  description = "GitHub repo (owner/name) allowed to assume the deploy role via OIDC. Scopes the role trust (cicd.tf) — a WRONG value makes every GitHub Actions deploy fail at sts:AssumeRoleWithWebIdentity. Must match the real remote (git remote -v)."
  type        = string
  default     = "Jobways03/SPORTSMART_OFFICIAL_MM"
}

variable "github_oidc_provider_arn" {
  description = "ARN of an existing GitHub Actions OIDC provider to reuse. Leave empty to have Terraform create the account-wide provider (only one can exist per account)."
  type        = string
  default     = ""
}
