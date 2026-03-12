import { execFileSync } from "node:child_process"
import type { Config } from "@devpane/shared"

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
  PROJECT_ROOT: env("PROJECT_ROOT", findGitRoot()),
  WORKER_TIMEOUT_MS: Number(env("WORKER_TIMEOUT_MS", "600000")),
  PM_TIMEOUT_MS: Number(env("PM_TIMEOUT_MS", "300000")),
  IDLE_INTERVAL_SEC: Number(env("IDLE_INTERVAL_SEC", "60")),
  PM_RETRY_INTERVAL_SEC: Number(env("PM_RETRY_INTERVAL_SEC", "30")),
  COOLDOWN_INTERVAL_SEC: Number(env("COOLDOWN_INTERVAL_SEC", "300")),
  WORKER_CONCURRENCY: Number(env("WORKER_CONCURRENCY", "1")),
  DB_PATH: env("DB_PATH", `${env("PROJECT_ROOT", findGitRoot())}/devpane.db`),
  API_PORT: Number(env("API_PORT", "3001")),
  DAILY_COST_LIMIT_USD: Number(env("DAILY_COST_LIMIT_USD", "5.0")),
  MONTHLY_COST_LIMIT_USD: Number(env("MONTHLY_COST_LIMIT_USD", "50.0")),
}
