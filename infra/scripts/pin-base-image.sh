#!/usr/bin/env bash
#
# pin-base-image.sh — resolve a Docker image tag to its current
# RepoDigest and patch ALL Dockerfiles that hardcode that base in-place.
#
# Phase 9 (2026-05-16) — companion to the node:22-slim tag-pin. Updates
# every Dockerfile sharing the pin in one shot so a rotation can't leave
# one file on a stale digest (the drift dockerfile-digest-pin.spec.ts
# is there to catch).
#
# Usage:
#   infra/scripts/pin-base-image.sh node:22-slim
#
# What it does:
#   1. Pulls the tag fresh so we capture the latest published digest.
#   2. Reads RepoDigests[0] from `docker inspect`.
#   3. Refuses to write the all-zeros placeholder back into the files.
#   4. Rewrites the `FROM <image>[@sha256:...] AS base` line in each
#      target Dockerfile to `FROM <image>@sha256:<hex> AS base`.
#   5. Prints a per-file before/after so the operator can paste the PR.
#
# Pre-release rotation step — runs locally, NOT in CI (CI builds use
# the tag pin to stay green across upstream point releases).

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $(basename "$0") <image:tag>" >&2
  echo "example: $(basename "$0") node:22-slim" >&2
  exit 2
fi

IMAGE="$1"

# Resolve script-relative paths so the script works regardless of whether
# the operator runs it from repo root or infra/scripts/ itself. Every
# Dockerfile here hardcodes the SAME node:22-slim base pin and must rotate
# together — a partial rotation is the drift dockerfile-digest-pin.spec.ts
# is there to catch.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKERFILES=(
  "${SCRIPT_DIR}/../docker/Dockerfile.api"
  "${SCRIPT_DIR}/../docker/Dockerfile.web"
  "${SCRIPT_DIR}/../../apps/logistics-facade/Dockerfile"
)

for f in "${DOCKERFILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "error: Dockerfile not found at $f" >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "error: 'docker' CLI is required but not installed" >&2
  exit 1
fi

echo "▶ Pulling $IMAGE to capture the current digest…"
docker pull "$IMAGE" >/dev/null

# RepoDigests[0] returns "<image>@sha256:<hex>"
DIGEST_LINE=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE")
if [[ -z "$DIGEST_LINE" ]]; then
  echo "error: no RepoDigests on $IMAGE — was it built locally?" >&2
  exit 1
fi

# Extract just the sha256:<hex> portion.
SHA="${DIGEST_LINE#*@}"
if [[ ! "$SHA" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "error: unexpected digest format: $SHA" >&2
  exit 1
fi
if [[ "$SHA" == "sha256:0000000000000000000000000000000000000000000000000000000000000000" ]]; then
  echo "error: refusing to write the all-zeros placeholder digest" >&2
  exit 1
fi

NEW_FROM="FROM ${IMAGE}@${SHA} AS base"
# macOS / BSD sed needs the -i '' form; GNU sed allows bare -i.
SED_EXPR="s|^FROM[[:space:]]+node:22-slim(@sha256:[0-9a-f]{64})?([[:space:]]+AS[[:space:]]+base)?\$|${NEW_FROM}|"

for f in "${DOCKERFILES[@]}"; do
  echo "▶ ${f}"
  echo "  before:"
  grep -nE '^FROM[[:space:]]+node:22-slim' "$f" || {
    echo "error: could not find a FROM node:22-slim line in $f" >&2
    exit 1
  }
  if [[ "$(uname -s)" == "Darwin" ]]; then
    sed -i '' -E "$SED_EXPR" "$f"
  else
    sed -i -E "$SED_EXPR" "$f"
  fi
  echo "  after:"
  grep -nE '^FROM[[:space:]]+node:22-slim' "$f"
done

echo "✓ Done. Commit the changes, run a fresh \`docker build\` for each, and open a PR."
