# ─────────────────────────────────────────────────────────────────────────
# logistics-facade — INTERNAL Fargate service (no public ALB exposure).
#
# Reached by apps/api over AWS Cloud Map private DNS at
#   logistics-facade.<env>.internal:4100  (HTTP, paths /api/v1/*).
#
# Deliberately NOT a `local.services` entry: that map fans every service out
# to a PUBLIC target group + listener rule + public-zone Route53 A-alias +
# an ALB load_balancer block — which would expose this internal service. Here
# we add ONLY the private pieces: ECR repo, log group, a Cloud Map namespace +
# service, the ECS task def + service (with a service_registries block instead
# of a load_balancer block), the one missing ecs-to-ecs self-ingress rule, and
# a dedicated migrate task (the facade owns a SEPARATE database with its own
# prisma schema/migrations). Mirrors the standalone migrate.tf / seed.tf style.
# ─────────────────────────────────────────────────────────────────────────

locals {
  logistics_facade_name = "logistics-facade"
  logistics_facade_port = 4100

  # Private DNS the API resolves: service name within the <env>.internal
  # namespace → logistics-facade.<env>.internal. apps/api reads this as
  # LOGISTICS_FACADE_URL (Authorization: `ApiKey <token>`, paths /api/v1/*).
  logistics_facade_dns = "${local.logistics_facade_name}.${var.env}.internal"
  logistics_facade_url = "http://${local.logistics_facade_dns}:${local.logistics_facade_port}"
}

# ── ECR repo (standalone — NOT aws_ecr_repository.this) ──────────────────
resource "aws_ecr_repository" "logistics_facade" {
  name                 = "${local.name}/${local.logistics_facade_name}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  force_delete = var.env != "production"

  tags = { Name = "${local.name}/${local.logistics_facade_name}" }
}

resource "aws_ecr_lifecycle_policy" "logistics_facade" {
  repository = aws_ecr_repository.logistics_facade.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep last 20 tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = [var.env]
          countType     = "imageCountMoreThan"
          countNumber   = 20
        }
        action = { type = "expire" }
      },
    ]
  })
}

# ── Log group ────────────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "logistics_facade" {
  name              = "/ecs/${local.name}/${local.logistics_facade_name}"
  retention_in_days = var.log_retention_days
  tags              = { Name = "${local.name}-${local.logistics_facade_name}" }
}

# ── Cloud Map: private DNS namespace + service ───────────────────────────
# Net-new (no service discovery existed). The VPC already has DNS support +
# hostnames enabled (network.tf), which Cloud Map requires. One namespace for
# the whole env's internal services; the facade registers as an A record set.
resource "aws_service_discovery_private_dns_namespace" "internal" {
  name        = "${var.env}.internal"
  description = "${local.name} internal service discovery"
  vpc         = aws_vpc.main.id
  tags        = { Name = "${local.name}-internal-ns" }
}

resource "aws_service_discovery_service" "logistics_facade" {
  name = local.logistics_facade_name

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.internal.id
    dns_records {
      type = "A" # awsvpc/Fargate registers each task ENI IP
      ttl  = 15
    }
    routing_policy = "MULTIVALUE"
  }

  # ECS pushes task health into Cloud Map when the ECS service has a
  # service_registries block (below).
  health_check_custom_config {
    failure_threshold = 1
  }

  tags = { Name = "${local.name}-${local.logistics_facade_name}-sd" }
}

# ── Task definition (reuses the shared exec/task roles + the generated secret) ─
resource "aws_ecs_task_definition" "logistics_facade" {
  family                   = "${local.name}-${local.logistics_facade_name}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.logistics_facade_cpu)
  memory                   = tostring(var.logistics_facade_memory)
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = local.logistics_facade_name
      image     = "${aws_ecr_repository.logistics_facade.repository_url}:${var.logistics_facade_image_tag}"
      essential = true

      linuxParameters = { initProcessEnabled = true }

      portMappings = [
        { containerPort = local.logistics_facade_port, protocol = "tcp" }
      ]

      # Non-secret env. NODE_ENV = var.node_env: in staging the facade boots
      # WITHOUT real Delhivery/Shadowfax creds (their configs fall back to
      # placeholders); production uses the strict partner schema, so partner
      # tokens must be provisioned before flipping node_env to production
      # (see the README / wiring notes).
      environment = [
        { name = "NODE_ENV", value = var.node_env },
        { name = "LOGISTICS_FACADE_PORT", value = tostring(local.logistics_facade_port) },
        { name = "CORS_ORIGINS", value = local.cors_origins },
        { name = "LOG_LEVEL", value = "info" },
      ]

      # Boot-required secrets (LOGISTICS_DATABASE_URL / LOGISTICS_REDIS_URL must
      # be PRESENT or the facade EnvService crash-loops; the DB/Redis may be
      # unreachable at boot — it lazy-connects). INTERNAL_API_KEY is the SAME
      # generated value apps/api reads as LOGISTICS_FACADE_API_KEY. All three
      # live in the existing `generated` secret → no IAM change.
      secrets = [
        { name = "LOGISTICS_DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.generated.arn}:LOGISTICS_DATABASE_URL::" },
        { name = "LOGISTICS_REDIS_URL", valueFrom = "${aws_secretsmanager_secret.generated.arn}:LOGISTICS_REDIS_URL::" },
        { name = "INTERNAL_API_KEY", valueFrom = "${aws_secretsmanager_secret.generated.arn}:INTERNAL_API_KEY::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.logistics_facade.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = local.logistics_facade_name
        }
      }
    }
  ])

  tags = { Name = "${local.name}-${local.logistics_facade_name}" }
}

