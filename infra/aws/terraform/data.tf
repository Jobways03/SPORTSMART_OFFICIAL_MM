# RDS Postgres + ElastiCache Redis, both in the private subnets, reachable
# only from the Fargate tasks (see security.tf). The DB password is
# generated in secrets.tf (random_password.db) and surfaced to the app via
# the composed DATABASE_URL in the Secrets Manager secret.

# ── RDS Postgres ────────────────────────────────────────────────────────
resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = [for s in aws_subnet.private : s.id]
  tags       = { Name = "${local.name}-db" }
}

# Unique-per-build suffix for the prod final snapshot so a destroy/re-create
# cycle never collides on a fixed snapshot id.
resource "random_id" "db_final_snapshot" {
  byte_length = 4
}

resource "aws_db_instance" "main" {
  identifier = "${local.name}-pg"
  engine     = "postgres"
  # Major-only pin: RDS selects the latest 16.x at create and
  # auto_minor_version_upgrade keeps it current; ignore_changes (below)
  # stops the maintenance-window minor bump from showing as a downgrade diff.
  engine_version = var.postgres_version
  instance_class = var.rds_instance_class

  allocated_storage     = var.rds_allocated_storage_gb
  max_allocated_storage = var.rds_max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [aws_security_group.rds.id]
  parameter_group_name    = aws_db_parameter_group.main.name
  multi_az               = var.rds_multi_az
  publicly_accessible    = false

  backup_retention_period    = var.rds_backup_retention_days
  deletion_protection        = var.rds_deletion_protection
  auto_minor_version_upgrade = true
  apply_immediately          = var.env != "production"

  # Query-level visibility for the inevitable "DB is slow" incident.
  performance_insights_enabled    = var.env == "production"
  performance_insights_retention_period = var.env == "production" ? 7 : null
  enabled_cloudwatch_logs_exports = ["postgresql"]

  # Staging may be torn down freely; production must leave a final snapshot.
  skip_final_snapshot       = var.env != "production"
  final_snapshot_identifier = var.env == "production" ? "${local.name}-pg-final-${random_id.db_final_snapshot.hex}" : null

  lifecycle {
    ignore_changes = [engine_version]
  }

  tags = { Name = "${local.name}-pg" }
}

# Enforce TLS-only connections at the engine (defense-in-depth on top of the
# sslmode=require in DATABASE_URL).
resource "aws_db_parameter_group" "main" {
  name   = "${local.name}-pg16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  tags = { Name = "${local.name}-pg16" }
}

# ── ElastiCache Redis (single node for staging) ─────────────────────────
resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name}-redis"
  subnet_ids = [for s in aws_subnet.private : s.id]
  tags       = { Name = "${local.name}-redis" }
}

# maxmemory-policy = noeviction. This Redis holds cron-lock:* tokens, rate-
# limit counters and SSE state alongside the cache. Under the default
# volatile-lru, a HELD lock key (written SET NX EX, so TTL-bearing) is an
# eviction candidate under memory pressure — evicting it lets a second
# replica acquire and run the same money cron concurrently (the lock fence
# guards TTL-expiry, NOT eviction). noeviction instead makes writes fail when
# full: cache writes are fail-open (degrade to Postgres) and lock acquires
# fail-closed (skip the tick) — both safe. The redis-memory CloudWatch alarm
# (monitoring.tf) + right-sizing keep it off the ceiling.
resource "aws_elasticache_parameter_group" "main" {
  name        = "${local.name}-redis7"
  family      = "redis7"
  description = "${local.name} — noeviction so cron locks / counters are never evicted"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }

  tags = { Name = "${local.name}-redis7" }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${local.name}-redis"
  description          = "${local.name} cache/idempotency/locks"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.elasticache_node_type
  port           = 6379

  # var.redis_ha drives prod-grade topology: 2 nodes + failover. Single node
  # for staging. Redis backs idempotency keys + distributed locks, so a
  # single-node failover de-routes every API task (health/ready folds Redis
  # in) — prod should run HA.
  num_cache_clusters         = var.redis_ha ? 2 : 1
  automatic_failover_enabled = var.redis_ha
  multi_az_enabled           = var.redis_ha

  subnet_group_name    = aws_elasticache_subnet_group.main.name
  parameter_group_name = aws_elasticache_parameter_group.main.name
  security_group_ids   = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  # Transit encryption tracks redis_ha: ON for prod (REDIS_URL becomes
  # rediss:// in secrets.tf; ioredis negotiates TLS from the scheme), OFF for
  # staging to keep redis:// simple.
  transit_encryption_enabled = var.redis_ha

  tags = { Name = "${local.name}-redis" }
}
