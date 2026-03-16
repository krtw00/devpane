import { execFileSync } from "node:child_process"
import type { ActiveHours, Config } from "@devpane/shared"

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

function findGitRoot(): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim()
  } catch {
    return process.cwd()
  }
}

export const config: Config = {
  APP_NAME: env("APP_NAME", "DevPane"),
  PROJECT_ROOT: env("PROJECT_ROOT", findGitRoot()),
  WORKER_TIMEOUT_MS: Number(env("WORKER_TIMEOUT_MS", "600000")),
  PM_TIMEOUT_MS: Number(env("PM_TIMEOUT_MS", "300000")),
  IDLE_INTERVAL_SEC: Number(env("IDLE_INTERVAL_SEC", "60")),
  PM_RETRY_INTERVAL_SEC: Number(env("PM_RETRY_INTERVAL_SEC", "30")),
  COOLDOWN_INTERVAL_SEC: Number(env("COOLDOWN_INTERVAL_SEC", "300")),
  WORKER_CONCURRENCY: Number(env("WORKER_CONCURRENCY", "1")),
  DB_PATH: env("DB_PATH", `${env("PROJECT_ROOT", findGitRoot())}/devpane.db`),
  API_PORT: Number(env("API_PORT", "3001")),
  MAX_RETRIES: Number(env("DEVPANE_MAX_RETRIES", "2")),
  MAX_DIFF_SIZE: Number(env("DEVPANE_MAX_DIFF_SIZE", "500")),
  PR_RISK_DIFF_THRESHOLD: Number(env("PR_RISK_DIFF_THRESHOLD", "300")),
  ACTIVE_HOURS: parseActiveHours(process.env.ACTIVE_HOURS),
  MAX_OPEN_PRS: Number(env("DEVPANE_MAX_OPEN_PRS", "1")),
  MIN_DESCRIPTION_LENGTH: Number(env("DEVPANE_MIN_DESCRIPTION_LENGTH", "20")),
  EFFECT_MEASURE_THRESHOLD: Number(env("DEVPANE_EFFECT_MEASURE_THRESHOLD", "10")),
  KAIZEN_THRESHOLD: Number(env("DEVPANE_KAIZEN_THRESHOLD", "10")),
  MEMORY_CLEANUP_THRESHOLD: Number(env("DEVPANE_MEMORY_CLEANUP_THRESHOLD", "10")),
  PRUNE_INTERVAL_HOURS: Number(env("DEVPANE_PRUNE_INTERVAL_HOURS", "6")),
  BASE_BRANCH: env("DEVPANE_BASE_BRANCH", "main"),
  BUILD_CMD: env("DEVPANE_BUILD_CMD", "pnpm build"),
  TEST_CMD: env("DEVPANE_TEST_CMD", "pnpm test"),
  LINT_CMD: env("DEVPANE_LINT_CMD", "pnpm --if-present run lint"),
  BRANCH_PREFIX: env("DEVPANE_BRANCH_PREFIX", "devpane"),
  TEST_DIR: env("DEVPANE_TEST_DIR", "src/__tests__"),
  TEST_FILE_PATTERN: env("DEVPANE_TEST_FILE_PATTERN", "*.test.ts"),
  TEST_FRAMEWORK: env("DEVPANE_TEST_FRAMEWORK", "vitest"),
  PR_MERGE_STRATEGY: env("DEVPANE_PR_MERGE_STRATEGY", "--merge"),
  BUILD_TIMEOUT_MS: Number(env("BUILD_TIMEOUT_MS", "120000")),
  TEST_TIMEOUT_MS: Number(env("TEST_TIMEOUT_MS", "120000")),
  LINT_TIMEOUT_MS: Number(env("LINT_TIMEOUT_MS", "60000")),
}

export function parseCmd(cmd: string): { bin: string; args: string[] } {
  const parts = cmd.split(/\s+/)
  return { bin: parts[0], args: parts.slice(1) }
}

function parseActiveHours(value: string | undefined): ActiveHours | null {
  if (!value) return null
  const match = value.match(/^(\d{1,2})-(\d{1,2})$/)
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  if (start < 0 || start > 23 || end < 0 || end > 23) return null
  return { start, end }
}
