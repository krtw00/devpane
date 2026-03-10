import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { config } from "./config.js"

const WORKTREE_DIR = join(config.PROJECT_ROOT, ".worktrees")

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: config.PROJECT_ROOT, encoding: "utf-8" }).trim()
}

export function createWorktree(taskId: string): string {
  const path = join(WORKTREE_DIR, `task-${taskId}`)
  const branch = `devpane/task-${taskId}`
  git("worktree", "add", path, "-b", branch)
  return path
}

export function removeWorktree(taskId: string): void {
  const path = join(WORKTREE_DIR, `task-${taskId}`)
  if (existsSync(path)) {
    git("worktree", "remove", path, "--force")
  }
  const branch = `devpane/task-${taskId}`
  try {
    git("branch", "-D", branch)
  } catch {
    // branch may already be deleted
  }
}

export function commitWorktree(taskId: string, title: string): string | null {
  const path = join(WORKTREE_DIR, `task-${taskId}`)
  try {
    execFileSync("git", ["add", "-A"], { cwd: path, encoding: "utf-8" })
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: path, encoding: "utf-8" }).trim()
    if (!status) return null // nothing to commit
    execFileSync("git", ["commit", "-m", `task-${taskId}: ${title}`], { cwd: path, encoding: "utf-8" })
    const hash = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path, encoding: "utf-8" }).trim()
    return hash
  } catch {
    return null
  }
}

export function getWorktreeDiff(taskId: string): { filesChanged: string[]; additions: number; deletions: number } {
  const path = join(WORKTREE_DIR, `task-${taskId}`)
  try {
    const nameOnly = execFileSync("git", ["diff", "--name-only", "HEAD~1"], { cwd: path, encoding: "utf-8" }).trim()
    const filesChanged = nameOnly ? nameOnly.split("\n") : []

    const stat = execFileSync("git", ["diff", "--stat", "HEAD~1"], { cwd: path, encoding: "utf-8" }).trim()
    let additions = 0
    let deletions = 0
    const match = stat.match(/(\d+) insertions?\(\+\)/)
    if (match) additions = Number(match[1])
    const match2 = stat.match(/(\d+) deletions?\(-\)/)
    if (match2) deletions = Number(match2[1])

    return { filesChanged, additions, deletions }
  } catch {
    return { filesChanged: [], additions: 0, deletions: 0 }
  }
}
