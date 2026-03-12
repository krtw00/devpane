import type { Task } from "@devpane/shared"
import { config } from "./config.js"
import { getNextPending, getTasksByStatus, startTask, finishTask, revertToPending, requeueTask, getRetryCount, appendLog, updateTaskCost } from "./db.js"
import { createWorktree, removeWorktree, createPullRequest, getWorktreeNewAndDeleted, pruneWorktrees, countOpenPrs } from "./worktree.js"
import { runWorker } from "./worker.js"
import { collectFacts } from "./facts.js"
import { runPm, ingestPmTasks } from "./pm.js"
import { broadcast } from "./ws.js"
import { remember, forget, findSimilar } from "./memory.js"
import { emit, safeEmit } from "./events.js"
import { runGate1 } from "./gate1.js"
import { runGate3 } from "./gate.js"
import { recordTaskMetrics, checkAllMetrics } from "./spc.js"
import { circuitBreaker } from "./circuit-breaker.js"
import { getActiveImprovements } from "./db.js"
import { measureAllActive } from "./effect-measure.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseConstraints(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === "string")
  } catch { /* ignore malformed JSON */ }
  return []
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

let alive = true
let paused = false
let rateLimitHits = 0
let pmConsecutiveFailures = 0
let taskCompletionsSinceLastMeasure = 0

export const EFFECT_MEASURE_THRESHOLD = 10

export function checkEffectMeasurement(): void {
  const actives = getActiveImprovements()
  if (actives.length === 0) {
    taskCompletionsSinceLastMeasure = 0
    return
  }

  if (taskCompletionsSinceLastMeasure < EFFECT_MEASURE_THRESHOLD) return

  taskCompletionsSinceLastMeasure = 0
  console.log(`[scheduler] running effect measurement for ${actives.length} active improvements`)
  const results = measureAllActive()
  for (const r of results) {
    console.log(`[scheduler] improvement ${r.improvementId}: ${r.verdict} (${(r.beforeFailureRate * 100).toFixed(1)}% → ${(r.afterFailureRate * 100).toFixed(1)}%)`)
  }
}

export function getSchedulerState() {
  return { alive, rateLimitHits, pmConsecutiveFailures, taskCompletionsSinceLastMeasure }
}

export function pauseScheduler(): void {
  paused = true
}

export function resumeScheduler(): void {
  paused = false
}

export function stopScheduler(): void {
  alive = false
}

export function resetEffectMeasureCounter(): void {
  taskCompletionsSinceLastMeasure = 0
}

export function setEffectMeasureCounter(n: number): void {
  taskCompletionsSinceLastMeasure = n
}

