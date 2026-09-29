#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAG="${1:-$(git -C "$ROOT/lenra-api" rev-parse HEAD)}"
PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
echo "Building lenra-api:${TAG} (platform=${PLATFORM}) from ${ROOT}/lenra-api"
docker build --platform "$PLATFORM" \
  -f "$ROOT/lenra-api/Dockerfile" \
  -t "lenra-api:${TAG}" \
  "$ROOT/lenra-api"
