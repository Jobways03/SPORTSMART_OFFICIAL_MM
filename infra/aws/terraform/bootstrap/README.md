# Terraform state backend bootstrap

One-time, per AWS account. Creates the S3 bucket + DynamoDB lock table that
the root module's S3 backend (`../backend.tf`) uses. Runs with **local
state** (committed nowhere — see `.gitignore`).

```bash
cd infra/aws/terraform/bootstrap
terraform init
terraform apply -var region=ap-south-1
# optionally: -var state_bucket=... -var lock_table=...
```

Defaults: bucket `sportsmart-tfstate`, table `sportsmart-tflock`. If you
change them, update `../staging.s3.tfbackend` and `../production.s3.tfbackend`
to match.

The bucket is versioned + KMS-encrypted + all public access blocked. Do not
delete it while any environment state lives in it.
