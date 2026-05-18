# Phase 9 (2026-05-16) — pinned Terraform + provider versions.
#
# Pin at the major+minor so a fresh `terraform init` always resolves
# to the same compatible plugin set across operator machines and CI.
# Bump after coordinated upgrade testing — Terraform itself has
# breaking changes between minors.

terraform {
  required_version = ">= 1.7, < 2.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
