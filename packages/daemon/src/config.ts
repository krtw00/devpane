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

function isValidUrl(url: string): boolean {
  try {
    // Basic URL validation
    new URL(url)
    return true
  } catch {
    return false
  }
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

export function validateEnv(): void {
  const errors: string[] = []
  
  // Check LLM_BACKEND specific requirements
  if (config.LLM_BACKEND === "openai-compatible") {
    if (!config.LLM_API_KEY) {
      errors.push("LLM_API_KEY is required")
    }
    if (!config.LLM_BASE_URL) {
      errors.push("LLM_BASE_URL is required")
    }
    if (!config.LLM_MODEL) {
      errors.push("LLM_MODEL is required")
    }
  }
  
  // Check PROJECT_ROOT
  if (!config.PROJECT_ROOT || config.PROJECT_ROOT.trim() === "") {
    errors.push("PROJECT_ROOT must be a valid directory path")
  }
  
  // Check numeric values
  if (isNaN(config.API_PORT) || config.API_PORT <= 0 || config.API_PORT > 65535) {
    errors.push("API_PORT must be a valid port number (1-65535)")
  }
  
  if (isNaN(config.WORKER_CONCURRENCY) || config.WORKER_CONCURRENCY <= 0) {
    errors.push("WORKER_CONCURRENCY must be a positive integer")
  }
  
  // Check timeout values
  if (isNaN(config.WORKER_TIMEOUT_MS) || config.WORKER_TIMEOUT_MS <= 0) {
    errors.push("WORKER_TIMEOUT_MS must be a positive number")
  }
  
  if (isNaN(config.TESTER_TIMEOUT_MS) || config.TESTER_TIMEOUT_MS <= 0) {
    errors.push("TESTER_TIMEOUT_MS must be a positive number")
  }
  
  if (isNaN(config.PM_TIMEOUT_MS) || config.PM_TIMEOUT_MS <= 0) {
    errors.push("PM_TIMEOUT_MS must be a positive number")
  }
  
  // Check interval values
  if (isNaN(config.IDLE_INTERVAL_SEC) || config.IDLE_INTERVAL_SEC <= 0) {
    errors.push("IDLE_INTERVAL_SEC must be a positive number")
  }
  
  if (isNaN(config.PM_RETRY_INTERVAL_SEC) || config.PM_RETRY_INTERVAL_SEC <= 0) {
    errors.push("PM_RETRY_INTERVAL_SEC must be a positive number")
  }
  
  if (isNaN(config.COOLDOWN_INTERVAL_SEC) || config.COOLDOWN_INTERVAL_SEC <= 0) {
    errors.push("COOLDOWN_INTERVAL_SEC must be a positive number")
  }
  
  // Check ACTIVE_HOURS format if provided
  if (process.env.ACTIVE_HOURS && !config.ACTIVE_HOURS) {
    errors.push("ACTIVE_HOURS must be in format 'HH-HH' where HH is 0-23")
  }
  
  // Check CORS_ORIGIN format if provided
  if (process.env.CORS_ORIGIN) {
    if (config.CORS_ORIGIN === null) {
      errors.push("CORS_ORIGIN must be a comma-separated list of valid URLs")
    } else if (config.CORS_ORIGIN) {
      // Validate each URL
      const invalidUrls = config.CORS_ORIGIN.filter((url: string) => !isValidUrl(url))
      if (invalidUrls.length > 0) {
        errors.push(`CORS_ORIGIN must contain valid URLs (invalid: ${invalidUrls.join(", ")})`)
      }
    }
  }
  
  // Check BUILD_TIMEOUT_MS, TEST_TIMEOUT_MS, LINT_TIMEOUT_MS
  if (isNaN(config.BUILD_TIMEOUT_MS) || config.BUILD_TIMEOUT_MS <= 0) {
    errors.push("BUILD_TIMEOUT_MS must be a positive number")
  }
  
  if (isNaN(config.TEST_TIMEOUT_MS) || config.TEST_TIMEOUT_MS <= 0) {
    errors.push("TEST_TIMEOUT_MS must be a positive number")
  }
  
  if (isNaN(config.LINT_TIMEOUT_MS) || config.LINT_TIMEOUT_MS <= 0) {
    errors.push("LINT_TIMEOUT_MS must be a positive number")
  }
  
  // Check LLM timeout values
  if (isNaN(config.LLM_REQUEST_TIMEOUT_MS) || config.LLM_REQUEST_TIMEOUT_MS <= 0) {
    errors.push("LLM_REQUEST_TIMEOUT_MS must be a positive number")
  }
  
  if (isNaN(config.TESTER_LLM_REQUEST_TIMEOUT_MS) || config.TESTER_LLM_REQUEST_TIMEOUT_MS <= 0) {
    errors.push("TESTER_LLM_REQUEST_TIMEOUT_MS must be a positive number")
  }
  
  if (isNaN(config.WORKER_LLM_REQUEST_TIMEOUT_MS) || config.WORKER_LLM_REQUEST_TIMEOUT_MS <= 0) {
    errors.push("WORKER_LLM_REQUEST_TIMEOUT_MS must be a positive number")
  }
  
  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n${errors.join("\n")}`)
  }
}