# ── ECS service: private subnets, Cloud Map registration, NO load_balancer ─
resource "aws_ecs_service" "logistics_facade" {
  name             = local.logistics_facade_name
  cluster          = aws_ecs_cluster.main.id
  task_definition  = aws_ecs_task_definition.logistics_facade.arn
  desired_count    = var.logistics_facade_desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  # No ALB target group → no ALB health gate; ECS task health + the Cloud Map
  # custom health config govern. Give the lazy DB/Redis connect some headroom.
  health_check_grace_period_seconds = 60

  network_configuration {
    subnets          = [for s in aws_subnet.private : s.id]
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  # Internal discovery instead of a public load_balancer block.
  service_registries {
    registry_arn = aws_service_discovery_service.logistics_facade.arn
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [desired_count]
  }

  tags = { Name = "${local.name}-${local.logistics_facade_name}" }
}

# ── CRITICAL: ecs-to-ecs self-ingress on the facade port ─────────────────
# The shared ECS security group only allows ingress from the ALB on 3000-4000
# (security.tf). Cloud Map provides DNS, NOT connectivity — the API task and
# the facade task share aws_security_group.ecs, so allow that SG to reach
# itself on 4100. Do NOT widen the public ALB ingress rules.
resource "aws_security_group_rule" "ecs_self_logistics_facade" {
  type                     = "ingress"
  security_group_id        = aws_security_group.ecs.id
  protocol                 = "tcp"
  from_port                = local.logistics_facade_port
  to_port                  = local.logistics_facade_port
  source_security_group_id = aws_security_group.ecs.id
  description              = "API to logistics-facade (ecs self) on 4100"
}

# ── Facade migrate task (own prisma schema, in a dedicated PG schema) ────
# Uses the FACADE image (ships the prisma CLI in prod deps + prisma/schema)
# and injects LOGISTICS_DATABASE_URL (= the main DB with ?schema=logistics).
# Self-contained: it first creates the `logistics` schema if absent (idempotent)
# then applies the facade's migrations into it — so deploy.sh can run it with
# NO out-of-band database/schema creation. Mirrors migrate.tf otherwise.
resource "aws_cloudwatch_log_group" "logistics_facade_migrate" {
  name              = "/ecs/${local.name}/${local.logistics_facade_name}-migrate"
  retention_in_days = var.log_retention_days
  tags              = { Name = "${local.name}-${local.logistics_facade_name}-migrate" }
}

resource "aws_ecs_task_definition" "logistics_facade_migrate" {
  family                   = "${local.name}-${local.logistics_facade_name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "${local.logistics_facade_name}-migrate"
      image     = "${aws_ecr_repository.logistics_facade.repository_url}:${var.logistics_facade_image_tag}"
      essential = true
      # 1) ensure the `logistics` schema exists (idempotent; CREATE SCHEMA IF
      #    NOT EXISTS is transaction-safe, unlike CREATE DATABASE), 2) apply the
      #    facade migrations. Both resolve LOGISTICS_DATABASE_URL from the schema
      #    datasource. POSIX sh (no bashisms) so it runs on the slim image.
      command = [
        "sh", "-c",
        "echo 'CREATE SCHEMA IF NOT EXISTS logistics;' | node_modules/.bin/prisma db execute --schema ./prisma/schema --stdin && node_modules/.bin/prisma migrate deploy --schema ./prisma/schema",
      ]

      environment = [
        { name = "NODE_ENV", value = var.node_env }
      ]

      secrets = [
        { name = "LOGISTICS_DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.generated.arn}:LOGISTICS_DATABASE_URL::" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.logistics_facade_migrate.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "${local.logistics_facade_name}-migrate"
        }
      }
    }
  ])

  tags = { Name = "${local.name}-${local.logistics_facade_name}-migrate" }
}

# ── Deploy-time SSM params (read by deploy.sh) ───────────────────────────
resource "aws_ssm_parameter" "deploy_logistics_facade_service" {
  name  = "/sportsmart/${var.env}/deploy/logistics_facade_service"
  type  = "String"
  value = aws_ecs_service.logistics_facade.name
  tags  = { Name = "${local.name}-deploy-lf-service" }
}

resource "aws_ssm_parameter" "deploy_logistics_facade_migrate_family" {
  name  = "/sportsmart/${var.env}/deploy/logistics_facade_migrate_task_family"
  type  = "String"
  value = aws_ecs_task_definition.logistics_facade_migrate.family
  tags  = { Name = "${local.name}-deploy-lf-migrate-family" }
}
