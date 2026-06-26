# Migration runner — a one-shot Fargate task that runs `prisma migrate deploy`
# against RDS from INSIDE the VPC (the DB is private; GitHub runners can't
# reach it). deploy.sh runs this via `aws ecs run-task` and waits for it to
# exit 0 BEFORE rolling the API service. Uses the API image (which now ships
# the prisma CLI — moved to prod deps — plus prisma/schema + migrations) with
# a command override; only DATABASE_URL is injected.

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/${local.name}/migrate"
  retention_in_days = 30
  tags              = { Name = "${local.name}-migrate" }
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
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
      name      = "migrate"
      image     = "${aws_ecr_repository.this["api"].repository_url}:${var.image_tag}"
      essential = true
      # --schema points prisma at the multi-file folder so it resolves without
      # prisma.config.ts (not in the image); the schema's datasource reads
      # env("DATABASE_URL"). `migrate deploy` is forward-only + idempotent.
      command = ["node_modules/.bin/prisma", "migrate", "deploy", "--schema", "./prisma/schema"]

      environment = [
        { name = "NODE_ENV", value = var.node_env }
      ]

      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = "${aws_secretsmanager_secret.generated.arn}:DATABASE_URL::"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.migrate.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "migrate"
        }
      }
    }
  ])

  tags = { Name = "${local.name}-migrate" }
}

# ── Deploy-time parameters for deploy.sh / deploy.yml ────────────────────
# Written by Terraform, read by the pipeline (no fragile AWS discovery in the
# shell). All non-secret.
resource "aws_ssm_parameter" "deploy_cluster" {
  name  = "/sportsmart/${var.env}/deploy/cluster"
  type  = "String"
  value = aws_ecs_cluster.main.name
  tags  = { Name = "${local.name}-deploy-cluster" }
}

resource "aws_ssm_parameter" "deploy_private_subnets" {
  name  = "/sportsmart/${var.env}/deploy/private_subnets"
  type  = "String"
  value = join(",", [for s in aws_subnet.private : s.id])
  tags  = { Name = "${local.name}-deploy-subnets" }
}

resource "aws_ssm_parameter" "deploy_ecs_security_group" {
  name  = "/sportsmart/${var.env}/deploy/ecs_security_group"
  type  = "String"
  value = aws_security_group.ecs.id
  tags  = { Name = "${local.name}-deploy-sg" }
}

resource "aws_ssm_parameter" "deploy_migrate_task_family" {
  name  = "/sportsmart/${var.env}/deploy/migrate_task_family"
  type  = "String"
  value = aws_ecs_task_definition.migrate.family
  tags  = { Name = "${local.name}-deploy-migrate-family" }
}

# Consumed by deploy.yml to bake NEXT_PUBLIC_API_URL into the web images.
resource "aws_ssm_parameter" "deploy_api_url" {
  name  = "/sportsmart/${var.env}/deploy/api_url"
  type  = "String"
  value = local.api_url
  tags  = { Name = "${local.name}-deploy-api-url" }
}

# Consumed by deploy.yml to bake NEXT_PUBLIC_GOOGLE_CLIENT_ID into the web images
# (the storefront "Sign in with Google" button). Public client id; the API reads
# the same value as GOOGLE_CLIENT_ID (ecs.tf). Created ONLY when set — SSM forbids
# empty values — so deploy.yml reads it with a soft fallback (empty = button hidden).
resource "aws_ssm_parameter" "deploy_google_client_id" {
  count = var.google_client_id != "" ? 1 : 0
  name  = "/sportsmart/${var.env}/deploy/google_client_id"
  type  = "String"
  value = var.google_client_id
  tags  = { Name = "${local.name}-deploy-google-client-id" }
}

# Consumed by deploy.yml to bake NEXT_PUBLIC_STOREFRONT_URL into the web images
# (storefront canonical / sitemap / robots / OG host). Production = the bare apex
# (var.serve_apex); other envs = the shop.<env_domain> subdomain. See
# local.storefront_url.
resource "aws_ssm_parameter" "deploy_storefront_url" {
  name  = "/sportsmart/${var.env}/deploy/storefront_url"
  type  = "String"
  value = local.storefront_url
  tags  = { Name = "${local.name}-deploy-storefront-url" }
}

# Per-service public URLs, consumed by infra/scripts/smoke.sh for the
# post-deploy end-to-end health gate.
resource "aws_ssm_parameter" "deploy_service_urls" {
  name  = "/sportsmart/${var.env}/deploy/service_urls"
  type  = "String"
  value = jsonencode({ for k, v in local.service_hosts : k => "https://${v}" })
  tags  = { Name = "${local.name}-deploy-service-urls" }
}
