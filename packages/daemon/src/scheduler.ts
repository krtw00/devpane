import type { Task } from "@devpane/shared"
import { config } from "./config.js"
import { getNextPending, startTask, finishTask, revertToPending, appendLog } from "./db.js"
import { createWorktree, removeWorktree } from "./worktree.js"
import { runWorker } from "./worker.js"
import { collectFacts } from "./facts.js"
import { runPm, ingestPmTasks } from "./pm.js"

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

  let worktreePath: string
  try {
    worktreePath = createWorktree(task.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[scheduler] worktree creation failed: ${msg}`)
    finishTask(task.id, "failed", JSON.stringify({ exit_code: 1, error: msg }))
    return
  }

  try {
    const result = await runWorker(task, worktreePath)
    const facts = collectFacts(task.id, task.title, worktreePath, result.exit_code)
    const status = result.exit_code === 0 ? "done" as const : "failed" as const

    finishTask(task.id, status, JSON.stringify(facts))
    console.log(`[scheduler] task ${task.id} ${status}: ${facts.files_changed.length} files changed`)

    if (isRateLimitError(result.stdout)) {
      await handleRateLimit("Worker")
    } else {
      clearRateLimit()
    }

    // Auto-cleanup worktree for completed tasks
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

export async function startScheduler(): Promise<void> {
  console.log("[scheduler] starting autonomous loop")
  alive = true

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
