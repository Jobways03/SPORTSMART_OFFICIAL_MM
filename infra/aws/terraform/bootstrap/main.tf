# =========================================================================
# One-time state-backend bootstrap (run BEFORE the root module's init).
# =========================================================================
# Chicken-and-egg: the root module stores state in S3, but the S3 bucket +
# DynamoDB lock table must exist first. This tiny config uses LOCAL state to
# create them once per account. Run it, then `terraform init -backend-config`
# the root module against the bucket it created.
#
#   cd infra/aws/terraform/bootstrap
#   terraform init
#   terraform apply -var region=ap-south-1
#
# See bootstrap/README.md.

terraform {
  required_version = ">= 1.7, < 2.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = "sportsmart"
      ManagedBy = "terraform"
      Purpose   = "tf-state-backend"
    }
  }
}

variable "region" {
  description = "AWS region for the state bucket + lock table."
  type        = string
}

variable "state_bucket" {
  description = "S3 bucket name for Terraform state (globally unique)."
  type        = string
  default     = "sportsmart-tfstate"
}

variable "lock_table" {
  description = "DynamoDB table name for state locking."
  type        = string
  default     = "sportsmart-tflock"
}

resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket
  tags   = { Name = var.state_bucket }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# State holds the generated DB password + JWT/encryption keys, so deny any
# non-TLS access. (Principal-scoping to the CI/operator role is a recommended
# follow-up — add a second statement restricting s3:GetObject/PutObject once
# the runner role ARN is known.)
resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.state.arn,
          "${aws_s3_bucket.state.arn}/*",
        ]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.state]
}

# Expire old secret-bearing state versions so they don't accumulate forever.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-noncurrent-state"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

resource "aws_dynamodb_table" "lock" {
  name         = var.lock_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = { Name = var.lock_table }
}

output "state_bucket" {
  value = aws_s3_bucket.state.id
}

output "lock_table" {
  value = aws_dynamodb_table.lock.name
}
