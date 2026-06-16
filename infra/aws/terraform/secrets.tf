# App secrets, split into two Secrets Manager secrets so operator-managed
# external creds are never clobbered by `terraform apply`:
#
#   <env>/app/generated  — TF owns it: DB/Redis URLs (composed from the RDS
#                          + ElastiCache outputs) and the JWT/encryption
#                          secrets (generated here). TF is the source of truth.
#   <env>/app/external   — operator owns it: Razorpay + R2 creds. Created once
#                          with placeholders (or var.external_secrets), then
#                          ignore_changes so you can rotate them in the console.
#
# Both are referenced key-by-key by the API task def (ecs.tf). All values are
# in Terraform state — that is why the S3 backend is encrypted (backend.tf).

# ── KMS CMK for the secrets ─────────────────────────────────────────────
resource "aws_kms_key" "secrets" {
  description             = "${local.name} app secrets"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = { Name = "${local.name}-secrets" }
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${local.name}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

# ── Generated values ────────────────────────────────────────────────────
resource "random_password" "db" {
  length  = 32
  special = false # keep it URL-safe so DATABASE_URL needs no escaping
}

resource "random_password" "jwt" {
  for_each = toset([
    "JWT_CUSTOMER_SECRET",
    "JWT_SELLER_SECRET",
    "JWT_FRANCHISE_SECRET",
    "JWT_ADMIN_SECRET",
    "JWT_AFFILIATE_SECRET",
    "JWT_REFRESH_SECRET",
  ])
  length  = 48 # >= 32-char boot-gate floor, distinct per actor
  special = false
}

# AES-256 keys as 64 hex chars (matches the .env.example "32-byte hex" format).
resource "random_id" "aes" {
  for_each    = toset(["AFFILIATE_ENCRYPTION_KEY", "ADMIN_MFA_ENCRYPTION_KEY"])
  byte_length = 32
}

locals {
  database_url = "postgresql://${var.db_username}:${random_password.db.result}@${aws_db_instance.main.address}:5432/${var.db_name}?schema=public&sslmode=require&connection_limit=10&pool_timeout=20"

  generated_secret_values = merge(
    {
      DATABASE_URL = local.database_url
      DIRECT_URL   = local.database_url
      REDIS_URL    = "${var.redis_ha ? "rediss" : "redis"}://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"

      AFFILIATE_ENCRYPTION_KEY = random_id.aes["AFFILIATE_ENCRYPTION_KEY"].hex
      ADMIN_MFA_ENCRYPTION_KEY = random_id.aes["ADMIN_MFA_ENCRYPTION_KEY"].hex
    },
    { for k, v in random_password.jwt : k => v.result },
  )

  # External creds: placeholder ("") unless supplied via var.external_secrets.
  external_secret_values = { for k in local.external_secret_keys : k => lookup(var.external_secrets, k, "") }
}

# ── TF-managed secret (generated) ───────────────────────────────────────
resource "aws_secretsmanager_secret" "generated" {
  name                    = "${var.env}/app/generated"
  description             = "${local.name} TF-generated app secrets (DB/Redis URLs, JWT, encryption keys)"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = var.secret_recovery_window_days
  tags                    = { Name = "${local.name}-generated" }
}

resource "aws_secretsmanager_secret_version" "generated" {
  secret_id     = aws_secretsmanager_secret.generated.id
  secret_string = jsonencode(local.generated_secret_values)
}

# ── Operator-managed secret (external) ──────────────────────────────────
resource "aws_secretsmanager_secret" "external" {
  name                    = "${var.env}/app/external"
  description             = "${local.name} operator-managed external creds (Razorpay, R2). Rotate in console; TF does not revert."
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = var.secret_recovery_window_days
  tags                    = { Name = "${local.name}-external" }
}

resource "aws_secretsmanager_secret_version" "external" {
  secret_id     = aws_secretsmanager_secret.external.id
  secret_string = jsonencode(local.external_secret_values)

  # Operator owns these post-create (fill Razorpay/R2 in the console). Do not
  # let a later apply revert their edits back to the placeholders.
  lifecycle {
    ignore_changes = [secret_string]
  }
}
