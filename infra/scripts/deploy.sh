#!/usr/bin/env bash
#
# deploy.sh — roll a pushed image set out to an ECS Fargate environment.
#
# Phase 2 (2026-06-15) — invoked by .github/workflows/deploy.yml AFTER the
# images have been built and pushed to ECR (including the moving
# :<target>-latest tag the ECS task definitions reference). This script:
#   1. reads deploy config from SSM (written by Terraform — infra/aws/terraform),
#   2. runs `prisma migrate deploy` as a one-shot Fargate task and waits for
#      it to succeed BEFORE any app rolls (migrate-before-deploy),
#   3. force-new-deployment on each requested ECS service (pulls the fresh
#      :<target>-latest image), then waits for steady state and fails if the
#      deployment circuit breaker rolled a service back.
#
# Requires the AWS CLI v2 with credentials + region in the environment
# (deploy.yml provides them via GitHub OIDC → the Terraform deploy role).
#
# Usage:
#   infra/scripts/deploy.sh <staging|production> <services-csv|all> <image_tag>
#
# Examples:
#   infra/scripts/deploy.sh staging all staging-abc1234
#   infra/scripts/deploy.sh production api,web-storefront production-def5678

set -euo pipefail

TARGET="${1:-}"
SERVICES_CSV="${2:-}"
IMAGE_TAG="${3:-}"

if [[ -z "$TARGET" || -z "$SERVICES_CSV" || -z "$IMAGE_TAG" ]]; then
  echo "usage: $(basename "$0") <staging|production> <services-csv|all> <image_tag>" >&2
  exit 2
fi

case "$TARGET" in
  staging | production) ;;
  *)
    echo "error: target must be 'staging' or 'production' (got '$TARGET')" >&2
    exit 2
    ;;
esac

command -v aws >/dev/null 2>&1 || { echo "error: aws CLI not found on PATH" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "error: jq not found on PATH" >&2; exit 2; }
: "${AWS_REGION:=${AWS_DEFAULT_REGION:-}}"
if [[ -z "${AWS_REGION:-}" ]]; then
  echo "error: AWS_REGION (or AWS_DEFAULT_REGION) must be set" >&2
  exit 2
fi

# Expand "all" into the canonical list (mirrors local.services in Terraform
# and the deploy.yml build matrix). NB: the deployed admin storefront is
# web-admin-storefront (included below); the bare apps/web-admin app is a
# legacy stub and is intentionally NOT deployed.
if [[ "$SERVICES_CSV" == "all" ]]; then
  SERVICES_CSV="api,web-storefront,web-admin-storefront,web-d2c-seller,web-d2c-seller-admin,web-retail-seller,web-retail-seller-admin,web-franchise,web-franchise-admin,web-affiliate,web-affiliate-admin"
fi

ssm() {
  aws ssm get-parameter --name "/sportsmart/${TARGET}/deploy/$1" \
    --query 'Parameter.Value' --output text
}

echo "▶ Deploy plan"
echo "  target:    $TARGET"
echo "  image_tag: $IMAGE_TAG"
echo "  services:  $SERVICES_CSV"
echo "  region:    $AWS_REGION"
echo

CLUSTER="$(ssm cluster)"
SUBNETS="$(ssm private_subnets)"
SECURITY_GROUP="$(ssm ecs_security_group)"
MIGRATE_FAMILY="$(ssm migrate_task_family)"
echo "  cluster:   $CLUSTER"
echo

# ── 1. Migrations (only when the api is being deployed) ─────────────────
# The ECS services reference the moving :<target>-latest tag, which deploy.yml
# has just re-pushed; the migrate task uses the same image, so it carries the
# new migration set. Forward-only + idempotent (`prisma migrate deploy`).
# First-run applies the full migration history on a fresh DB, which can take
# longer than the AWS CLI `wait tasks-stopped` fixed 10-min cap — so poll with
# a configurable deadline instead, and stop the task on timeout (no orphan).
MIGRATE_TIMEOUT_SECONDS="${MIGRATE_TIMEOUT_SECONDS:-2400}" # 40 min
if [[ ",${SERVICES_CSV}," == *",api,"* ]]; then
  echo "▶ Running database migrations (task family: $MIGRATE_FAMILY)"
  RUN_JSON="$(aws ecs run-task \
    --cluster "$CLUSTER" \
    --task-definition "$MIGRATE_FAMILY" \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}" \
    --started-by "deploy.sh:${IMAGE_TAG}" \
    --output json)"

  TASK_ARN="$(printf '%s' "$RUN_JSON" | jq -r '.tasks[0].taskArn // "None"')"
  if [[ -z "$TASK_ARN" || "$TASK_ARN" == "None" ]]; then
    echo "✗ failed to start the migration task." >&2
    # run-task returns 200 with the reason in failures[] even on placement failure.
    printf '%s' "$RUN_JSON" | jq -r '.failures[]? | "  - \(.reason) (\(.arn // "n/a"))"' >&2 || true
    exit 1
  fi
  echo "  task: $TASK_ARN"
  echo "  waiting for migrations (deadline ${MIGRATE_TIMEOUT_SECONDS}s)…"

  deadline=$(( $(date +%s) + MIGRATE_TIMEOUT_SECONDS ))
  while :; do
    # Tolerate a transient describe error mid-wait (throttle/5xx) — treat as
    # not-yet-stopped and poll again rather than aborting the whole deploy.
    STATUS="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
      --query 'tasks[0].lastStatus' --output text 2>/dev/null || echo PENDING)"
    [[ "$STATUS" == "STOPPED" ]] && break
    if (( $(date +%s) >= deadline )); then
      echo "✗ migration did not finish within ${MIGRATE_TIMEOUT_SECONDS}s (status=$STATUS); stopping task." >&2
      aws ecs stop-task --cluster "$CLUSTER" --task "$TASK_ARN" \
        --reason "deploy.sh migrate timeout" >/dev/null 2>&1 || true
      exit 1
    fi
    sleep 15
  done

  EXIT_CODE="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
    --query 'tasks[0].containers[0].exitCode' --output text)"
  if [[ "$EXIT_CODE" != "0" ]]; then
    REASON="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
      --query 'tasks[0].stoppedReason' --output text 2>/dev/null || true)"
    echo "✗ migration task exited with code '${EXIT_CODE}' (reason: ${REASON:-n/a})." >&2
    echo "  logs: CloudWatch /ecs/sportsmart-${TARGET}/migrate" >&2
    exit 1
  fi
  echo "  ✓ migrations applied."
  echo
