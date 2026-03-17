#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${1:?Usage: setup.sh <git-repo-url>}"
INSTALL_DIR="/opt/devpane"

echo "==> Checking prerequisites"

# Node.js 22+
if ! command -v node &>/dev/null; then
  echo "ERROR: node not found. Install Node.js 22+ first." >&2
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Node.js 22+ required (found $(node -v))" >&2
  exit 1
fi

# pnpm
if ! command -v pnpm &>/dev/null; then
  echo "ERROR: pnpm not found. Install with: corepack enable pnpm" >&2
  exit 1
fi

echo "  node $(node -v), pnpm $(pnpm -v)"

echo "==> Setting up ${INSTALL_DIR}"
sudo mkdir -p "${INSTALL_DIR}"
sudo chown "$(id -u):$(id -g)" "${INSTALL_DIR}"
git clone "${REPO_URL}" "${INSTALL_DIR}"

cd "${INSTALL_DIR}"

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "  Created .env from .env.example (edit as needed)"
fi

pnpm install --frozen-lockfile
pnpm build

echo "==> Enabling lingering (keep user services after logout)"
loginctl enable-linger "$(whoami)"

echo "==> Installing systemd user service"
systemctl --user link "${INSTALL_DIR}/deploy/devpane.service"
systemctl --user daemon-reload
systemctl --user enable --now devpane.service

echo "==> Setup complete"
echo "  Check status: systemctl --user status devpane.service"
echo "  View logs:    journalctl --user -u devpane.service -f"
