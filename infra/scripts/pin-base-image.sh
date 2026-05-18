#!/usr/bin/env bash
#
# pin-base-image.sh — resolve a Docker image tag to its current
# RepoDigest and patch infra/docker/Dockerfile.api in-place.
#
# Phase 9 (2026-05-16) — companion to the Dockerfile.api tag-pin.
#
# Usage:
#   infra/scripts/pin-base-image.sh node:22-slim
#
# What it does:
#   1. Pulls the tag fresh so we capture the latest published digest.
#   2. Reads RepoDigests[0] from `docker inspect`.
#   3. Refuses to write the all-zeros placeholder back into the file.
#   4. Rewrites the `FROM <image>` (or `FROM <image>@sha256:...`) line
#      to `FROM <image>@sha256:<hex>`.
#   5. Prints a summary diff so the operator can paste it into the PR.
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

# Resolve script-relative path to the Dockerfile so the script works
# regardless of whether the operator runs it from repo root or
# infra/scripts/ itself.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKERFILE="${SCRIPT_DIR}/../docker/Dockerfile.api"

if [[ ! -f "$DOCKERFILE" ]]; then
  echo "error: Dockerfile not found at $DOCKERFILE" >&2
  exit 1
fi

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

# Show the current FROM line before patching.
echo "▶ Current FROM line:"
grep -nE '^FROM[[:space:]]+node:22-slim' "$DOCKERFILE" || {
  echo "error: could not find a FROM node:22-slim line in $DOCKERFILE" >&2
  exit 1
}

# Patch the line. macOS / BSD sed needs the -i '' form; GNU sed allows
# bare -i. We detect the platform once and branch.
NEW_FROM="FROM ${IMAGE}@${SHA} AS base"
if [[ "$(uname -s)" == "Darwin" ]]; then
  sed -i '' -E "s|^FROM[[:space:]]+node:22-slim(@sha256:[0-9a-f]{64})?([[:space:]]+AS[[:space:]]+base)?\$|${NEW_FROM}|" "$DOCKERFILE"
else
  sed -i -E "s|^FROM[[:space:]]+node:22-slim(@sha256:[0-9a-f]{64})?([[:space:]]+AS[[:space:]]+base)?\$|${NEW_FROM}|" "$DOCKERFILE"
fi

echo "▶ New FROM line:"
grep -nE '^FROM[[:space:]]+node:22-slim' "$DOCKERFILE"
echo "✓ Done. Commit the change, run a fresh \`docker build\`, and open a PR."
