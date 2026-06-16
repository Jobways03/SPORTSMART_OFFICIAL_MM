# Service catalog + derived values. Adding/removing a deployable service is
# a one-line edit to local.services — every ECR repo, log group, task def,
# target group, listener rule, ECS service and Route53 record fans out from
# this map via for_each.

locals {
  name = "sportsmart-${var.env}"

  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  # The 11 deployable containers. Mirrors .github/workflows/deploy.yml's
  # build matrix (1 api + 10 web-*). The deployed admin UI is
  # web-admin-storefront (below); the bare apps/web-admin app is a legacy stub
  # and is intentionally NOT deployed. Each web app is published at <subdomain>.<env_domain>;
  # the API at api.<env_domain>. Ports/health-paths match the Dockerfiles +
  # the Next.js `next start` default and the API global prefix /api/v1.
  services = {
    api = {
      container_port = 4000
      health_path    = "/api/v1/health/ready"
      subdomain      = "api"
      cpu            = 512
      memory         = 1024
      desired_count  = 2
      is_api         = true
    }
    web-storefront = {
      container_port = 3000
      health_path    = "/"
      subdomain      = "shop"
      cpu            = 256
      memory         = 512
      desired_count  = 2
      is_api         = false
    }
    web-admin-storefront = {
      container_port = 3000
      health_path    = "/"
      subdomain      = "admin"
      cpu            = 256
      memory         = 512
      desired_count  = 1
      is_api         = false
    }
    web-d2c-seller = {
      container_port = 3000
      health_path    = "/"
      subdomain      = "d2c-seller"
      cpu            = 256
      memory         = 512
      desired_count  = 1
      is_api         = false
    }
    web-d2c-seller-admin = {
      container_port = 3000
      health_path    = "/"
      subdomain      = "d2c-admin"
      cpu            = 256
      memory         = 512
      desired_count  = 1
      is_api         = false
    }
    web-retail-seller = {
      container_port = 3000
      health_path    = "/"
      subdomain      = "retail-seller"
      cpu            = 256
      memory         = 512
      desired_count  = 1
      is_api         = false
    }
    web-retail-seller-admin = {
      container_port = 3000
      health_path    = "/"
      subdomain      = "retail-admin"
      cpu            = 256
      memory         = 512
      desired_count  = 1
      is_api         = false
    }
    web-franchise = {
      container_port = 3000
      health_path    = "/"
      subdomain      = "franchise"
      cpu            = 256
      memory         = 512
      desired_count  = 1
      is_api         = false
    }
    web-franchise-admin = {
      container_port = 3000
      health_path    = "/"
      subdomain      = "franchise-admin"
      cpu            = 256
      memory         = 512
      desired_count  = 1
      is_api         = false
    }
    web-affiliate = {
      container_port = 3000
      health_path    = "/"
      subdomain      = "affiliate"
      cpu            = 256
      memory         = 512
      desired_count  = 1
      is_api         = false
    }
    web-affiliate-admin = {
      container_port = 3000
      health_path    = "/"
      subdomain      = "affiliate-admin"
      cpu            = 256
      memory         = 512
      desired_count  = 1
      is_api         = false
    }
  }

  # Convenience splits.
  web_services = { for k, v in local.services : k => v if !v.is_api }

  # Fully-qualified hostname per service, e.g. api.staging.sportsmart.com.
  service_hosts = { for k, v in local.services : k => "${v.subdomain}.${var.env_domain}" }

  api_url = "https://${local.service_hosts["api"]}"

  # CORS allow-list = every web app's https origin (the API rejects '*' in prod).
  cors_origins = join(",", [for k, v in local.web_services : "https://${local.service_hosts[k]}"])

  # The app secret's JSON keys. Generated-by-TF keys (DB/Redis URLs, JWT,
  # encryption keys) + operator-supplied external keys. Consumed by the ECS
  # task def `secrets` block for the API.
  generated_secret_keys = [
    "DATABASE_URL",
    "DIRECT_URL",
    "REDIS_URL",
    "JWT_CUSTOMER_SECRET",
    "JWT_SELLER_SECRET",
    "JWT_FRANCHISE_SECRET",
    "JWT_ADMIN_SECRET",
    "JWT_AFFILIATE_SECRET",
    "JWT_REFRESH_SECRET",
    "AFFILIATE_ENCRYPTION_KEY",
    "ADMIN_MFA_ENCRYPTION_KEY",
  ]

  external_secret_keys = [
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "R2_ACCOUNT_ID",
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ]
}