else
  echo "▶ Skipping migrations (api not in this deploy)."
  echo
fi

# ── 2a. Pre-flight: every requested service must exist + be ACTIVE ───────
# Validate BEFORE mutating anything so a typo doesn't leave a partial rollout.
# (describe one at a time — DescribeServices caps at 10 services/call.)
echo "▶ Verifying services"
for svc in ${SERVICES_CSV//,/ }; do
  ST="$(aws ecs describe-services --cluster "$CLUSTER" --services "$svc" \
    --query 'services[0].status' --output text 2>/dev/null || echo MISSING)"
  if [[ "$ST" != "ACTIVE" ]]; then
    echo "✗ service '$svc' is not ACTIVE in cluster '$CLUSTER' (status: $ST). Nothing rolled." >&2
    exit 1
  fi
done
echo

# ── 2b. Roll the services (force a fresh pull of :<target>-latest) ──────
echo "▶ Rolling services"
ROLLED=()
for svc in ${SERVICES_CSV//,/ }; do
  echo "  update-service $svc"
  if ! aws ecs update-service --cluster "$CLUSTER" --service "$svc" --force-new-deployment >/dev/null; then
    echo "✗ update-service failed for '$svc' (rolled so far: ${ROLLED[*]:-none})." >&2
    exit 1
  fi
  ROLLED+=("$svc")
done
echo

# ── 3. Poll each rollout to a terminal state (COMPLETED/FAILED) ─────────
# Replaces `aws ecs wait services-stable` (fixed 10-min cap, and returns
# success even after a circuit-breaker rollback). The deployment circuit
# breaker auto-rolls-back a bad release → PRIMARY rolloutState=FAILED.
ROLLOUT_TIMEOUT_SECONDS="${ROLLOUT_TIMEOUT_SECONDS:-1800}" # 30 min
echo "▶ Waiting for rollouts (deadline ${ROLLOUT_TIMEOUT_SECONDS}s)…"
deadline=$(( $(date +%s) + ROLLOUT_TIMEOUT_SECONDS ))
declare -A DONE=()
FAILED=()
while :; do
  pending=0
  for svc in "${ROLLED[@]}"; do
    [[ "${DONE[$svc]:-}" == "1" ]] && continue
    # Tolerate a transient describe error mid-wait — poll again rather than
    # aborting (a real failure surfaces as rolloutState=FAILED, or the deadline).
    STATE="$(aws ecs describe-services --cluster "$CLUSTER" --services "$svc" \
      --query 'services[0].deployments[?status==`PRIMARY`].rolloutState | [0]' --output text 2>/dev/null || echo PENDING)"
    case "$STATE" in
      COMPLETED) DONE[$svc]=1; echo "  ✓ $svc" ;;
      FAILED) DONE[$svc]=1; FAILED+=("$svc"); echo "  ✗ $svc rolled back (circuit breaker)" >&2 ;;
      *) pending=1 ;;
    esac
  done
  (( pending == 0 )) && break
  if (( $(date +%s) >= deadline )); then
    for svc in "${ROLLED[@]}"; do
      if [[ "${DONE[$svc]:-}" != "1" ]]; then
        FAILED+=("$svc")
        echo "  ✗ $svc did not reach steady state within ${ROLLOUT_TIMEOUT_SECONDS}s" >&2
      fi
    done
    break
  fi
  sleep 15
done

if (( ${#FAILED[@]} > 0 )); then
  echo "✗ Deploy failed for: ${FAILED[*]}" >&2
  exit 1
fi

echo "✓ Deploy complete: ${ROLLED[*]}"
