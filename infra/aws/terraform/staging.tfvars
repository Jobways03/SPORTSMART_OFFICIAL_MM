# Staging inputs. Apply with:
#   terraform apply -var-file=staging.tfvars
#
# Replace sportsmart.com with the real registered domain whose Route53 public
# hosted zone exists in this account. node_env=staging boots WITHOUT the
# external Razorpay/R2 creds (the prod-only boot-gate is skipped), so a first
# bring-up needs no external_secrets.

region   = "ap-south-1"
env      = "staging"
node_env = "staging"

# Staging runs under a DELEGATED SUBDOMAIN zone. Terraform CREATES the
# staging.sportsmart.com hosted zone (create_hosted_zone=true); after the first
# apply, add its nameservers (the `route53_name_servers` output) as an NS record
# for `staging` in the corporate sportsmart.com DNS. The corporate apex zone
# (website, email/MX) is never touched.
hosted_zone_name   = "staging.sportsmart.com"
create_hosted_zone = true
env_domain         = "staging.sportsmart.com"
auth_cookie_domain = ".staging.sportsmart.com"

# OIDC deploy-role trust — MUST equal the real GitHub remote, else every
# Actions deploy fails at AssumeRole.
github_repo = "Jobways03/SPORTSMART_OFFICIAL_MM"

image_tag                  = "staging-latest"
logistics_facade_image_tag = "staging-latest"

# Minimal always-on staging sizing (~$150/mo). Smallest viable instances —
# db.t4g.micro (~1 GB) and cache.t4g.micro (~0.5 GB) are enough for a low-
# traffic test env; bump to t4g.small if migrations/connections struggle.
rds_instance_class        = "db.t4g.micro"
rds_multi_az              = false
rds_backup_retention_days = 7
rds_deletion_protection   = false
elasticache_node_type     = "cache.t4g.micro"

# NAT instance (not a managed gateway) + single-node Redis + immediate secret
# deletion = cheap staging. The NAT instance is ~$3-4/mo vs ~$40/mo for the
# managed gateway; it's a single egress SPOF with no managed failover, which is
# fine for a parked-when-idle staging env (production keeps the gateway).
# VPC interface endpoints off (their ~$95/mo dwarfs the NAT data they'd save at
# staging traffic); 3-day log retention.
redis_ha                    = false
nat_per_az                  = false
use_nat_instance            = true
enable_vpc_endpoints        = false
secret_recovery_window_days = 0
log_retention_days          = 3

# Run staging with 1 task per service. Only the affiliate portals stay off
# (not yet exercised in staging); scale on demand with:
#   aws ecs update-service --cluster sportsmart-staging --service <name> --desired-count 1
# NOTE: ecs.tf sets `ignore_changes = [desired_count]`, so edits here take effect
# only when a service is first CREATED — scaling a LIVE service is the CLI command
# above, not `terraform apply`. This block is the source-of-truth for re-creates.
service_desired_count = {
  api                     = 1
  web-storefront          = 1
  web-admin-storefront    = 1
  web-d2c-seller          = 1
  web-d2c-seller-admin    = 1
  web-retail-seller       = 1
  web-retail-seller-admin = 1
  web-franchise           = 1
  web-franchise-admin     = 1
  web-affiliate           = 0
  web-affiliate-admin     = 0
}

# alarm_emails = ["oncall@sportsmart.com"]  # uncomment to receive alerts

