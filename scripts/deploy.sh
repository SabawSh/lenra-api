#!/usr/bin/env bash
set -euo pipefail

TMUX_SESSION="deploy"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "Not inside a git repository"

if [ "$(pwd -P)" != "$(cd "$REPO_ROOT" && pwd -P)" ]; then
  die "Run this script from the repository root: ${REPO_ROOT}"
fi

if [ ! -f "${REPO_ROOT}/scripts/deploy-production.sh" ]; then
  die "Missing ${REPO_ROOT}/scripts/deploy-production.sh"
fi

command -v git >/dev/null 2>&1 || die "Missing required command: git"
command -v tmux >/dev/null 2>&1 || die "Missing required command: tmux"

git -C "$REPO_ROOT" fetch origin

if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  die "Uncommitted changes detected (git status --porcelain). Stash or commit before deploying."
fi

requested_sha="${1:-}"
if [ -n "$requested_sha" ]; then
  full_sha="$(git -C "$REPO_ROOT" rev-parse --verify "${requested_sha}^{commit}" 2>/dev/null)" \
    || die "Commit not found: ${requested_sha}"
else
  full_sha="$(git -C "$REPO_ROOT" rev-parse --verify 'origin/main^{commit}' 2>/dev/null)" \
    || die "Could not resolve origin/main after fetch"
fi

echo "Deploy SHA: ${full_sha}"

if ! tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  tmux new-session -d -s "$TMUX_SESSION"
fi

deploy_cmd="cd $(printf '%q' "$REPO_ROOT") && git checkout $(printf '%q' "$full_sha") && ./scripts/deploy-production.sh $(printf '%q' "$full_sha")"
tmux send-keys -t "$TMUX_SESSION" "$deploy_cmd" Enter

echo "Deploy started in tmux session: deploy"
echo "Attach with:"
echo "tmux attach -t deploy"
