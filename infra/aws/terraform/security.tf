# Security groups — least-privilege chain:
#   internet ──443──▶ alb ──container_ports──▶ ecs ──5432──▶ rds
#                                                  └──6379──▶ redis
# Cross-SG rules are separate resources to avoid the inline-rule cycle
# (alb references ecs and vice-versa).

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public ALB ingress"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-alb" }
}

resource "aws_security_group" "ecs" {
  name        = "${local.name}-ecs"
  description = "Fargate tasks"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-ecs" }
}

resource "aws_security_group" "rds" {
  name        = "${local.name}-rds"
  description = "RDS Postgres"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-rds" }
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "ElastiCache Redis"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-redis" }
}

# ── ALB: 80/443 from the internet, egress to ECS tasks ──────────────────
resource "aws_security_group_rule" "alb_in_https" {
  type              = "ingress"
  security_group_id = aws_security_group.alb.id
  protocol          = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "HTTPS from internet"
}

resource "aws_security_group_rule" "alb_in_http" {
  type              = "ingress"
  security_group_id = aws_security_group.alb.id
  protocol          = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "HTTP (redirected to HTTPS) from internet"
}

resource "aws_security_group_rule" "alb_out_to_ecs" {
  type                     = "egress"
  security_group_id        = aws_security_group.alb.id
  protocol                 = "tcp"
  from_port                = 3000 # web
  to_port                  = 4000 # api — covers both container ports
  source_security_group_id = aws_security_group.ecs.id
  description              = "ALB to Fargate task container ports"
}

# ── ECS: ingress only from the ALB; egress anywhere (NAT) ───────────────
resource "aws_security_group_rule" "ecs_in_from_alb" {
  type                     = "ingress"
  security_group_id        = aws_security_group.ecs.id
  protocol                 = "tcp"
  from_port                = 3000 # web
  to_port                  = 4000 # api — covers both container ports
  source_security_group_id = aws_security_group.alb.id
  description              = "Container ports from ALB"
}

resource "aws_security_group_rule" "ecs_out_all" {
  type              = "egress"
  security_group_id = aws_security_group.ecs.id
  protocol          = "-1"
  from_port         = 0
  to_port           = 0
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "Egress to RDS/Redis/Secrets Manager/ECR/internet via NAT"
}

# ── RDS: 5432 only from ECS tasks ───────────────────────────────────────
resource "aws_security_group_rule" "rds_in_from_ecs" {
  type                     = "ingress"
  security_group_id        = aws_security_group.rds.id
  protocol                 = "tcp"
  from_port                = 5432
  to_port                  = 5432
  source_security_group_id = aws_security_group.ecs.id
  description              = "Postgres from Fargate tasks"
}

# ── Redis: 6379 only from ECS tasks ─────────────────────────────────────
resource "aws_security_group_rule" "redis_in_from_ecs" {
  type                     = "ingress"
  security_group_id        = aws_security_group.redis.id
  protocol                 = "tcp"
  from_port                = 6379
  to_port                  = 6379
  source_security_group_id = aws_security_group.ecs.id
  description              = "Redis from Fargate tasks"
}
