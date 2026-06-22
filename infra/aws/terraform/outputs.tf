output "ecs_cluster_name" {
  description = "ECS cluster name (used by deploy.sh: aws ecs update-service --cluster <this>)."
  value       = aws_ecs_cluster.main.name
}

output "alb_dns_name" {
  description = "ALB DNS name (CNAME target if you manage DNS outside this module)."
  value       = aws_lb.main.dns_name
}

output "route53_name_servers" {
  description = "Nameservers of the Terraform-created hosted zone. Delegate the subdomain by adding these as an NS record (name = the subdomain label, e.g. 'staging') in the PARENT corporate DNS zone. Empty when create_hosted_zone=false (zone looked up, not created)."
  value       = var.create_hosted_zone ? aws_route53_zone.primary[0].name_servers : []
}

output "service_urls" {
  description = "Public https URL per service."
  value       = { for k, v in local.service_hosts : k => "https://${v}" }
}

output "api_url" {
  description = "Base API URL (NEXT_PUBLIC_API_URL for the web apps)."
  value       = local.api_url
}

output "ecr_repository_urls" {
  description = "ECR repo URL per service — deploy.yml/deploy.sh push here."
  value       = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

output "rds_endpoint" {
  description = "RDS Postgres address (host only; full DATABASE_URL is in the generated secret)."
  value       = aws_db_instance.main.address
}

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint."
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "app_secret_generated_arn" {
  description = "ARN of the TF-managed app secret (DB/Redis URLs, JWT, encryption keys)."
  value       = aws_secretsmanager_secret.generated.arn
}

output "app_secret_external_arn" {
  description = "ARN of the operator-managed external-creds secret (Razorpay, R2) — populate this after apply."
  value       = aws_secretsmanager_secret.external.arn
}

output "ecs_service_names" {
  description = "ECS service names per service key (deploy.sh target)."
  value       = { for k, s in aws_ecs_service.this : k => s.name }
}

output "deploy_role_arn" {
  description = "GitHub Actions OIDC deploy role. Set this as the GitHub repo variable AWS_DEPLOY_ROLE_ARN (and AWS_REGION) so deploy.yml can assume it."
  value       = aws_iam_role.deploy.arn
}

output "migrate_task_family" {
  description = "ECS task-definition family for the prisma migrate runner (deploy.sh run-task target)."
  value       = aws_ecs_task_definition.migrate.family
}

output "logistics_facade_internal_url" {
  description = "Internal Cloud Map URL apps/api uses for the logistics-facade (LOGISTICS_FACADE_URL). Not publicly reachable."
  value       = local.logistics_facade_url
}

output "logistics_facade_ecr_repository_url" {
  description = "ECR repo URL for the logistics-facade image (CI push target)."
  value       = aws_ecr_repository.logistics_facade.repository_url
}

output "logistics_facade_migrate_task_family" {
  description = "ECS task family for the facade's prisma migrate runner (deploy.sh run-task target)."
  value       = aws_ecs_task_definition.logistics_facade_migrate.family
}
