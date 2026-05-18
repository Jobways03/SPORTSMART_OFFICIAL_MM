#!/usr/bin/env bash
#
# deploy.sh — applies a built image set to the target environment.
#
# Phase 9 (2026-05-16) — invoked by .github/workflows/deploy.yml after
# images have been pushed to GHCR. This script is the platform-abstraction
# seam: swap the body to point at kubectl / Helm / ECS / AppRunner /
# whatever the deploy target ends up being.
#
# Today's body is a placeholder that prints the rollout plan and exits
# non-zero so a fresh deploy fails LOUD rather than silently no-op'ing.
# Replace the placeholder with the real command before the first real
# rollout — and keep the same arg contract (target, services, image_tag)
# so the workflow YAML stays stable across platform changes.
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
  staging|production) ;;
  *)
    echo "error: target must be 'staging' or 'production' (got '$TARGET')" >&2
    exit 2
    ;;
esac

# Expand "all" into the canonical list. Keep this list in lockstep
# with .github/workflows/deploy.yml's matrix.
if [[ "$SERVICES_CSV" == "all" ]]; then
  SERVICES_CSV="api,web-storefront,web-admin,web-admin-storefront,web-seller,web-franchise,web-franchise-admin,web-affiliate,web-affiliate-admin"
fi

echo "▶ Deploy plan"
echo "  target:    $TARGET"
echo "  image_tag: $IMAGE_TAG"
echo "  services:  $SERVICES_CSV"
echo

# ─────────────────────────────────────────────────────────────────────
# REPLACE WITH REAL ROLLOUT COMMAND BEFORE FIRST PROD DEPLOY
# ─────────────────────────────────────────────────────────────────────
# Examples for common targets:
#
#   # Kubernetes (Deployment image bump):
#   for svc in ${SERVICES_CSV//,/ }; do
#     kubectl -n "$TARGET" set image \
#       deployment/"$svc" \
#       "$svc"="ghcr.io/${GITHUB_REPOSITORY}/${svc}:${IMAGE_TAG}"
#     kubectl -n "$TARGET" rollout status deployment/"$svc" --timeout=5m
#   done
#
#   # Helm (values override):
#   for svc in ${SERVICES_CSV//,/ }; do
#     helm upgrade --install "$svc" "./infra/helm/$svc" \
#       --namespace "$TARGET" --create-namespace \
#       --set image.tag="$IMAGE_TAG" \
#       --wait --timeout 5m
#   done
#
#   # AWS ECS (force new deployment of an existing service):
#   for svc in ${SERVICES_CSV//,/ }; do
#     aws ecs update-service \
#       --cluster "sportsmart-${TARGET}" \
#       --service "$svc" \
#       --force-new-deployment
#   done
# ─────────────────────────────────────────────────────────────────────

echo "✗ deploy.sh has no rollout command wired yet — refusing to no-op."
echo "  Edit infra/scripts/deploy.sh to invoke your platform's rollout"
echo "  command (kubectl / helm / aws ecs / etc.) and rerun."
exit 1
