# =========================================================================
# SPORTSMART — AWS ECS Fargate environment (root module)
# =========================================================================
# Phase 1 (2026-06-15) — replaces the Phase-9 EKS skeleton. Target is
# ECS Fargate (serverless containers): no cluster/node ops, native ALB +
# Secrets Manager + CloudWatch + rolling deploy with circuit-breaker
# rollback — the right fit for a 1–2 person team. The old EKS-oriented
# k8s sample manifests under infra/ci-cd/k8s/ are kept as reference but
# are NOT the deploy path.
#
# What this module provisions per environment (staging | production):
#   - VPC: 2 public + 2 private subnets across 2 AZs, IGW, single NAT.   (network.tf)
#   - Security groups: alb / ecs / rds / redis, least-privilege wired.    (security.tf)
#   - RDS Postgres 16 + ElastiCache Redis, both private.                  (data.tf)
#   - ECR repo per service (api + 10 web apps).                          (registry.tf)
#   - Secrets Manager app secret (DB/Redis URLs + JWT/keys generated;
#     Razorpay/R2 left as operator-filled placeholders) + KMS CMK.       (secrets.tf)
#   - IAM task-execution + task roles.                                   (iam.tf)
#   - CloudWatch log group per service.                                  (logs.tf)
#   - ALB + ACM wildcard cert + HTTPS listener + HTTP->HTTPS redirect.   (alb.tf)
#   - ECS cluster + per-service task def / service / target group /
#     listener rule / Route53 alias (for_each over local.services).      (ecs.tf)
#
# Bring-up order is documented in README.md. State lives in S3 (backend.tf);
# bootstrap/ creates the state bucket + lock table first.

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "sportsmart"
      Environment = var.env
      ManagedBy   = "terraform"
      Repository  = "sportsmart-marketplace"
    }
  }
}

# Pick the first two AZs in the region for the 2-AZ layout.
data "aws_availability_zones" "available" {
  state = "available"
}

# The public DNS zone the environment's hostnames live under.
#
#   create_hosted_zone = true  (staging): Terraform CREATES this zone. Use it
#     for a delegated subdomain (e.g. staging.sportsmart.com): after the first
#     apply, read the `route53_name_servers` output and add a matching NS
#     record in the PARENT zone (corporate sportsmart.com DNS). That delegates
#     only the subdomain — the corporate apex zone (website, MX/email) is never
#     touched.
#   create_hosted_zone = false (production): the zone already exists in Route53
#     and is only looked up here (registrar/parent delegation done out-of-band).
#
# Everything downstream references local.hosted_zone_id (not either resource
# directly), so the rest of the module is identical in both modes.
resource "aws_route53_zone" "primary" {
  count = var.create_hosted_zone ? 1 : 0
  name  = var.hosted_zone_name
  tags  = { Name = var.hosted_zone_name }
}

data "aws_route53_zone" "primary" {
  count        = var.create_hosted_zone ? 0 : 1
  name         = var.hosted_zone_name
  private_zone = false
}

locals {
  hosted_zone_id = var.create_hosted_zone ? aws_route53_zone.primary[0].zone_id : data.aws_route53_zone.primary[0].zone_id
}
