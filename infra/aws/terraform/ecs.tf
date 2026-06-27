# ECS Fargate cluster + everything that fans out per service.
#
# Deploy model (Phase 2): the task defs reference the moving :<image_tag>
# tag (e.g. staging-latest). A deploy re-pushes that tag to ECR and runs
# `aws ecs update-service --force-new-deployment`, which launches fresh
# tasks that pull the new image — no task-def churn. Terraform owns the
# task definition; the deployment circuit breaker auto-rolls-back a release
# whose tasks fail their ALB health check. Only desired_count is ignored
# (autoscaling.tf + manual scaling own it at runtime).
#
# IMPORTANT: because the task def (image tag AND the environment[] block,
# incl. the requiredOnInProd flags from api_extra_environment) is TF-owned,
# a CHANGE to those env vars/flags is picked up ONLY by `terraform apply`
# (which mints a new revision) — a bare `update-service --force-new-deployment`
# re-pulls the image but reuses the existing revision. Flip prod flags via apply.

locals {
  # Stable 1-based priorities for the host-header listener rules.
  service_priority = { for idx, k in keys(local.services) : k => idx + 1 }

  # Compact, <=32-char target-group names (TG name limit).
  env_short = var.env == "production" ? "prd" : "stg"

  # API container env (non-secret). requiredOnInProd flags come in via
  # var.api_extra_environment when node_env=production.
  api_base_environment = {
    NODE_ENV                       = var.node_env
    PORT                           = "4000"
    APP_URL                        = local.api_url
    CORS_ORIGINS                   = local.cors_origins
    TRUST_PROXY_HOPS               = "1" # behind the ALB
    AUTH_COOKIE_DOMAIN             = var.auth_cookie_domain
    HEALTH_EXTERNAL_PROBES_DEFAULT = "false"
    # Internal Cloud Map URL of the logistics-facade (logistics-facade.tf).
    # Setting this enables the API's logistics integration; the matching API
    # key is injected as a secret below. Unset = integration disabled.
    LOGISTICS_FACADE_URL = local.logistics_facade_url
    # Persistent tax-PDF storage (Cloudflare R2). The 'stub' default writes PDFs
    # to the container's local disk, which is EPHEMERAL on Fargate — invoice PDFs
    # 404 ("Not found") after any task roll. R2 reuses the R2_* creds already set
    # for product images. Requires the env-schema enum to allow 'r2' (api image
    # must be deployed with that fix BEFORE this value is applied).
    TAX_PDF_STORAGE_PROVIDER = "r2"
    # MFA enrolment-invite links. AdminMfaService.createEnrollmentInvite builds the
    # /mfa-enroll/<token> link it hands the super-admin from ADMIN_PORTAL_URL_<PORTAL>
    # (SUPER/D2C/RETAIL/FRANCHISE/AFFILIATE = the invitee's home portal). Unset, it
    # falls back to dev localhost ports (e.g. http://localhost:4008) — wrong in any
    # deployed env. Point each at its real domain via the same service_hosts the ALB +
    # Route53 records use, so the link always resolves to that portal's running page.
    # ADMIN_PORTAL_URL (no suffix) is the generic admin base the support-ticket
    # notification links use; point it at the platform (super-admin) portal.
    ADMIN_PORTAL_URL           = "https://${local.service_hosts["web-admin-storefront"]}"
    ADMIN_PORTAL_URL_SUPER     = "https://${local.service_hosts["web-admin-storefront"]}"
    ADMIN_PORTAL_URL_D2C       = "https://${local.service_hosts["web-d2c-seller-admin"]}"
    ADMIN_PORTAL_URL_RETAIL    = "https://${local.service_hosts["web-retail-seller-admin"]}"
    ADMIN_PORTAL_URL_FRANCHISE = "https://${local.service_hosts["web-franchise-admin"]}"
    ADMIN_PORTAL_URL_AFFILIATE = "https://${local.service_hosts["web-affiliate-admin"]}"
    # Phase 252 — charge rate-based seller + franchise-online commission on the
    # GST-EXCLUSIVE taxable base (like TCS §52) instead of the inclusive price.
    # ON in staging to soak the new policy; OFF in production (still under
    # review). INERT until the API image carrying the commission-on-taxable code
    # is deployed — the old image never reads this flag. Reversible: flip the
    # value (or the condition) and re-apply. Forward-only — existing locked
    # commission records keep their inclusive-base values.
    COMMISSION_BASE_TAXABLE = var.env == "production" ? "false" : "true"
    # Public Google OAuth client id — the API verifies storefront Google ID
    # tokens against this audience (integrations/google/google-id-token-verifier
    # .service.ts). Same value baked into the storefront build; empty string =
    # Google login disabled (verifier returns "not configured").
    GOOGLE_CLIENT_ID = var.google_client_id
    # Outbound SMTP (transactional email via EmailService). Non-secret
    # host/port/security/from come from tfvars; the login (MAIL_USER) and
    # password (MAIL_PASS) are injected from the external secret. Defaults
    # preserve the prior Gmail SMTP host until a tfvars value overrides them.
    MAIL_HOST   = var.mail_host
    MAIL_PORT   = tostring(var.mail_port)
    MAIL_SECURE = var.mail_secure
    MAIL_FROM   = var.mail_from
    # "false" for cPanel/GoDaddy — their shared wildcard cert mismatches
    # mail.<domain>, so skip TLS hostname verification (still encrypted).
    MAIL_TLS_REJECT_UNAUTHORIZED = var.mail_tls_reject_unauthorized
  }
  api_environment = [
    for k, v in merge(local.api_base_environment, var.api_extra_environment) : {
      name  = k
      value = tostring(v)
    }
  ]

  # API secrets resolved from the two Secrets Manager secrets, key by key.
  api_secrets = concat(
    [for k in local.generated_secret_keys : {
      name      = k
      valueFrom = "${aws_secretsmanager_secret.generated.arn}:${k}::"
    }],
    [for k in local.external_secret_keys : {
      name      = k
      valueFrom = "${aws_secretsmanager_secret.external.arn}:${k}::"
    }],
    # API <-> facade shared secret: the SAME generated value the facade reads
    # as INTERNAL_API_KEY, surfaced to apps/api under its own env name. One
    # value, two env names, two containers (logistics-facade.tf).
    [{
      name      = "LOGISTICS_FACADE_API_KEY"
      valueFrom = "${aws_secretsmanager_secret.generated.arn}:INTERNAL_API_KEY::"
    }],
  )
}

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = local.name }
}

