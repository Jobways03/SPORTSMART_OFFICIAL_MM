#!/usr/bin/env bash
#
# staging-up.sh — resume a parked environment (reverse of staging-down.sh).
#
# Starts RDS, waits for it to be available, then restores each ECS service to
# the desired count snapshotted by staging-down.sh (falls back to the built-in
# defaults below if no snapshot exists). NAT/ALB/ElastiCache were left running,
# so this is the only step needed to come back online — no terraform apply.
#
# Usage:  infra/scripts/staging-up.sh [staging|production]    # default: staging
#
# Requires: aws CLI + jq, with creds for ecs:UpdateService, rds:StartDBInstance/
# DescribeDBInstances, ssm:GetParameter.
set -euo pipefail

ENV="${1:-staging}"
case "$ENV" in
  staging | production) ;;
  *) echo "usage: $(basename "$0") [staging|production]" >&2; exit 2 ;;
esac
: "${AWS_REGION:=${AWS_DEFAULT_REGION:-ap-south-1}}"; export AWS_REGION
command -v aws >/dev/null 2>&1 || { echo "error: aws CLI not found" >&2; exit 2; }
command -v jq  >/dev/null 2>&1 || { echo "error: jq not found" >&2; exit 2; }

# Fallback when no snapshot exists — keep in sync with staging.tfvars
# service_desired_count (+ logistics_facade). Affiliate stays off by default.
DEFAULTS='{"api":1,"web-storefront":1,"web-admin-storefront":1,"web-d2c-seller":1,"web-d2c-seller-admin":1,"web-retail-seller":1,"web-retail-seller-admin":1,"web-franchise":1,"web-franchise-admin":1,"logistics-facade":1,"web-affiliate":0,"web-affiliate-admin":0}'

CLUSTER="$(aws ssm get-parameter --name "/sportsmart/${ENV}/deploy/cluster" --query 'Parameter.Value' --output text)"
echo "▶ Resuming ${ENV} (cluster: ${CLUSTER}, region: ${AWS_REGION})"

# 1) Start RDS first so the API finds a live DB the moment it boots.
RDS="$(aws rds describe-db-instances \
  --query "DBInstances[?starts_with(DBInstanceIdentifier, 'sportsmart-${ENV}')].DBInstanceIdentifier | [0]" \
  --output text)"
if [[ -n "$RDS" && "$RDS" != "None" ]]; then
  ST="$(aws rds describe-db-instances --db-instance-identifier "$RDS" \
    --query 'DBInstances[0].DBInstanceStatus' --output text)"
  # If a recent staging-down is still stopping it, wait out the stop first:
  # start-db-instance only works from 'stopped', so skipping it would leave the
  # 'wait available' below hanging forever (the failure mode when up is run right
  # after down). There is no 'db-instance-stopped' CLI waiter, so poll.
  while [[ "$ST" == "stopping" ]]; do
    echo "  RDS $RDS still stopping from a recent park — waiting for it to fully stop…"
    sleep 15
    ST="$(aws rds describe-db-instances --db-instance-identifier "$RDS" \
      --query 'DBInstances[0].DBInstanceStatus' --output text)"
  done
  if [[ "$ST" == "stopped" ]]; then
    aws rds start-db-instance --db-instance-identifier "$RDS" >/dev/null
    echo "  RDS $RDS → starting (waiting for 'available', ~5-10 min)…"
  elif [[ "$ST" == "available" ]]; then
    echo "  RDS $RDS already available"
  else
    echo "  RDS $RDS is '$ST' — waiting for 'available'…"
  fi
  aws rds wait db-instance-available --db-instance-identifier "$RDS"
  echo "  ✓ RDS available"
fi

# 2) Restore desired counts (snapshot from staging-down.sh, else defaults).
STATE="$(aws ssm get-parameter --name "/sportsmart/${ENV}/deploy/parked_state" \
  --query 'Parameter.Value' --output text 2>/dev/null || true)"
if [[ -z "$STATE" || "$STATE" == "None" ]]; then
  echo "  no snapshot found — using built-in defaults"
  STATE="$DEFAULTS"
fi

while read -r svc count; do
  [[ -n "$svc" ]] || continue
  aws ecs update-service --cluster "$CLUSTER" --service "$svc" --desired-count "$count" >/dev/null
  echo "  ✓ $svc → $count"
done < <(jq -r 'to_entries[] | "\(.key) \(.value)"' <<<"$STATE")

echo "✓ ${ENV} resuming. Tasks start in ~2-3 min."
echo "  Verify with: AWS_REGION=${AWS_REGION} infra/scripts/smoke.sh ${ENV} all"
