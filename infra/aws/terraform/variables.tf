# Phase 9 (2026-05-16) — Terraform root inputs.

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

variable "domain" {
  description = "Apex domain served from this environment (e.g. sportsmart.com)."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the env's VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "rds_instance_class" {
  description = "RDS Postgres instance class. db.t4g.medium is fine for staging; bump for prod."
  type        = string
  default     = "db.t4g.medium"
}

variable "elasticache_node_type" {
  description = "ElastiCache Redis node type."
  type        = string
  default     = "cache.t4g.small"
}

# Operators set this to a long-lived secret hash (e.g. KMS key id)
# rather than checking the real value into git.
variable "secrets_kms_key_alias" {
  description = "KMS key alias used to encrypt Secrets Manager values."
  type        = string
  default     = "alias/sportsmart-secrets"
}
