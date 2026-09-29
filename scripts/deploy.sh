#!/usr/bin/env bash
# Wrapper: fetch, checkout, and run deploy-production.sh inside tmux session "deploy".
# Usage: ./scripts/deploy.sh [git-sha]
set -euo pipefail

TMUX_SESSION="deploy"
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

verify_repo() {
  git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || die "Not a git repository: ${REPO_ROOT}"

  [ -f "${REPO_ROOT}/scripts/deploy-production.sh" ] \
    || die "Missing scripts/deploy-production.sh — run from lenra-api checkout"

  grep -q '"name"[[:space:]]*:[[:space:]]*"lenra-api"' "${REPO_ROOT}/package.json" \
    || die "Expected lenra-api repository (package.json name must be lenra-api)"
}

resolve_deploy_sha() {
  local requested="${1:-}"
  local full_sha

  if [ -n "$requested" ]; then
    full_sha="$(git -C "$REPO_ROOT" rev-parse --verify "${requested}^{commit}")" \
      || die "Commit not found after fetch: ${requested}"
  else
    full_sha="$(git -C "$REPO_ROOT" rev-parse --verify 'origin/main^{commit}')" \
      || die "Could not resolve origin/main — check remotes and fetch"
  fi

  printf '%s' "$full_sha"
}

ensure_clean_worktree() {
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
    die "Working tree has uncommitted changes. Commit, stash, or discard them before deploying."
  fi
}

ensure_tmux_session() {
  if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    log "Using existing tmux session: ${TMUX_SESSION}"
    return 0
  fi

  tmux new-session -d -s "$TMUX_SESSION" -c "$REPO_ROOT"
  log "Created tmux session: ${TMUX_SESSION}"
}

run_deploy_in_tmux() {
  local full_sha="$1"
  local deploy_cmd
  deploy_cmd="cd $(printf '%q' "$REPO_ROOT") && git checkout $(printf '%q' "$full_sha") && ./scripts/deploy-production.sh $(printf '%q' "$full_sha")"

  log "Starting deploy in tmux (SHA ${full_sha})"
  tmux send-keys -t "$TMUX_SESSION" "$deploy_cmd" Enter
}

main() {
  local requested_sha="${1:-}"

  log "=== Lenra API deploy wrapper ==="
  log "Repository: ${REPO_ROOT}"

  require_cmd git
  require_cmd tmux
  verify_repo

  log "Fetching origin"
  git -C "$REPO_ROOT" fetch origin

  local full_sha
  full_sha="$(resolve_deploy_sha "$requested_sha")"
  log "Deploy target SHA: ${full_sha}"

  ensure_clean_worktree
  ensure_tmux_session
  run_deploy_in_tmux "$full_sha"

  log "Deployment started in tmux session: ${TMUX_SESSION}"
  log "Attach with: tmux attach -t ${TMUX_SESSION}"
  log "Detach without stopping deploy: Ctrl-b then d"
}

main "$@"
