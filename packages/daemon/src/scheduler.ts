import type { Task } from "@devpane/shared"
import { config } from "./config.js"
import { getNextPending, startTask, finishTask, appendLog } from "./db.js"
import { createWorktree } from "./worktree.js"
import { runWorker } from "./worker.js"
import { collectFacts } from "./facts.js"
import { runPm, ingestPmTasks } from "./pm.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let alive = true
let pmConsecutiveFailures = 0

export function stopScheduler(): void {
  alive = false
}

async function callPm(): Promise<Task[]> {
  try {
    const output = await runPm()
    pmConsecutiveFailures = 0
    return ingestPmTasks(output)
  } catch (err) {
    pmConsecutiveFailures++
    const msg = err instanceof Error ? err.message : String(err)
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[scheduler] worker error: ${msg}`)
    finishTask(task.id, "failed", JSON.stringify({ exit_code: 1, error: msg }))
  }

  // Don't remove worktree on success — keep for manual review/merge (Phase 1)
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
