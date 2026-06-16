# Remote state — S3 backend with DynamoDB locking.
#
# Partial config: the bucket / key / table are supplied per-environment at
# init time so one root module serves both staging and prod without code
# edits:
#
#   terraform init -backend-config=staging.s3.tfbackend
#   terraform init -backend-config=production.s3.tfbackend -reconfigure
#
# The state bucket + lock table must exist BEFORE the first init — create
# them with the one-time bootstrap/ module (see bootstrap/README.md). State
# is encrypted at rest; treat it as sensitive (it contains the generated DB
# password + JWT/encryption secrets).
terraform {
  backend "s3" {
    encrypt = true
  }
}
