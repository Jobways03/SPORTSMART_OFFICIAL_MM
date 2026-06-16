# VPC endpoints so task-startup AWS-API traffic (ECR image pulls, Secrets
# Manager reads, KMS decrypt, CloudWatch Logs) skips the NAT gateway —
# cheaper (no NAT data-processing on image pulls) and removes the NAT from
# the critical path for launching a task. Gated on var.enable_vpc_endpoints.

locals {
  interface_endpoints = var.enable_vpc_endpoints ? toset([
    "ecr.api",
    "ecr.dkr",
    "secretsmanager",
    "kms",
    "logs",
  ]) : toset([])
}

# SG for the interface endpoints: 443 from the Fargate tasks only.
resource "aws_security_group" "vpce" {
  count       = var.enable_vpc_endpoints ? 1 : 0
  name        = "${local.name}-vpce"
  description = "VPC interface endpoints"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-vpce" }
}

resource "aws_security_group_rule" "vpce_in_from_ecs" {
  count                    = var.enable_vpc_endpoints ? 1 : 0
  type                     = "ingress"
  security_group_id        = aws_security_group.vpce[0].id
  protocol                 = "tcp"
  from_port                = 443
  to_port                  = 443
  source_security_group_id = aws_security_group.ecs.id
  description              = "HTTPS from Fargate tasks"
}

# S3 gateway endpoint (free) — ECR layer blobs come from S3, so this is the
# biggest NAT-bytes saving on image pulls. Attached to the private route tables.
resource "aws_vpc_endpoint" "s3" {
  count             = var.enable_vpc_endpoints ? 1 : 0
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for rt in aws_route_table.private : rt.id]
  tags              = { Name = "${local.name}-s3" }
}

# Interface endpoints with private DNS so the AWS SDKs resolve to them
# automatically (no app config change).
resource "aws_vpc_endpoint" "interface" {
  for_each = local.interface_endpoints

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.private : s.id]
  security_group_ids  = [aws_security_group.vpce[0].id]
  private_dns_enabled = true
  tags                = { Name = "${local.name}-${each.key}" }
}
