#!/usr/bin/env bash
#
# staging-down.sh — "park" a non-production environment to cut AWS cost.
#
# Scales every ECS service in the cluster to desired-count 0 and stops the RDS
# instance. ElastiCache, the ALB and the NAT are left running (they can't be
# cheaply stopped), so the environment comes back in minutes via staging-up.sh
# instead of a full `terraform apply`. The current NON-ZERO desired counts are
# snapshotted to SSM (/sportsmart/<env>/deploy/parked_state) so staging-up.sh
# restores exactly what was running. Safe to re-run: when already parked it
# changes nothing and does not clobber the snapshot.
#
# Usage:  infra/scripts/staging-down.sh [staging|production]    # default: staging
#
# Requires: aws CLI + jq, with creds for ecs:UpdateService/DescribeServices/
# ListServices, rds:StopDBInstance/DescribeDBInstances, ssm:PutParameter.
set -euo pipefail

ENV="${1:-staging}"
case "$ENV" in
  staging | production) ;;
  *) echo "usage: $(basename "$0") [staging|production]" >&2; exit 2 ;;
esac
: "${AWS_REGION:=${AWS_DEFAULT_REGION:-ap-south-1}}"; export AWS_REGION
command -v aws >/dev/null 2>&1 || { echo "error: aws CLI not found" >&2; exit 2; }
command -v jq  >/dev/null 2>&1 || { echo "error: jq not found" >&2; exit 2; }

if [[ "$ENV" == "production" ]]; then
  read -r -p "⚠️  This parks PRODUCTION (downtime). Type 'park-production' to confirm: " ok
  [[ "$ok" == "park-production" ]] || { echo "aborted."; exit 1; }
fi

CLUSTER="$(aws ssm get-parameter --name "/sportsmart/${ENV}/deploy/cluster" --query 'Parameter.Value' --output text)"
echo "▶ Parking ${ENV} (cluster: ${CLUSTER}, region: ${AWS_REGION})"

# Collect every service in the cluster (bash 3.2-safe; no mapfile).
SERVICES=()
while IFS= read -r s; do [[ -n "$s" ]] && SERVICES+=("$s"); done < <(
  aws ecs list-services --cluster "$CLUSTER" --query 'serviceArns[]' --output text | tr '\t' '\n' | sed 's#.*/##'
)
[[ ${#SERVICES[@]} -gt 0 ]] || { echo "no services found in $CLUSTER" >&2; exit 1; }

# 1) Snapshot the current non-zero desired counts so we can restore them.
STATE="{}"
for svc in "${SERVICES[@]}"; do
  c="$(aws ecs describe-services --cluster "$CLUSTER" --services "$svc" --query 'services[0].desiredCount' --output text)"
  if [[ "$c" =~ ^[0-9]+$ && "$c" -gt 0 ]]; then
    STATE="$(jq -nc --argjson s "$STATE" --arg k "$svc" --argjson v "$c" '$s + {($k): $v}')"
  fi
done
if [[ "$(jq 'length' <<<"$STATE")" -gt 0 ]]; then
  aws ssm put-parameter --name "/sportsmart/${ENV}/deploy/parked_state" \
    --type String --value "$STATE" --overwrite >/dev/null
  echo "  saved running state → $STATE"
else
  echo "  already parked (no running services) — keeping existing snapshot"
fi

# 2) Scale every service to 0.
for svc in "${SERVICES[@]}"; do
  aws ecs update-service --cluster "$CLUSTER" --service "$svc" --desired-count 0 >/dev/null
  echo "  ✓ $svc → 0"
done

# 3) Stop RDS (only when currently 'available').
RDS="$(aws rds describe-db-instances \
  --query "DBInstances[?starts_with(DBInstanceIdentifier, 'sportsmart-${ENV}')].DBInstanceIdentifier | [0]" \
  --output text)"
if [[ -n "$RDS" && "$RDS" != "None" ]]; then
  ST="$(aws rds describe-db-instances --db-instance-identifier "$RDS" \
    --query 'DBInstances[0].DBInstanceStatus' --output text)"
  if [[ "$ST" == "available" ]]; then
    aws rds stop-db-instance --db-instance-identifier "$RDS" >/dev/null
    echo "  ✓ RDS $RDS → stopping"
  else
    echo "  – RDS $RDS is '$ST' (not stopping)"
  fi
fi

echo "✓ ${ENV} parked. Tasks drain now; RDS stops in ~2-3 min."
echo "  Note: AWS auto-restarts a stopped RDS after 7 days — fine for a daily cycle."
echo "  Resume with: infra/scripts/staging-up.sh ${ENV}"
