# GitHub Actions OIDC → a scoped deploy role. deploy.yml assumes this role
# (no long-lived AWS keys in GitHub) to push images to ECR and run the
# rollout. Output the role ARN and set it as the GitHub repo variable
# AWS_DEPLOY_ROLE_ARN (+ AWS_REGION).

data "aws_caller_identity" "current" {}

# Account-wide OIDC provider singleton. If your account already has the
# GitHub provider, set var.github_oidc_provider_arn to reuse it (avoids a
# duplicate-provider error).
resource "aws_iam_openid_connect_provider" "github" {
  count = var.github_oidc_provider_arn == "" ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
  tags = { Name = "github-actions-oidc" }
}

locals {
  github_oidc_arn = var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn
}

# Trust: only tokens from this repo, audience sts.amazonaws.com.
data "aws_iam_policy_document" "deploy_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Branch pushes (workflow_dispatch runs — prep job is ref-scoped) and
    # environment-scoped jobs (build/rollout) only. Excludes pull_request /
    # fork-PR token subs (repo:<repo>:pull_request), so a malicious PR can't
    # mint these creds.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repo}:ref:refs/heads/*",
        "repo:${var.github_repo}:environment:*",
      ]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${local.name}-deploy"
  assume_role_policy = data.aws_iam_policy_document.deploy_assume.json
  tags               = { Name = "${local.name}-deploy" }
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPushPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
    ]
    resources = concat(
      [for r in aws_ecr_repository.this : r.arn],
      [aws_ecr_repository.logistics_facade.arn],
    )
  }

  # Mutating ECS actions, restricted to this environment's cluster.
  statement {
    sid       = "EcsRollout"
    actions   = ["ecs:UpdateService", "ecs:RunTask", "ecs:StopTask"]
    resources = ["*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  # Read-only ECS for the wait/exit-code checks in deploy.sh.
  statement {
    sid = "EcsRead"
    actions = [
      "ecs:DescribeServices",
      "ecs:DescribeTasks",
      "ecs:ListTasks",
      "ecs:DescribeTaskDefinition",
    ]
    resources = ["*"]
  }

  # Pass only the task exec + task roles, only to ECS.
  statement {
    sid       = "PassEcsRoles"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.task_execution.arn, aws_iam_role.task.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  # Deploy-time SSM params (cluster/subnets/sg/migrate-family/api-url).
  statement {
    sid       = "ReadDeployParams"
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/sportsmart/${var.env}/deploy/*"]
  }

  # Surface migration-task logs on failure (api + logistics-facade migrate).
  statement {
    sid     = "ReadMigrateLogs"
    actions = ["logs:GetLogEvents", "logs:DescribeLogStreams"]
    resources = [
      "${aws_cloudwatch_log_group.migrate.arn}:*",
      "${aws_cloudwatch_log_group.logistics_facade_migrate.arn}:*",
    ]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "${local.name}-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
