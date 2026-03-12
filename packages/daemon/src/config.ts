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
