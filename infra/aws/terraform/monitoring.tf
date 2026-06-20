# Alerting — the highest-leverage day-2 add for a small team. One SNS topic
# (subscribe via var.alarm_emails) + CloudWatch alarms on the signals an
# operator actually needs to wake up for. Container Insights (ecs.tf) already
# pays for the underlying metrics.

resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
  tags = { Name = "${local.name}-alarms" }
}

resource "aws_sns_topic_subscription" "alarms_email" {
  for_each  = toset(var.alarm_emails)
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = each.value
}

# ── Per-service: ALB target group with unhealthy hosts ──────────────────
resource "aws_cloudwatch_metric_alarm" "unhealthy_hosts" {
  for_each = local.services

  alarm_name          = "${local.name}-${each.key}-unhealthy-hosts"
  alarm_description   = "${each.key}: one or more ALB targets are unhealthy."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 60
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"

  dimensions = {
    TargetGroup  = aws_lb_target_group.this[each.key].arn_suffix
    LoadBalancer = aws_lb.main.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
  tags          = { Name = "${local.name}-${each.key}-unhealthy-hosts" }
}

# ── ALB: target 5xx surge ───────────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${local.name}-alb-target-5xx"
  alarm_description   = "Elevated 5xx from targets behind the ALB."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 20
  period              = 300
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"

  dimensions = { LoadBalancer = aws_lb.main.arn_suffix }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = { Name = "${local.name}-alb-target-5xx" }
}

# ── RDS: CPU + free storage ─────────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name}-rds-cpu"
  alarm_description   = "RDS CPU sustained high."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  period              = 300
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"

  dimensions = { DBInstanceIdentifier = aws_db_instance.main.identifier }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = { Name = "${local.name}-rds-cpu" }
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "${local.name}-rds-free-storage"
  alarm_description   = "RDS free storage low - approaching the autoscale ceiling."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Average"
  comparison_operator = "LessThanThreshold"
  threshold           = 5368709120 # 5 GiB
  period              = 300
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"

  dimensions = { DBInstanceIdentifier = aws_db_instance.main.identifier }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = { Name = "${local.name}-rds-free-storage" }
}

# ── ElastiCache: memory pressure ────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "redis_memory" {
  alarm_name          = "${local.name}-redis-memory"
  alarm_description   = "Redis memory usage high - risk of evictions (idempotency keys / locks)."
  namespace           = "AWS/ElastiCache"
  metric_name         = "DatabaseMemoryUsagePercentage"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  period              = 300
  evaluation_periods  = 3
  treat_missing_data  = "notBreaching"

  dimensions = { ReplicationGroupId = aws_elasticache_replication_group.main.id }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = { Name = "${local.name}-redis-memory" }
}
