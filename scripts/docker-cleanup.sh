#!/usr/bin/env bash
# Safe cleanup of old Lenra API images only — run on VPS manually.
set -euo pipefail

CONTAINER_PROD="lenra-api"
STAGING_GLOB="/home/ubuntu/deploy-staging/lenra-api*.tar.gz"
TMP_GLOB="/tmp/lenra-api-src-*.tar.gz"

log() {
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

log "=== Docker disk usage (before cleanup) ==="
docker system df || true
df -h / || true

keep_ids=()

if docker inspect "$CONTAINER_PROD" >/dev/null 2>&1; then
  keep_ids+=("$(docker inspect -f '{{.Image}}' "$CONTAINER_PROD")")
  log "Keeping running production image ID: ${keep_ids[0]}"
fi

for tag in previous latest; do
  if docker image inspect "${CONTAINER_PROD}:${tag}" >/dev/null 2>&1; then
    id="$(docker image inspect -f '{{.Id}}' "${CONTAINER_PROD}:${tag}")"
    keep_ids+=("$id")
    log "Keeping ${CONTAINER_PROD}:${tag} (${id})"
  fi
done

is_kept() {
  local id="$1"
  local k
  for k in "${keep_ids[@]}"; do
    if [ "$k" = "$id" ]; then
      return 0
    fi
  done
  return 1
}

log "Removing old ${CONTAINER_PROD}:<sha> tags (not running / previous / latest)"
while read -r repo tag id; do
  [ "$repo" = "$CONTAINER_PROD" ] || continue
  [ "$tag" = "<none>" ] && continue
  if [ "$tag" = "previous" ] || [ "$tag" = "latest" ]; then
    continue
  fi
  if is_kept "$id"; then
    continue
  fi
  log "Removing ${CONTAINER_PROD}:${tag}"
  docker rmi -f "${CONTAINER_PROD}:${tag}" 2>/dev/null || log "  (skip ${CONTAINER_PROD}:${tag} — in use or already gone)"
done < <(docker images "$CONTAINER_PROD" --no-trunc --format '{{.Repository}} {{.Tag}} {{.ID}}')

log "Removing legacy GHCR lenra-api tags (if any)"
while read -r ref; do
  [ -z "$ref" ] && continue
  log "Removing ${ref}"
  docker rmi -f "$ref" 2>/dev/null || log "  (skip ${ref})"
done < <(docker images 'ghcr.io/*/*lenra-api*' --format '{{.Repository}}:{{.Tag}}' 2>/dev/null || true)

removed=0
for pattern in $STAGING_GLOB $TMP_GLOB; do
  for f in $pattern; do
    [ -e "$f" ] || continue
    log "Removing deploy tarball: $f"
    rm -f "$f"
    removed=$((removed + 1))
  done
done
log "Removed ${removed} tarball(s) (if any existed)"

docker rm -f lenra-api-new lenra-api-old 2>/dev/null || true

log "=== Docker disk usage (after cleanup) ==="
docker system df || true
df -h / || true
log "Cleanup complete (no volume prune, no image prune -af)"
