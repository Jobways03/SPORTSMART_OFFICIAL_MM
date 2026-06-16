# ECS target-tracking autoscaling for the traffic-facing services (api +
# storefront). Manages DesiredCount, which the ECS service ignore_changes'es
# (ecs.tf) — so there is no TF/autoscaler fight. Gated on var.enable_autoscaling.

locals {
  autoscaled_services = var.enable_autoscaling ? toset(["api", "web-storefront"]) : toset([])
}

resource "aws_appautoscaling_target" "ecs" {
  for_each = local.autoscaled_services

  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.this[each.key].name}"

  min_capacity = lookup(var.service_desired_count, each.key, local.services[each.key].desired_count)
  max_capacity = var.autoscaling_max_count
}

resource "aws_appautoscaling_policy" "ecs_cpu" {
  for_each = local.autoscaled_services

  name               = "${local.name}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.ecs[each.key].service_namespace
  scalable_dimension = aws_appautoscaling_target.ecs[each.key].scalable_dimension
  resource_id        = aws_appautoscaling_target.ecs[each.key].resource_id

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
