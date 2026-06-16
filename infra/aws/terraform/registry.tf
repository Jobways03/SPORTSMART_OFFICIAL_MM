# One ECR repo per service, env-scoped (sportsmart-<env>/<service>) so
# staging and production never collide on a shared repo name. deploy.yml
# (Phase 2) pushes <service>:<image_tag> here; the task defs in ecs.tf pull
# the same tag. Repos are empty on first apply — services stay pending until
# Phase 2 pushes images.

resource "aws_ecr_repository" "this" {
  for_each = local.services

  name                 = "${local.name}/${each.key}"
  image_tag_mutability = "MUTABLE" # allows re-pushing the :<env>-latest moving tag

  image_scanning_configuration {
    scan_on_push = true
  }

  # Staging can be torn down freely; prod keeps images on destroy.
  force_delete = var.env != "production"

  tags = { Name = "${local.name}/${each.key}" }
}

# Keep the registry from growing unbounded — expire untagged images and cap
# tagged history at 20 per repo.
resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name

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
