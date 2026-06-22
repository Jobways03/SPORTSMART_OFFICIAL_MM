# Seed runner — a one-shot Fargate task that loads PRODUCTION REFERENCE DATA
# (admin user + system roles, ABAC resource policies, SLA policies, tax master)
# into RDS from inside the VPC, AFTER `prisma migrate deploy`. Reuses the API
# image (which ships ts-node as a prod dep + prisma/seed/*.ts + tsconfig.json)
# with a command override. Mirrors migrate.tf.
#
# It runs prisma/seed/seed-prod.ts (NOT the dev seed.ts): the curated
# reference-only subset, never dev/demo fixtures. Every seed is upsert/skip-safe
# so it is idempotent, but deploy.sh gates it behind RUN_SEED=true so it is an
# explicit opt-in step — typically run once at environment bring-up.
#
# The bootstrap admin needs ADMIN_SEED_PASSWORD, injected from the operator-
# populated <env>/app/external secret. Populate that key BEFORE triggering a
# seed run, or the task fails fast (both ECS secret-resolution and seed-admin
# itself require it).

resource "aws_cloudwatch_log_group" "seed" {
  name              = "/ecs/${local.name}/seed"
  retention_in_days = var.log_retention_days
  tags              = { Name = "${local.name}-seed" }
}

resource "aws_ecs_task_definition" "seed" {
  family                   = "${local.name}-seed"
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
      name      = "seed"
      image     = "${aws_ecr_repository.this["api"].repository_url}:${var.image_tag}"
      essential = true
      # Curated prod reference seed (NOT seed.ts). --transpile-only skips the
      # redundant runtime type-check (CI type-checks the seeds already). The
      # seeds read env("DATABASE_URL"); the schema must already be migrated.
      command = ["node_modules/.bin/ts-node", "--transpile-only", "prisma/seed/seed-prod.ts"]

      environment = [
        { name = "NODE_ENV", value = var.node_env },
        # seed-metafields refuses on NODE_ENV=production without this. The seed
        # task IS the intentional bootstrap path, and the seed is idempotent
        # (Phase 39: upsert + mark-inactive, never deletes), so force it on here
        # while the standalone guard still protects ad-hoc manual runs.
        { name = "FORCE_METAFIELD_SEED", value = "true" },
      ]

      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = "${aws_secretsmanager_secret.generated.arn}:DATABASE_URL::"
        },
        {
          # Bootstrap admin password — operator-populated in the external secret.
          # Seeding is opt-in (RUN_SEED), so populate this key before running.
          name      = "ADMIN_SEED_PASSWORD"
          valueFrom = "${aws_secretsmanager_secret.external.arn}:ADMIN_SEED_PASSWORD::"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.seed.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "seed"
        }
      }
    }
  ])

  tags = { Name = "${local.name}-seed" }
}

# Read by deploy.sh (only when RUN_SEED=true) to find the seed task family.
resource "aws_ssm_parameter" "deploy_seed_task_family" {
  name  = "/sportsmart/${var.env}/deploy/seed_task_family"
  type  = "String"
  value = aws_ecs_task_definition.seed.family
  tags  = { Name = "${local.name}-deploy-seed-family" }
}
