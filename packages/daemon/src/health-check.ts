import { execFileSync } from "node:child_process"
import { config } from "./config.js"

export type CredentialHealthCheck = {
  name: string
  ok: boolean
  message: string
}

const CHECK_TIMEOUT_MS = 5_000

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const err = error as Error & { status?: number | null; signal?: string | null; stderr?: string | Buffer }
  if (err.signal) return `failed (signal: ${err.signal})`
  if (typeof err.status === "number") return `failed (exit: ${err.status})`
  if (typeof err.stderr === "string" && err.stderr.trim().length > 0) return err.stderr.trim()
  if (Buffer.isBuffer(err.stderr) && err.stderr.toString("utf-8").trim().length > 0) return err.stderr.toString("utf-8").trim()
  return err.message
}

function runCheck(
  name: string,
  command: string,
  args: string[],
  successMessage: string,
  cwd?: string,
): CredentialHealthCheck {
  try {
    execFileSync(command, args, {
      encoding: "utf-8",
      timeout: CHECK_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
    })
    return { name, ok: true, message: successMessage }
  } catch (error) {
    return { name, ok: false, message: formatError(error) }
  }
}

export function runCredentialHealthChecks(): CredentialHealthCheck[] {
  const cliBin = config.CLI_BACKEND === "codex" ? "codex" : "claude"

  return [
    runCheck("gh auth status", "gh", ["auth", "status"], "GitHub CLI auth OK"),
    runCheck("git ls-remote --exit-code origin HEAD", "git", ["ls-remote", "--exit-code", "origin", "HEAD"], "Git auth OK", config.PROJECT_ROOT),
    runCheck(`${cliBin} --version`, cliBin, ["--version"], `${cliBin} CLI available`),
  ]
}

export function summarizeOverallHealth(
  checks: CredentialHealthCheck[],
): "healthy" | "degraded" | "unhealthy" {
  const successCount = checks.filter((check) => check.ok).length
  if (successCount === checks.length) return "healthy"
  if (successCount === 0) return "unhealthy"
  return "degraded"
}