async function callPm(): Promise<Task[]> {
  emit({ type: "pm.invoked", reason: "queue_empty" })
  try {
    const output = await runPm()
    pmConsecutiveFailures = 0
    circuitBreaker.recordSuccess()
    const tasks = ingestPmTasks(output)
    for (const t of tasks) {
      emit({ type: "task.created", taskId: t.id, by: "pm" })
    }
    return tasks
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (isRateLimitError(msg)) {
      rateLimitHits++
      circuitBreaker.recordFailure()
      console.warn(`[scheduler] rate limit hit during PM, circuit: ${circuitBreaker.getState()}`)
      appendLog("scheduler", "system", `[rate-limit] PM: circuit ${circuitBreaker.getState()}`)
      return []
    }

    pmConsecutiveFailures++
    emit({ type: "pm.failed", error: msg, consecutiveCount: pmConsecutiveFailures })
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
  // Gate 1: 方針チェック（Worker実行前に弾く）
  const gate1 = await runGate1(task)
  if (gate1.verdict === "kill") {
    console.log(`[scheduler] Gate 1 KILL task ${task.id}: ${gate1.reasons.join("; ")}`)
    finishTask(task.id, "failed", JSON.stringify({ gate1, error: gate1.reasons.join("; ") }))
    emit({ type: "task.failed", taskId: task.id, rootCause: "scope_creep" })
    broadcast("task:updated", { id: task.id, status: "failed" })
    return
  }

  const workerId = "worker-0"
  console.log(`[scheduler] starting task ${task.id}: ${task.title}`)
  startTask(task.id, workerId)
  emit({ type: "task.started", taskId: task.id, workerId })
  broadcast("task:updated", { id: task.id, status: "running", assigned_to: workerId })

  let worktreePath: string
  try {
    worktreePath = createWorktree(task.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[scheduler] worktree creation failed: ${msg}`)
    finishTask(task.id, "failed", JSON.stringify({ exit_code: 1, error: msg }))
    emit({ type: "task.failed", taskId: task.id, rootCause: "env_issue" })
    broadcast("task:updated", { id: task.id, status: "failed" })
    return
  }

  try {
    const startTime = Date.now()
    const result = await runWorker(task, worktreePath)
    const executionMs = Date.now() - startTime
    const facts = collectFacts(task.id, task.title, worktreePath, result.exit_code)

    // Gate 3: Observable Facts判定（原理1: 判定はコード）
    const gate3 = runGate3(task.id, facts)

    if (gate3.verdict === "kill") {
      console.log(`[scheduler] Gate 3 KILL task ${task.id}: ${gate3.reasons.join("; ")}`)
      finishTask(task.id, "failed", JSON.stringify({ ...facts, gate3: gate3 }))
      updateTaskCost(task.id, result.cost_usd, result.num_turns)
      emit({ type: "task.failed", taskId: task.id, rootCause: gate3.failure?.root_cause ?? "unknown" })
      broadcast("task:updated", { id: task.id, status: "failed", result: facts })
    } else if (gate3.verdict === "recycle") {
      const MAX_RETRIES = 2
      const retryCount = getRetryCount(task.id)
      updateTaskCost(task.id, result.cost_usd, result.num_turns)

      if (retryCount < MAX_RETRIES) {
        console.log(`[scheduler] Gate 3 RECYCLE task ${task.id} (retry ${retryCount + 1}/${MAX_RETRIES}): ${gate3.reasons.join("; ")}`)
        requeueTask(task.id)
        appendLog(task.id, "system", `[gate3] recycled (retry ${retryCount + 1}/${MAX_RETRIES}): ${gate3.reasons.join("; ")}`)
        emit({ type: "task.started", taskId: task.id, workerId: "requeued" })
        broadcast("task:updated", { id: task.id, status: "pending" })
      } else {
        console.log(`[scheduler] Gate 3 RECYCLE→KILL task ${task.id} (max retries ${MAX_RETRIES}): ${gate3.reasons.join("; ")}`)
        finishTask(task.id, "failed", JSON.stringify({ ...facts, gate3: { ...gate3, verdict: "kill", reasons: [...gate3.reasons, `max retries (${MAX_RETRIES}) exceeded`] } }))
        emit({ type: "task.failed", taskId: task.id, rootCause: gate3.failure?.root_cause ?? "unknown" })
        broadcast("task:updated", { id: task.id, status: "failed", result: facts })
      }
    } else {
      // Gate 3 passed → PR作成
      finishTask(task.id, "done", JSON.stringify(facts))
      updateTaskCost(task.id, result.cost_usd, result.num_turns)

      // SPC: メトリクス記録 + 管理図チェック
      const diffSize = facts.diff_stats.additions + facts.diff_stats.deletions
      recordTaskMetrics(task.id, result.cost_usd, executionMs, diffSize)
      const spcAlerts = checkAllMetrics(task.id, result.cost_usd, executionMs, diffSize)
      for (const alert of spcAlerts) {
        if (alert.alert) {
          safeEmit({ type: "spc.alert", metric: alert.metric, value: alert.value, ucl: alert.ucl })
          console.warn(`[scheduler] SPC alert: ${alert.metric} = ${alert.value.toFixed(4)} (UCL: ${alert.ucl.toFixed(4)}) — ${alert.reason}`)
        }
      }

      emit({ type: "task.completed", taskId: task.id, costUsd: result.cost_usd })
      broadcast("task:updated", { id: task.id, status: "done", result: facts })
      console.log(`[scheduler] task ${task.id} done: ${facts.files_changed.length} files changed`)

      // PR作成
      if (facts.commit_hash) {
        const { added, deleted } = getWorktreeNewAndDeleted(task.id)
        const prUrl = createPullRequest(task.id, task.title, facts)
        if (prUrl) {
          console.log(`[scheduler] PR created for task ${task.id}: ${prUrl}`)
          appendLog(task.id, "system", `[pr] ${prUrl}`)
          emit({ type: "pr.created", taskId: task.id, url: prUrl })

          for (const file of added) {
            remember("feature", `${file} を追加（${task.title}）`, task.id)
          }
          for (const file of deleted) {
            const existing = findSimilar("feature", file)
            for (const m of existing) forget(m.id)
          }

          // 構造化仕様のconstraints → decision記憶
          const constraints = parseConstraints(task.constraints)
          for (const c of constraints) {
            remember("decision", c, task.id)
          }

          const memoryCount = added.length + constraints.length
          if (memoryCount > 0 || deleted.length > 0) {
            console.log(`[scheduler] memory: +${added.length} features, +${constraints.length} decisions, -${deleted.length} forgotten`)
          }
        } else {
          console.error(`[scheduler] PR creation failed for task ${task.id}`)
        }
      }
    }

    console.log(`[scheduler] task ${task.id} cost: $${result.cost_usd.toFixed(4)}, turns: ${result.num_turns}`)

    // 効果測定: タスク完了カウンターをインクリメント
    taskCompletionsSinceLastMeasure++
    checkEffectMeasurement()

    if (isRateLimitError(result.result_text)) {
      rateLimitHits++
      circuitBreaker.recordFailure()
    } else {
      circuitBreaker.recordSuccess()
    }

    // Cleanup worktree (keep branch if PR was created)
    const hasPr = gate3.verdict === "go" && facts.commit_hash
    try {
      removeWorktree(task.id, !!hasPr)
      console.log(`[scheduler] cleaned up worktree for task ${task.id}${hasPr ? " (branch kept for PR)" : ""}`)
    } catch (cleanupErr) {
      const cleanupMsg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
      console.warn(`[scheduler] worktree cleanup failed for ${task.id}: ${cleanupMsg}`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (isRateLimitError(msg)) {
      rateLimitHits++
      revertToPending(task.id)
      circuitBreaker.recordFailure()
    } else {
      console.error(`[scheduler] worker error: ${msg}`)
      finishTask(task.id, "failed", JSON.stringify({ exit_code: 1, error: msg }))
      emit({ type: "task.failed", taskId: task.id, rootCause: "env_issue" })
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
  pruneWorktrees()
  recoverOrphanTasks()

  while (alive) {
    // Pause: 一時停止中はスリープしてスキップ
    if (paused) {
      await sleep(1000)
      continue
    }

    // Circuit Breaker: open状態なら全リクエストをスキップ
    if (!circuitBreaker.canProceed()) {
      const backoff = circuitBreaker.getBackoffSec()
      console.log(`[scheduler] circuit open, skipping cycle (backoff: ${backoff}s)`)
      await sleep(backoff * 1000)
      continue
    }

    // WIP制限: 未マージPR数が上限以上ならスキップ
    const MAX_OPEN_PRS = 5
    const openPrs = countOpenPrs()
    if (openPrs >= MAX_OPEN_PRS) {
      console.log(`[scheduler] WIP limit: ${openPrs} open PRs (max ${MAX_OPEN_PRS}), waiting...`)
      await sleep(config.IDLE_INTERVAL_SEC * 1000)
      continue
    }

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
