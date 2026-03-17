#!/usr/bin/env bash
set -euo pipefail

cd /opt/devpane

echo "==> Pulling latest changes"
git pull --ff-only

echo "==> Installing dependencies"
pnpm install --frozen-lockfile

echo "==> Building"
pnpm build

echo "==> Restarting service"
systemctl --user restart devpane.service

echo "==> Update complete: $(git log --oneline -1)"
