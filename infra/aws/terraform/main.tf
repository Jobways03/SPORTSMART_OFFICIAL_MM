# Phase 9 (2026-05-16) — Terraform root module.
#
# Stitch the per-service modules together. Each `module` block below
# is a placeholder pointer to a sibling directory under this dir;
# create the module bodies before `terraform init`.

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project    = "sportsmart"
      Env        = var.env
      ManagedBy  = "terraform"
      Repository = "sportsmart-marketplace"
    }
  }
}

# ── ECR registries (api + 8 web-*) ────────────────────────────────
# Helm/K8s/ECS reads the GHCR-hosted image today (see deploy.yml),
# but mirroring into ECR is recommended for production so an outage
# at GitHub doesn't block pod restarts.
#
# module "ecr" {
#   source = "./ecr"
#   env    = var.env
#   repositories = [
#     "api",
#     "web-storefront",
#     "web-admin",
#     "web-admin-storefront",
#     "web-seller",
#     "web-franchise",
#     "web-franchise-admin",
#     "web-affiliate",
#     "web-affiliate-admin",
#   ]
# }

# ── RDS Postgres + read replica ───────────────────────────────────
#
# module "rds" {
#   source         = "./rds"
#   env            = var.env
#   vpc_id         = module.vpc.vpc_id
#   private_subnet_ids = module.vpc.private_subnet_ids
#   instance_class = var.rds_instance_class
#   db_name        = "sportsmart"
# }

# ── ElastiCache Redis ─────────────────────────────────────────────
#
# module "elasticache" {
#   source     = "./elasticache"
#   env        = var.env
#   vpc_id     = module.vpc.vpc_id
#   subnet_ids = module.vpc.private_subnet_ids
#   node_type  = var.elasticache_node_type
# }

# ── S3 buckets (product images, invoice PDFs, KYC) ────────────────
#
# module "s3" {
#   source        = "./s3"
#   env           = var.env
#   kms_key_alias = var.secrets_kms_key_alias
# }

# ── EKS cluster (or swap for ECS/Fargate) ─────────────────────────
#
# module "eks" {
#   source     = "./eks"
#   env        = var.env
#   vpc_id     = module.vpc.vpc_id
#   subnet_ids = module.vpc.private_subnet_ids
# }
