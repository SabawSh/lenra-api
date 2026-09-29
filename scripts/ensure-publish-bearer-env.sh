#!/usr/bin/env bash
# Ensure production Docker sees CLOUD_UPLOAD_API_KEY (CLI Bearer for content-import).
# Run on the VPS: ./scripts/ensure-publish-bearer-env.sh
set -euo pipefail

ENV_FILE="${ENV_FILE:-/home/ubuntu/projects/lenra-api/.env}"
CONTAINER="${CONTAINER:-lenra-api}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

if grep -q '^CLOUD_UPLOAD_API_KEY=' "$ENV_FILE"; then
  echo "CLOUD_UPLOAD_API_KEY already set in $ENV_FILE"
else
  line="$(grep '^API_INTERNAL_SECRET=' "$ENV_FILE" | head -1)"
  if [ -z "$line" ]; then
    echo "No API_INTERNAL_SECRET in $ENV_FILE — set CLOUD_UPLOAD_API_KEY manually" >&2
    exit 1
  fi
  echo "${line/API_INTERNAL_SECRET/CLOUD_UPLOAD_API_KEY}" >>"$ENV_FILE"
  echo "Appended CLOUD_UPLOAD_API_KEY (copied from API_INTERNAL_SECRET)"
fi

if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "Restarting $CONTAINER so --env-file changes apply…"
  docker restart "$CONTAINER" >/dev/null
  sleep 2
  key="$(docker exec "$CONTAINER" printenv CLOUD_UPLOAD_API_KEY 2>/dev/null || true)"
  if [ -z "$key" ]; then
    echo "Warning: container still has no CLOUD_UPLOAD_API_KEY — run deploy-production.sh to recreate the container" >&2
    exit 1
  fi
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
    "http://127.0.0.1:4000/api/admin/content-import/json?dryRun=1" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${key}" \
    -d '{}' --max-time 20)"
  echo "Local auth probe: HTTP $code (expect 400 for empty body, not 401)"
else
  echo "No $CONTAINER container — env file updated only"
fi
