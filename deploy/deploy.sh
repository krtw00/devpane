#!/usr/bin/env bash
set -euo pipefail

HOST="${DEPLOY_HOST:-apps-vps}"
REMOTE_DIR="/opt/devpane"

echo "==> Deploying DevPane to ${HOST}:${REMOTE_DIR}"

# Sync project files
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .worktrees \
  --exclude data \
  --exclude '*.db' \
  --exclude '*.db-wal' \
  --exclude '*.db-shm' \
  ./ "${HOST}:${REMOTE_DIR}/"

# Rebuild and restart on remote
ssh "${HOST}" "cd ${REMOTE_DIR} && docker compose up --build -d"

echo "==> Deploy complete"