# ── Task definitions ────────────────────────────────────────────────────
resource "aws_ecs_task_definition" "this" {
  for_each = local.services

  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(each.value.cpu)
  memory                   = tostring(each.value.memory)
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64" # deploy.yml buildx builds amd64
  }

  container_definitions = jsonencode([
    {
      name      = each.key
      image     = "${aws_ecr_repository.this[each.key].repository_url}:${var.image_tag}"
      essential = true

      # Run ECS's built-in init (a tini equivalent) as PID 1: reaps zombies and
      # forwards SIGTERM cleanly to the node process on every rolling deploy /
      # scale-in, so in-flight requests drain instead of being cut. The images
      # use exec-form CMD already; this adds the reaper without an image change.
      linuxParameters = {
        initProcessEnabled = true
      }

      portMappings = [
        { containerPort = each.value.container_port, protocol = "tcp" }
      ]

      environment = each.value.is_api ? local.api_environment : [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = tostring(each.value.container_port) },
        { name = "HOSTNAME", value = "0.0.0.0" },
        # NOTE: NEXT_PUBLIC_* are inlined at BUILD time by `next build`, so
        # this runtime value is a no-op for already-built images. deploy.yml
        # must pass NEXT_PUBLIC_API_URL as a --build-arg per environment
        # (Phase 2). Kept here for any runtime-config readers + clarity.
        { name = "NEXT_PUBLIC_API_URL", value = local.api_url }
      ]

      secrets = each.value.is_api ? local.api_secrets : []

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this[each.key].name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = each.key
        }
      }
    }
  ])

  tags = { Name = "${local.name}-${each.key}" }
}

# ── Target groups (ip-type for Fargate awsvpc) ──────────────────────────
resource "aws_lb_target_group" "this" {
  for_each = local.services

  name        = "${local.env_short}-${each.key}"
  port        = each.value.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    path = each.value.health_path
    # API readiness must be strict 200. Web portals under `next start` often
    # 3xx-redirect "/" to /login when unauthenticated, which a 200-only check
    # would never pass — accept 2xx/3xx for them.
    matcher             = each.value.is_api ? "200" : "200-399"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
  }

  # Let a replaced task drain in-flight requests.
  deregistration_delay = 30

  tags = { Name = "${local.name}-${each.key}" }
}

# ── Host-header routing rules on the HTTPS listener ─────────────────────
resource "aws_lb_listener_rule" "this" {
  for_each = local.services

  listener_arn = aws_lb_listener.https.arn
  priority     = local.service_priority[each.key]

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[each.key].arn
  }

  condition {
    host_header {
      values = [local.service_hosts[each.key]]
    }
  }
}

# ── DNS: <subdomain>.<env_domain> → ALB ─────────────────────────────────
resource "aws_route53_record" "service" {
  for_each = local.services

  zone_id = local.hosted_zone_id
  name    = local.service_hosts[each.key]
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# ── Services ────────────────────────────────────────────────────────────
resource "aws_ecs_service" "this" {
  for_each = local.services

  name            = each.key
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.this[each.key].arn
  # Per-env override (var.service_desired_count) falls back to the catalog
  # default, so staging can run leaner than prod without editing locals.
  desired_count    = lookup(var.service_desired_count, each.key, each.value.desired_count)
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  # API cold start (Prisma init + Redis connect + env validation + first RDS
  # connection) can approach a minute; give it headroom so the circuit breaker
  # doesn't roll back a healthy image.
  health_check_grace_period_seconds = each.value.is_api ? 120 : 60

  network_configuration {
    subnets          = [for s in aws_subnet.private : s.id]
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this[each.key].arn
    container_name   = each.key
    container_port   = each.value.container_port
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # CI rollouts and scaling change desired_count out-of-band; don't treat
  # that as drift. (Task-definition stays TF-owned; deploys re-push the
  # moving tag + force-new-deployment.)
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener.https]

  tags = { Name = "${local.name}-${each.key}" }
}
