#!/usr/bin/env bash
set -euo pipefail

# DevPaneを別プロジェクトに適用するための初期化スクリプト
# Usage: ./deploy/init-project.sh /path/to/target-repo

TARGET="${1:?Usage: init-project.sh <target-repo-path>}"

if [ ! -d "$TARGET/.git" ]; then
  echo "ERROR: $TARGET is not a git repository" >&2
  exit 1
fi

echo "==> Initializing DevPane for: $TARGET"

# .envファイルの生成
ENV_FILE="$TARGET/.env.devpane"
if [ -f "$ENV_FILE" ]; then
  echo "  .env.devpane already exists, skipping"
else
  APP_NAME=$(basename "$TARGET")
  cat > "$ENV_FILE" <<ENVEOF
# DevPane configuration for ${APP_NAME}
APP_NAME=${APP_NAME}
PROJECT_ROOT=${TARGET}

# Build/test commands (adjust for your project)
DEVPANE_BUILD_CMD=npm run build
DEVPANE_TEST_CMD=npm test
DEVPANE_LINT_CMD=npm run lint --if-present
DEVPANE_TEST_DIR=src/__tests__
DEVPANE_TEST_FILE_PATTERN=*.test.ts
DEVPANE_TEST_FRAMEWORK=vitest

# Branch settings
DEVPANE_BASE_BRANCH=main
DEVPANE_BRANCH_PREFIX=devpane

# Optional: GitHub Issues sync
# ISSUE_SYNC_ENABLED=true
# ISSUE_SYNC_LABELS=bug,enhancement

# Optional: Notifications
# SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
# DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# Optional: Security
# API_TOKEN=your-secret-token
# CORS_ORIGIN=http://localhost:3000

# Optional: Active hours (24h format, e.g. 00-06 for midnight to 6am)
# ACTIVE_HOURS=00-06
ENVEOF
  echo "  Created $ENV_FILE (edit as needed)"
fi

# CLAUDE.md テンプレートの確認
if [ ! -f "$TARGET/CLAUDE.md" ]; then
  echo "  WARNING: No CLAUDE.md found in $TARGET"
  echo "  DevPane's PM agent reads CLAUDE.md for project context."
  echo "  Create one with project overview, tech stack, and coding conventions."
fi

echo ""
echo "==> Setup complete"
echo ""
echo "To start DevPane for this project:"
echo "  cd /path/to/devpane"
echo "  source $ENV_FILE && pnpm dev"
echo ""
echo "Or with systemd:"
echo "  Add 'EnvironmentFile=$ENV_FILE' to devpane.service"
