import type { Task } from "@devpane/shared"
import { config } from "./config.js"
import { getNextPending, getTasksByStatus, startTask, finishTask, revertToPending, appendLog, updateTaskCost } from "./db.js"
import { createWorktree, removeWorktree, mergeToMain } from "./worktree.js"
import { runWorker } from "./worker.js"
import { collectFacts } from "./facts.js"
import { runPm, ingestPmTasks } from "./pm.js"
import { broadcast } from "./ws.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /429/,
  /quota/i,
  /overloaded/i,
]

export function isRateLimitError(message: string): boolean {
  return RATE_LIMIT_PATTERNS.some(p => p.test(message))
}

// Exponential backoff: 60s → 120s → 300s → 600s (max)
const RATE_LIMIT_BACKOFFS = [60, 120, 300, 600]

let alive = true
let pmConsecutiveFailures = 0
let rateLimitHits = 0

export function stopScheduler(): void {
  alive = false
}

function getRateLimitBackoff(): number {
  const idx = Math.min(rateLimitHits, RATE_LIMIT_BACKOFFS.length - 1)
  return RATE_LIMIT_BACKOFFS[idx]
}

async function handleRateLimit(context: string): Promise<void> {
  const backoffSec = getRateLimitBackoff()
  rateLimitHits++
  console.warn(`[scheduler] rate limit hit during ${context} (${rateLimitHits}x), backing off ${backoffSec}s`)
  appendLog("scheduler", "system", `[rate-limit] ${context}: backing off ${backoffSec}s (hit #${rateLimitHits})`)
  await sleep(backoffSec * 1000)
}

function clearRateLimit(): void {
  if (rateLimitHits > 0) {
    console.log(`[scheduler] rate limit cleared (was ${rateLimitHits} hits)`)
    rateLimitHits = 0
  }
}

async function callPm(): Promise<Task[]> {
  try {
    const output = await runPm()
    pmConsecutiveFailures = 0
    clearRateLimit()
    return ingestPmTasks(output)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (isRateLimitError(msg)) {
      await handleRateLimit("PM")
      return []
    }

    pmConsecutiveFailures++
    console.error(`[scheduler] PM failed (${pmConsecutiveFailures}x): ${msg}`)
    appendLog("scheduler", "pm", `[error] PM failed: ${msg}`)

    if (pmConsecutiveFailures >= 3) {
      console.error(`[scheduler] PM failed 3x, cooling down ${config.COOLDOWN_INTERVAL_SEC}s`)
      await sleep(config.COOLDOWN_INTERVAL_SEC * 1000)
      pmConsecutiveFailures = 0
    } else {
      await sleep(config.PM_RETRY_INTERVAL_SEC * 1000)
    }
    return []
  }
}

async function executeTask(task: Task): Promise<void> {
  const workerId = "worker-0"
  console.log(`[scheduler] starting task ${task.id}: ${task.title}`)
  startTask(task.id, workerId)
  broadcast("task:updated", { id: task.id, status: "running", assigned_to: workerId })

  let worktreePath: string
  try {
    worktreePath = createWorktree(task.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[scheduler] worktree creation failed: ${msg}`)
    finishTask(task.id, "failed", JSON.stringify({ exit_code: 1, error: msg }))
    broadcast("task:updated", { id: task.id, status: "failed" })
    return
  }

  try {
    const result = await runWorker(task, worktreePath)
    const facts = collectFacts(task.id, task.title, worktreePath, result.exit_code)
    const status = result.exit_code === 0 ? "done" as const : "failed" as const

    finishTask(task.id, status, JSON.stringify(facts))
    updateTaskCost(task.id, result.cost_usd, result.num_turns)
    broadcast("task:updated", { id: task.id, status, result: facts })
    console.log(`[scheduler] task ${task.id} ${status}: ${facts.files_changed.length} files changed`)

    console.log(`[scheduler] task ${task.id} cost: $${result.cost_usd.toFixed(4)}, turns: ${result.num_turns}`)

    // Merge successful tasks to main
    if (status === "done" && facts.commit_hash) {
      try {
        mergeToMain(task.id, task.title)
        console.log(`[scheduler] merged task ${task.id} to main`)
      } catch (mergeErr) {
        const mergeMsg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr)
        console.error(`[scheduler] merge failed for ${task.id}: ${mergeMsg}`)
      }
    }

    if (isRateLimitError(result.result_text)) {
      await handleRateLimit("Worker")
    } else {
      clearRateLimit()
    }

    // Cleanup worktree after merge
    try {
      removeWorktree(task.id)
      console.log(`[scheduler] cleaned up worktree for task ${task.id}`)
    } catch (cleanupErr) {
      const cleanupMsg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
      console.warn(`[scheduler] worktree cleanup failed for ${task.id}: ${cleanupMsg}`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (isRateLimitError(msg)) {
      revertToPending(task.id)
      await handleRateLimit("Worker")
    } else {
      console.error(`[scheduler] worker error: ${msg}`)
      finishTask(task.id, "failed", JSON.stringify({ exit_code: 1, error: msg }))
    }

    // Cleanup worktree on failure too
    try {
      removeWorktree(task.id)
    } catch {
      // ignore cleanup errors on failure path
    }
  }
}

function recoverOrphanTasks(): void {
  const orphans = getTasksByStatus("running")
  if (orphans.length === 0) return
  console.log(`[scheduler] recovering ${orphans.length} orphan running tasks → pending`)
  for (const t of orphans) {
    removeWorktree(t.id)
    revertToPending(t.id)
    appendLog(t.id, "system", "[recovery] reverted to pending on daemon restart")
  }
}

export async function startScheduler(): Promise<void> {
  console.log("[scheduler] starting autonomous loop")
  alive = true
  recoverOrphanTasks()

  while (alive) {
    // 1. Check for pending tasks
    let task = getNextPending()

    // 2. If no pending tasks, ask PM to generate some
    if (!task) {
      console.log("[scheduler] queue empty, asking PM for tasks...")
      const created = await callPm()

      if (created.length === 0) {
        console.log(`[scheduler] PM returned no tasks, idling ${config.IDLE_INTERVAL_SEC}s`)
        await sleep(config.IDLE_INTERVAL_SEC * 1000)
        continue
      }

      console.log(`[scheduler] PM created ${created.length} tasks`)
      for (const t of created) broadcast("task:created", t)
      task = getNextPending()
      if (!task) continue
    }

    // 3. Execute the task
    await executeTask(task)

    // 4. Brief pause between tasks to avoid hammering
    await sleep(1000)
  }

  console.log("[scheduler] loop stopped")
}
