# One CloudWatch log group per service; the task defs (ecs.tf) wire the
# awslogs driver to these. Retention is env-tunable via log_retention_days
# (staging trims to a few days to bound cost; prod keeps a forensic window).

resource "aws_cloudwatch_log_group" "this" {
  for_each = local.services

  name              = "/ecs/${local.name}/${each.key}"
  retention_in_days = var.log_retention_days
  tags              = { Name = "${local.name}-${each.key}" }
}
