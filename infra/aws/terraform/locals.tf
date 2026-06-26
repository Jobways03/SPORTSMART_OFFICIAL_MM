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

  # Public storefront URL baked into the web images at build time as
  # NEXT_PUBLIC_STOREFRONT_URL (canonical / sitemap / robots / OG metadata).
  # When serving the apex (production, var.serve_apex) the canonical storefront
  # origin is the bare apex; otherwise it is the shop.<env_domain> subdomain.
  storefront_url = var.serve_apex ? "https://${var.env_domain}" : "https://${local.service_hosts["web-storefront"]}"

  # CORS allow-list = every web app's https origin (the API rejects '*' in prod).
  # When serving the apex, the storefront's apex + www origins are cross-origin to
  # api.<env_domain>, so they must be in the allow-list too.
  cors_origins = join(",", concat(
    [for k, v in local.web_services : "https://${local.service_hosts[k]}"],
    var.serve_apex ? ["https://${var.env_domain}", "https://www.${var.env_domain}"] : [],
  ))

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
    # Seller/franchise bank-account encryption keys (TF-generated in secrets.tf
    # via random_id.aes, like the two above). Listing them here is what makes
    # the API task def actually inject them (ecs.tf api_secrets iterates this).
    "SELLER_BANK_ENCRYPTION_KEY",
    "FRANCHISE_BANK_ENCRYPTION_KEY",
  ]

  external_secret_keys = [
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "R2_ACCOUNT_ID",
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    # Public base URL the app serves R2 objects from (a custom domain on the
    # bucket, or the bucket's r2.dev public URL). media-storage.adapter.ts:58
    # treats R2 as "not configured" — and REFUSES image uploads with a 502 —
    # without it, even when the 4 creds above are set. Operator-owned.
    "R2_PUBLIC_BASE_URL",
    # SMTP creds for outbound mail (OTPs etc.) — operator-owned, set in the
    # external secret via the console. Without them the API runs "log-only" mail.
    "MAIL_USER",
    "MAIL_PASS",
    # Delhivery carrier creds, consumed by the logistics-facade (apps/logistics-
    # facade/.../delhivery/config/delhivery.config.ts). Operator-owned. They DEFAULT
    # to the facade's own placeholder values (see external_secret_defaults in
    # secrets.tf) so the facade keeps booting in staging; set REAL values in the
    # external secret to enable warehouse registration + shipment creation.
    # API_URL: staging host = https://staging-express.delhivery.com,
    #          prod host    = https://track.delhivery.com (verify on one.delhivery.com).
    "DELHIVERY_API_URL",
    "DELHIVERY_API_TOKEN",
    "DELHIVERY_CLIENT_NAME",
    "DELHIVERY_WEBHOOK_TOKEN",
  ]
}
