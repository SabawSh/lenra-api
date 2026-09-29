#!/usr/bin/env bash
# Manual production deploy — run on VPS inside tmux after git checkout.
# Usage: ./scripts/deploy-production.sh <git-sha>
set -euo pipefail

CONTAINER_PROD="lenra-api"
CONTAINER_CANDIDATE="lenra-api-new"
PROD_HOST_PORT="4000"
CANDIDATE_HOST_PORT="4001"
ENV_FILE="/home/ubuntu/projects/lenra-api/.env"
DOCKER_NETWORK="mysql-network"
STATE_FILE="/home/ubuntu/projects/lenra-api/.deploy-state"
INSPECT_BACKUP="/home/ubuntu/projects/lenra-api/.deploy-previous-inspect.json"
MIN_FREE_MB="${MIN_FREE_MB:-800}"
PREVIOUS_IMAGE_ID=""
PREVIOUS_CONTAINER_ID=""
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL_SEC="${HEALTH_INTERVAL_SEC:-2}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

log() {
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

curl_check() {
  local url="$1"
  curl -sf --max-time 10 "$url" >/dev/null
}

wait_for_checks() {
  local base_url="$1"
  local label="$2"
  local i=1
  while [ "$i" -le "$HEALTH_RETRIES" ]; do
    if curl_check "${base_url}/health"; then
      if curl_check "${base_url}/ready"; then
        log "${label}: /health and /ready OK"
        return 0
      fi
      log "${label}: /health OK, waiting for /ready (attempt ${i}/${HEALTH_RETRIES})"
    else
      log "${label}: waiting for /health (attempt ${i}/${HEALTH_RETRIES})"
    fi
    sleep "$HEALTH_INTERVAL_SEC"
    i=$((i + 1))
  done
  return 1
}

remove_candidate() {
  docker rm -f "$CONTAINER_CANDIDATE" 2>/dev/null || true
}

save_production_state() {
  local image_ref="$1"
  local image_id="$2"
  local sha="$3"
  mkdir -p "$(dirname "$STATE_FILE")"
  cat >"$STATE_FILE" <<EOF
# Written by deploy-production.sh — used for rollback
DEPLOYED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_SHA=${sha}
PRODUCTION_IMAGE=${image_ref}
PRODUCTION_IMAGE_ID=${image_id}
PREVIOUS_IMAGE=${CONTAINER_PROD}:previous
PREVIOUS_IMAGE_ID=${PREVIOUS_IMAGE_ID:-}
PREVIOUS_CONTAINER_ID=${PREVIOUS_CONTAINER_ID:-}
INSPECT_BACKUP=${INSPECT_BACKUP}
EOF
  log "Saved deploy state to ${STATE_FILE}"
}

tag_current_as_previous() {
  if ! docker inspect "$CONTAINER_PROD" >/dev/null 2>&1; then
    log "No existing ${CONTAINER_PROD} container — skip tagging previous"
    return 0
  fi

  local prod_image_id
  prod_image_id="$(docker inspect -f '{{.Image}}' "$CONTAINER_PROD")"
  log "Current production container image ID: ${prod_image_id}"

  docker tag "$prod_image_id" "${CONTAINER_PROD}:previous" 2>/dev/null || \
    docker tag "$(docker inspect -f '{{.Config.Image}}' "$CONTAINER_PROD")" "${CONTAINER_PROD}:previous" 2>/dev/null || \
    die "Could not tag current production image as ${CONTAINER_PROD}:previous"

  PREVIOUS_IMAGE_ID="$prod_image_id"
  PREVIOUS_CONTAINER_ID="$(docker inspect -f '{{.Id}}' "$CONTAINER_PROD")"
  docker inspect "$CONTAINER_PROD" >"$INSPECT_BACKUP"
  log "Saved production container inspect to ${INSPECT_BACKUP}"
  log "Tagged rollback image as ${CONTAINER_PROD}:previous"
}

start_production_container() {
  local image="$1"
  docker run -d \
    --name "$CONTAINER_PROD" \
    --restart unless-stopped \
    --network "$DOCKER_NETWORK" \
    --env-file "$ENV_FILE" \
    -p "127.0.0.1:${PROD_HOST_PORT}:4000" \
    "$image"
}

restore_previous_production() {
  local rollback_image="${CONTAINER_PROD}:previous"
  if ! docker image inspect "$rollback_image" >/dev/null 2>&1; then
    log "ERROR: No ${rollback_image} available for automatic restore"
    return 1
  fi

  log "Restoring production from ${rollback_image}"
  docker rm -f "$CONTAINER_PROD" 2>/dev/null || true
  start_production_container "$rollback_image"

  if wait_for_checks "http://127.0.0.1:${PROD_HOST_PORT}" "rollback production"; then
    log "Rollback production is healthy on port ${PROD_HOST_PORT}"
    return 0
  fi
  log "ERROR: Rollback production failed /ready check"
  return 1
}

main() {
  if [ "${1:-}" = "" ]; then
    die "Usage: $0 <git-sha>"
  fi

  local requested_sha="$1"

  log "=== Lenra API manual deploy ==="
  log "Requested SHA: ${requested_sha}"
  log "Repo root: ${REPO_ROOT}"

  require_cmd docker
  require_cmd curl
  require_cmd git

  cd "$REPO_ROOT"

  local head_sha
  head_sha="$(git rev-parse HEAD)"
  if [ "$head_sha" != "$requested_sha" ] \
    && [[ "$head_sha" != "$requested_sha"* ]] \
    && [[ "$requested_sha" != "$head_sha"* ]]; then
    die "Git HEAD (${head_sha}) does not match requested SHA (${requested_sha}). Checkout the commit first; this script does not run git checkout."
  fi

  log "Verified git HEAD matches deploy SHA (${head_sha})"

  [ -f "$ENV_FILE" ] || die "Missing env file: ${ENV_FILE}"

  local avail_mb
  avail_mb="$(df -m / | awk 'NR==2 {print $4}')"
  log "Free disk: ${avail_mb}MB (minimum ${MIN_FREE_MB}MB)"
  if [ "$avail_mb" -lt "$MIN_FREE_MB" ]; then
    die "Insufficient disk space. Run ./scripts/docker-cleanup.sh then retry."
  fi

  local image="${CONTAINER_PROD}:${head_sha}"

  log "Building Docker image ${image}"
  docker build -t "$image" -t "${CONTAINER_PROD}:latest" .

  tag_current_as_previous

  log "Starting candidate ${CONTAINER_CANDIDATE} on 127.0.0.1:${CANDIDATE_HOST_PORT}"
  remove_candidate
  docker run -d \
    --name "$CONTAINER_CANDIDATE" \
    --network "$DOCKER_NETWORK" \
    --env-file "$ENV_FILE" \
    -p "127.0.0.1:${CANDIDATE_HOST_PORT}:4000" \
    "$image"

  if ! wait_for_checks "http://127.0.0.1:${CANDIDATE_HOST_PORT}" "candidate"; then
    log "Candidate failed health checks — removing candidate, production unchanged"
    remove_candidate
    exit 1
  fi

  log "Candidate OK — cutover to production port ${PROD_HOST_PORT}"
  docker stop "$CONTAINER_PROD" 2>/dev/null || true
  docker rm -f "$CONTAINER_PROD" 2>/dev/null || true

  start_production_container "$image"

  if ! wait_for_checks "http://127.0.0.1:${PROD_HOST_PORT}" "production"; then
    log "Production cutover failed — attempting automatic restore from ${CONTAINER_PROD}:previous"
    docker rm -f "$CONTAINER_PROD" 2>/dev/null || true
    remove_candidate
    if restore_previous_production; then
      die "Deploy failed after cutover; previous production restored."
    else
      die "Deploy failed AND automatic rollback failed — manual intervention required."
    fi
  fi

  remove_candidate
  docker rm -f "${CONTAINER_PROD}-old" 2>/dev/null || true

  local prod_id
  prod_id="$(docker inspect -f '{{.Image}}' "$CONTAINER_PROD")"
  save_production_state "$image" "$prod_id" "$head_sha"

  log "Deploy succeeded: ${CONTAINER_PROD} → ${image} on port ${PROD_HOST_PORT}"
  log "Optional: ./scripts/docker-cleanup.sh to remove old lenra-api tags"
}

main "$@"
