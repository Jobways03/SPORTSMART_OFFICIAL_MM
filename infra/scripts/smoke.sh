#!/usr/bin/env bash
#
# smoke.sh — post-deploy end-to-end verification through the PUBLIC ALB/DNS/TLS.
#
# Phase 3 (2026-06-15) — run after deploy.sh as the promotion gate. ECS steady
# state + the deployment circuit breaker already prove tasks are healthy at the
# target-group level; this adds the layer they DON'T cover: real DNS
# resolution, the ACM cert, ALB host-routing, and the full request path. A
# deploy is not "green" until this passes.
#
# Checks, per deployed service (URLs read from SSM, written by Terraform):
#   - api  → GET /api/v1/health/ready  must be 200 (process + DB + Redis OK)
#   - web  → GET /                     must be < 400 (2xx/3xx; portals 3xx to /login)
# Retries each until healthy or SMOKE_TIMEOUT_SECONDS (absorbs first-deploy
# cert/DNS warmup).
#
# Requires aws CLI + jq + curl and AWS creds/region in the environment.
#
# Usage:
#   infra/scripts/smoke.sh <staging|production> <services-csv|all>

set -euo pipefail

TARGET="${1:-}"
SERVICES_CSV="${2:-all}"

case "$TARGET" in
  staging | production) ;;
  *)
    echo "usage: $(basename "$0") <staging|production> <services-csv|all>" >&2
    exit 2
    ;;
esac

command -v aws >/dev/null 2>&1 || { echo "error: aws CLI not found" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "error: jq not found" >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "error: curl not found" >&2; exit 2; }
: "${AWS_REGION:=${AWS_DEFAULT_REGION:-}}"
[[ -n "${AWS_REGION:-}" ]] || { echo "error: AWS_REGION must be set" >&2; exit 2; }

SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-300}"

# { "api": "https://api.…", "web-storefront": "https://shop.…", … }
SERVICE_URLS_JSON="$(aws ssm get-parameter \
  --name "/sportsmart/${TARGET}/deploy/service_urls" \
  --query 'Parameter.Value' --output text)"

# Cluster name (same SSM source deploy.sh reads) — used below to look up each
# service's desired task count so we can skip services intentionally scaled to 0.
CLUSTER="$(aws ssm get-parameter \
  --name "/sportsmart/${TARGET}/deploy/cluster" \
  --query 'Parameter.Value' --output text)"

# Which services to smoke.
if [[ "$SERVICES_CSV" == "all" ]]; then
  mapfile -t SERVICES < <(printf '%s' "$SERVICE_URLS_JSON" | jq -r 'keys[]')
else
  IFS=',' read -r -a SERVICES <<< "$SERVICES_CSV"
fi

# Check one URL, retrying until healthy or the per-service deadline.
# $1 = service name, $2 = url, $3 = path, $4 = "exact200" | "lt400"
check() {
  local name="$1" base="$2" path="$3" mode="$4"
  local url="${base%/}${path}"
  local deadline=$(( $(date +%s) + SMOKE_TIMEOUT_SECONDS ))
  local code
  while :; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo 000)"
    if [[ "$mode" == "exact200" && "$code" == "200" ]]; then
      echo "  ✓ $name ($url → $code)"; return 0
    fi
    if [[ "$mode" == "lt400" && "$code" =~ ^[0-9]+$ && "$code" -lt 400 && "$code" -ge 100 ]]; then
      echo "  ✓ $name ($url → $code)"; return 0
    fi
    if (( $(date +%s) >= deadline )); then
      echo "  ✗ $name ($url → $code) after ${SMOKE_TIMEOUT_SECONDS}s" >&2; return 1
    fi
    sleep 10
  done
}

echo "▶ Smoke test ($TARGET)"
FAILED=()
for name in "${SERVICES[@]}"; do
  base="$(printf '%s' "$SERVICE_URLS_JSON" | jq -r --arg k "$name" '.[$k] // empty')"
  if [[ -z "$base" ]]; then
    echo "  – $name: no URL in SSM service_urls (skipping)"
    continue
  fi
  # Skip services intentionally scaled to 0 (staging runs lean via
  # service_desired_count in *.tfvars). Zero tasks -> empty target group -> the
  # ALB returns 503, which is correct behavior, not a deploy regression. Smoke
  # only what is actually deployed; an unknown/missing count fails open (tests).
  desired="$(aws ecs describe-services --cluster "$CLUSTER" --services "$name" \
    --query 'services[0].desiredCount' --output text 2>/dev/null || echo "")"
  if [[ "$desired" == "0" ]]; then
    echo "  – $name: desired_count=0 (intentionally off in $TARGET), skipping"
    continue
  fi
  if [[ "$name" == "api" ]]; then
    check "$name" "$base" "/api/v1/health/ready" "exact200" || FAILED+=("$name")
  else
    check "$name" "$base" "/" "lt400" || FAILED+=("$name")
  fi
done

if (( ${#FAILED[@]} > 0 )); then
  echo "✗ Smoke failed: ${FAILED[*]}" >&2
  exit 1
fi
echo "✓ Smoke passed."
