import { execFileSync } from "node:child_process"
import type { ObservableFacts } from "@devpane/shared"
import { getWorktreeDiff, commitWorktree } from "./worktree.js"
import { appendLog } from "./db.js"

export function collectFacts(
  taskId: string,
  taskTitle: string,
  worktreePath: string,
  exitCode: number,
): ObservableFacts {
  // Commit changes first
  const commitHash = commitWorktree(taskId, taskTitle) ?? undefined

  // Collect diff stats
  const { filesChanged, additions, deletions } = getWorktreeDiff(taskId)

  // Build first (required for monorepo — dist/ doesn't exist in worktree)
  let buildFailed = false
  try {
    execFileSync("pnpm", ["build"], {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 120000,
    })
  } catch (e) {
    buildFailed = true
    const buildErr = e as { stderr?: string; message?: string }
    const detail = buildErr.stderr || buildErr.message || "unknown build error"
    appendLog(taskId, "build", `[error] pnpm build failed: ${detail}`)
  }

  // Run tests if available
  let testResult: ObservableFacts["test_result"]
  try {
    const result = execFileSync("pnpm", ["test"], {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 120000,
    })
    const passMatch = result.match(/(\d+)\s+pass/i)
    const failMatch = result.match(/(\d+)\s+fail/i)
    testResult = {
      passed: passMatch ? Number(passMatch[1]) : 0,
      failed: failMatch ? Number(failMatch[1]) : 0,
      exit_code: 0,
    }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    if (err.status !== undefined) {
      const output = (err.stdout ?? "") + (err.stderr ?? "")
      const passMatch = output.match(/(\d+)\s+pass/i)
      const failMatch = output.match(/(\d+)\s+fail/i)
      testResult = {
        passed: passMatch ? Number(passMatch[1]) : 0,
        failed: failMatch ? Number(failMatch[1]) : 1,
        exit_code: err.status ?? 1,
      }
    } else {
      testResult = { passed: 0, failed: 1, exit_code: 1 }
    }
  }

  // Run lint if available
  let lintResult: ObservableFacts["lint_result"]
  try {
    const result = execFileSync("pnpm", ["--if-present", "run", "lint"], {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 60000,
    })
    // Count error lines from typical lint output
    const errorMatch = result.match(/(\d+)\s+errors?/i)
    lintResult = {
      errors: errorMatch ? Number(errorMatch[1]) : 0,
      exit_code: 0,
    }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    if (err.status !== undefined) {
      const output = (err.stdout ?? "") + (err.stderr ?? "")
      const errorMatch = output.match(/(\d+)\s+errors?/i)
      lintResult = {
        errors: errorMatch ? Number(errorMatch[1]) : 1,
        exit_code: err.status ?? 1,
      }
    } else {
      lintResult = { errors: 1, exit_code: 1 }
    }
  }

  return {
    exit_code: buildFailed ? Math.max(exitCode, 1) : exitCode,
    files_changed: filesChanged,
    diff_stats: { additions, deletions },
    test_result: testResult,
    lint_result: lintResult,
    branch: `devpane/task-${taskId}`,
    commit_hash: commitHash,
  }
}
