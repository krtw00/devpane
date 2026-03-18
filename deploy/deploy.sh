#!/usr/bin/env bash
set -euo pipefail

HOST="${DEPLOY_HOST:-apps-vps}"
REMOTE_DIR="/opt/devpane"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-$(git branch --show-current)}"

if [ -z "${DEPLOY_BRANCH}" ]; then
  echo "ERROR: failed to determine deploy branch" >&2
  exit 1
fi

echo "==> Deploying DevPane branch ${DEPLOY_BRANCH} to ${HOST}:${REMOTE_DIR}"

ssh "${HOST}" "
  set -euo pipefail
  cd ${REMOTE_DIR}
  systemctl --user stop devpane.service || true
  git fetch origin ${DEPLOY_BRANCH}
  git checkout -B ${DEPLOY_BRANCH} origin/${DEPLOY_BRANCH}
  git reset --hard origin/${DEPLOY_BRANCH}
  git clean -fd -e .env -e '.env.*' -e data -e .worktrees
  pnpm install --frozen-lockfile
  pnpm build
  systemctl --user restart devpane.service
"

echo "==> Deploy complete"
echo "  NOTE: remote .env was preserved; edit ${REMOTE_DIR}/.env on ${HOST} if needed"
