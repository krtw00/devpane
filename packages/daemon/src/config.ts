import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { config as loadDotenv } from "dotenv"
import type { ActiveHours, Config } from "@devpane/shared"

function findGitRoot(): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim()
  } catch {
    return process.cwd()
  }
}

loadDotenv()
loadDotenv({ path: resolve(findGitRoot(), ".env"), override: false })

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

function optionalEnv(key: string): string | null {
  const value = process.env[key]?.trim()
  return value ? value : null
}

function parseCorsOrigins(value: string | undefined): string[] | null {
  if (!value) return null
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  return origins.length > 0 ? origins : null
}

export const config: Config = {
  APP_NAME: env("APP_NAME", "DevPane"),
  PROJECT_ROOT: env("PROJECT_ROOT", findGitRoot()),
  WORKER_TIMEOUT_MS: Number(env("WORKER_TIMEOUT_MS", "600000")),
  TESTER_TIMEOUT_MS: Number(env("TESTER_TIMEOUT_MS", "600000")),
  PM_TIMEOUT_MS: Number(env("PM_TIMEOUT_MS", "300000")),
  IDLE_INTERVAL_SEC: Number(env("IDLE_INTERVAL_SEC", "60")),
  PM_RETRY_INTERVAL_SEC: Number(env("PM_RETRY_INTERVAL_SEC", "30")),
  COOLDOWN_INTERVAL_SEC: Number(env("COOLDOWN_INTERVAL_SEC", "300")),
  WORKER_CONCURRENCY: Number(env("WORKER_CONCURRENCY", "1")),
  DB_PATH: env("DB_PATH", `${env("PROJECT_ROOT", findGitRoot())}/devpane.db`),
  BACKUP_DIR: env("BACKUP_DIR", `${env("PROJECT_ROOT", findGitRoot())}/.devpane-backups`),
  BACKUP_KEEP_COUNT: Number(env("BACKUP_KEEP_COUNT", "7")),
  API_PORT: Number(env("API_PORT", "3001")),
  API_TOKEN: optionalEnv("API_TOKEN"),
  CORS_ORIGIN: parseCorsOrigins(process.env.CORS_ORIGIN),
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
  LLM_REQUEST_TIMEOUT_MS: Number(env("LLM_REQUEST_TIMEOUT_MS", "120000")),
  TESTER_LLM_REQUEST_TIMEOUT_MS: Number(env("TESTER_LLM_REQUEST_TIMEOUT_MS", env("LLM_REQUEST_TIMEOUT_MS", "120000"))),
  WORKER_LLM_REQUEST_TIMEOUT_MS: Number(env("WORKER_LLM_REQUEST_TIMEOUT_MS", env("LLM_REQUEST_TIMEOUT_MS", "120000"))),
  CB_THRESHOLD: Number(env("DEVPANE_CB_THRESHOLD", "3")),
  CB_BACKOFF_SEC: Number(env("DEVPANE_CB_BACKOFF_SEC", "300")),
  CB_MAX_BACKOFF_SEC: Number(env("DEVPANE_CB_MAX_BACKOFF_SEC", "3600")),
  LLM_BACKEND: env("LLM_BACKEND", "openai-compatible"),
  LLM_API_KEY: optionalEnv("LLM_API_KEY"),
  LLM_BASE_URL: optionalEnv("LLM_BASE_URL"),
  LLM_MODEL: optionalEnv("LLM_MODEL"),
  LLM_INPUT_PRICE: process.env.LLM_INPUT_PRICE ? Number(process.env.LLM_INPUT_PRICE) : null,
  LLM_OUTPUT_PRICE: process.env.LLM_OUTPUT_PRICE ? Number(process.env.LLM_OUTPUT_PRICE) : null,
  TESTER_LLM_API_KEY: optionalEnv("TESTER_LLM_API_KEY") ?? optionalEnv("LLM_API_KEY"),
  TESTER_LLM_BASE_URL: optionalEnv("TESTER_LLM_BASE_URL") ?? optionalEnv("LLM_BASE_URL"),
  TESTER_LLM_MODEL: optionalEnv("TESTER_LLM_MODEL") ?? optionalEnv("LLM_MODEL"),
  TESTER_LLM_INPUT_PRICE: process.env.TESTER_LLM_INPUT_PRICE
    ? Number(process.env.TESTER_LLM_INPUT_PRICE)
    : (process.env.LLM_INPUT_PRICE ? Number(process.env.LLM_INPUT_PRICE) : null),
  TESTER_LLM_OUTPUT_PRICE: process.env.TESTER_LLM_OUTPUT_PRICE
    ? Number(process.env.TESTER_LLM_OUTPUT_PRICE)
    : (process.env.LLM_OUTPUT_PRICE ? Number(process.env.LLM_OUTPUT_PRICE) : null),
  WORKER_LLM_API_KEY: optionalEnv("WORKER_LLM_API_KEY") ?? optionalEnv("LLM_API_KEY"),
  WORKER_LLM_BASE_URL: optionalEnv("WORKER_LLM_BASE_URL") ?? optionalEnv("LLM_BASE_URL"),
  WORKER_LLM_MODEL: optionalEnv("WORKER_LLM_MODEL") ?? optionalEnv("LLM_MODEL"),
  WORKER_LLM_INPUT_PRICE: process.env.WORKER_LLM_INPUT_PRICE
    ? Number(process.env.WORKER_LLM_INPUT_PRICE)
    : (process.env.LLM_INPUT_PRICE ? Number(process.env.LLM_INPUT_PRICE) : null),
  WORKER_LLM_OUTPUT_PRICE: process.env.WORKER_LLM_OUTPUT_PRICE
    ? Number(process.env.WORKER_LLM_OUTPUT_PRICE)
    : (process.env.LLM_OUTPUT_PRICE ? Number(process.env.LLM_OUTPUT_PRICE) : null),
  ISSUE_SYNC_ENABLED: env("ISSUE_SYNC_ENABLED", "false") === "true",
  ISSUE_SYNC_LABELS: optionalEnv("ISSUE_SYNC_LABELS"),
  ISSUE_SYNC_INTERVAL_SEC: Number(env("ISSUE_SYNC_INTERVAL_SEC", "3600")),
  MONTHLY_COST_BUDGET_JPY: process.env.MONTHLY_COST_BUDGET_JPY ? Number(process.env.MONTHLY_COST_BUDGET_JPY) : null,
  DAILY_COST_BUDGET_JPY: process.env.DAILY_COST_BUDGET_JPY ? Number(process.env.DAILY_COST_BUDGET_JPY) : null,
  USD_JPY_RATE: Number(env("USD_JPY_RATE", "150")),
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

/**
 * Validates required environment variables.
 * Throws an error with a concise message if any required variable is missing.
 */
export function validateEnv(): void {
  // Check required LLM configuration only if LLM backend is enabled
  const llmBackend = process.env.LLM_BACKEND || "openai-compatible"
  if (llmBackend !== "none" && llmBackend !== "") {
    if (!process.env.LLM_API_KEY?.trim()) {
      throw new Error("LLM_API_KEY is required")
    }
    
    if (!process.env.LLM_BASE_URL?.trim()) {
      throw new Error("LLM_BASE_URL is required")
    }
    
    if (!process.env.LLM_MODEL?.trim()) {
      throw new Error("LLM_MODEL is required")
    }
  }

  // Check numeric environment variables
  const numericVars = [
    "API_PORT",
    "WORKER_TIMEOUT_MS",
    "TESTER_TIMEOUT_MS",
    "PM_TIMEOUT_MS",
    "BUILD_TIMEOUT_MS",
    "TEST_TIMEOUT_MS",
    "LINT_TIMEOUT_MS",
    "LLM_REQUEST_TIMEOUT_MS"
  ]

  for (const varName of numericVars) {
    const value = process.env[varName]
    if (value !== undefined && value !== "" && isNaN(Number(value))) {
      throw new Error(`${varName} must be a number`)
    }
  }
}
