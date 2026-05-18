# SPORTSMART — AWS Terraform skeleton

Phase 9 (2026-05-16) — starter layout for the AWS deployment target.
This is **a skeleton**, not a working module — fill in account ids,
domain names, VPC ids, and resource sizes before `terraform apply`.

## Layout

```
infra/aws/terraform/
├── README.md            ← this file
├── main.tf              ← root module: wires the children below
├── variables.tf         ← inputs (region, env, domain, etc.)
├── outputs.tf           ← cluster + bucket + endpoint exports
├── versions.tf          ← Terraform + provider pins
├── ecr/                 ← container registry for the api + 8 web-*
├── rds/                 ← Postgres 16 instance + read replica
├── elasticache/         ← Redis for cache + idempotency + locks
├── s3/                  ← product images / invoice PDFs / KYC docs
└── eks/                 ← Kubernetes cluster (or replace with ECS/Fargate)
```

## State

Use a remote backend — never commit `terraform.tfstate` to git.
The recommended pattern:

```hcl
terraform {
  backend "s3" {
    bucket         = "sportsmart-tfstate"
    key            = "envs/<env>/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "sportsmart-tflock"
    encrypt        = true
  }
}
```

## Workflows

```bash
# Plan a change against staging:
terraform -chdir=infra/aws/terraform workspace select staging
terraform -chdir=infra/aws/terraform plan -var-file=staging.tfvars

# Apply (after PR review):
terraform -chdir=infra/aws/terraform apply -var-file=staging.tfvars

# Promote to prod (same plan, prod inputs):
terraform -chdir=infra/aws/terraform workspace select production
terraform -chdir=infra/aws/terraform plan -var-file=production.tfvars
```

## Secrets

Long-lived service credentials (Razorpay, iThink, mail) MUST NOT live
in `.tfvars`. Use AWS Secrets Manager — the API container's task role
should `secretsmanager:GetSecretValue` against the
`sportsmart/<env>/*` namespace and the API reads the resolved values
into its env at boot.
