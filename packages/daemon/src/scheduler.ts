import type { ActiveHours, Task, PmOutput } from "@devpane/shared"
import { config } from "./config.js"
import { getNextPending, getTasksByStatus, startTask, finishTask, revertToPending, requeueTask, getRetryCount, appendLog, updateTaskCost, recoverOrphanedTasks } from "./db.js"
import { createWorktree, removeWorktree, createPullRequest, autoMergePr, pruneWorktrees, countOpenPrs, pullMain } from "./worktree.js"
import { runWorker } from "./worker.js"
import { collectFacts } from "./facts.js"
import { runPm, ingestPmTasks } from "./pm.js"
import { broadcast } from "./ws.js"
import { emit } from "./events.js"
import { runGate1 } from "./gate1.js"
import { runGate2 } from "./gate2.js"
import { runGate3 } from "./gate.js"
import { runTester } from "./tester.js"
import { circuitBreaker } from "./circuit-breaker.js"
import { runHooks, type TaskCompletedData } from "./scheduler-hooks.js"
import { sendMorningReport } from "./morning-report.js"
import { remember } from "./memory.js"
import { recordTaskMetrics } from "./spc.js"
// Side-effect import: registers all scheduler hooks (SPC, memory, effect measurement)
import "./scheduler-plugins.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const PM_BACKOFF_BASE_SEC = 30
const PM_BACKOFF_MAX_SEC = 300

/** Calculate exponential backoff seconds based on consecutive failure count.
 *  Cooldown triggers every 3 failures: cooldownCount = floor(failures / 3).
 *  Backoff = base * 2^(cooldownCount-1), capped at max. */
export function calculatePmBackoff(consecutiveFailures: number): number {
  const cooldownCount = Math.floor(consecutiveFailures / 3)
  if (cooldownCount <= 0) return PM_BACKOFF_BASE_SEC
  const backoff = PM_BACKOFF_BASE_SEC * Math.pow(2, cooldownCount - 1)
  return Math.min(backoff, PM_BACKOFF_MAX_SEC)
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

export function isWithinActiveHours(hours: ActiveHours | null): boolean {
  if (!hours) return true
  const now = new Date().getHours()
  if (hours.start === hours.end) return false
  if (hours.start < hours.end) {
    return now >= hours.start && now < hours.end
  }
  // 日跨ぎ: start > end (e.g. 22-08)
  return now >= hours.start || now < hours.end
}

let alive = true
let paused = false
let rateLimitHits = 0
let pmConsecutiveFailures = 0
let currentTaskPromise: Promise<void> | null = null
let lastPruneAt = 0

// --- Agent state tracking for Shogun UI ---
export type AgentStatus = "idle" | "running"
export type PipelineStageLabel = "pm" | "gate1" | "tester" | "gate2" | "worker" | "gate3" | "pr" | null

let pmStatus: AgentStatus = "idle"
let workerStatus: AgentStatus = "idle"
let currentTaskId: string | null = null
let currentTaskTitle: string | null = null
let currentStage: PipelineStageLabel = null
let currentTaskStartedAt: string | null = null

function resetWorkerState(): void {
  workerStatus = "idle"
  currentTaskId = null
  currentTaskTitle = null
  currentStage = null
  currentTaskStartedAt = null
}

export function setCurrentStage(stage: PipelineStageLabel, taskId?: string, taskTitle?: string): void {
  currentStage = stage
  if (taskId !== undefined) currentTaskId = taskId
  if (taskTitle !== undefined) currentTaskTitle = taskTitle
  if (stage) {
    broadcast("scheduler:stage", { stage, taskId: currentTaskId, taskTitle: currentTaskTitle })
  }
}

// Re-export from scheduler-plugins for backward compatibility
export { EFFECT_MEASURE_THRESHOLD, checkEffectMeasurement, resetEffectMeasureCounter, setEffectMeasureCounter, getEffectMeasureCounter } from "./scheduler-plugins.js"
export { KAIZEN_THRESHOLD, checkKaizenAnalysis, resetKaizenCounter, setKaizenCounter, getKaizenCounter } from "./scheduler-plugins.js"
import { getEffectMeasureCounter } from "./scheduler-plugins.js"

export function getSchedulerState() {
  return {
    alive,
    paused,
    rateLimitHits,
    pmConsecutiveFailures,
    taskCompletionsSinceLastMeasure: getEffectMeasureCounter(),
    withinActiveHours: isWithinActiveHours(config.ACTIVE_HOURS),
    activeHours: config.ACTIVE_HOURS,
    pm: { status: pmStatus },
    worker: {
      status: workerStatus,
      taskId: currentTaskId,
      taskTitle: currentTaskTitle,
      stage: currentStage,
      startedAt: currentTaskStartedAt,
    },
  }
}

/** @internal テスト用 */
export function resetPmConsecutiveFailures(): void {
  pmConsecutiveFailures = 0
  alive = true
  paused = false
}

/** @internal テスト用 */
export { callPm as _callPm }

export function pauseScheduler(): void {
  paused = true
}

export function resumeScheduler(): void {
  paused = false
}

const SHUTDOWN_TIMEOUT_MS = 30_000

export async function stopScheduler(): Promise<void> {
  alive = false
  stopDailyReportTimer()

  if (currentTaskPromise) {
    await Promise.race([
      currentTaskPromise,
      sleep(SHUTDOWN_TIMEOUT_MS),
    ])
    currentTaskPromise = null
  }

  // Revert any remaining running tasks to pending
  const remaining = getTasksByStatus("running")
  for (const t of remaining) {
    revertToPending(t.id)
  }
}

async function callPm(): Promise<Task[]> {
  emit({ type: "pm.invoked", reason: "queue_empty" })
  pmStatus = "running"
  try {
    const output = await runPm()
    pmStatus = "idle"
    pmConsecutiveFailures = 0
    circuitBreaker.recordSuccess()
    const tasks = ingestPmTasks(output)
    for (const t of tasks) {
      emit({ type: "task.created", taskId: t.id, by: "pm" })
    }
    return tasks
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    pmStatus = "idle"
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

    if (pmConsecutiveFailures % 3 === 0) {
      const backoffSec = calculatePmBackoff(pmConsecutiveFailures)
      console.error(`[scheduler] PM failed ${pmConsecutiveFailures}x, cooling down ${backoffSec}s`)
      for (let i = 0; i < backoffSec && alive && !paused; i++) await sleep(1000)
    } else {
      for (let i = 0; i < config.PM_RETRY_INTERVAL_SEC && alive && !paused; i++) await sleep(1000)
    }
    return []
  }
}

function taskToPmOutput(task: Task): PmOutput {
  const constraints = parseConstraints(task.constraints)
  return {
    tasks: [{ title: task.title, description: task.description, priority: task.priority, constraints: constraints.length > 0 ? constraints : undefined }],
    reasoning: "",
  }
}

export async function executeTask(task: Task): Promise<void> {
  const taskStartTime = Date.now()
  workerStatus = "running"
  currentTaskId = task.id
  currentTaskTitle = task.title
  currentTaskStartedAt = new Date().toISOString()

  // Gate 1: 方針チェック（Worker実行前に弾く）
  setCurrentStage("gate1", task.id, task.title)
  const gate1 = await runGate1(task)
  if (gate1.verdict === "kill") {
    console.log(`[scheduler] Gate 1 KILL task ${task.id}: ${gate1.reasons.join("; ")}`)
    emit({ type: "gate.rejected", taskId: task.id, gate: "gate1", verdict: "kill", reason: gate1.reasons.join("; ") })
    remember("lesson", `[gate1:kill] ${gate1.reasons.join("; ")}`, task.id)
    finishTask(task.id, "failed", JSON.stringify({ gate1, error: gate1.reasons.join("; ") }))
    recordTaskMetrics(task.id, 0, Date.now() - taskStartTime, 0)
    emit({ type: "task.failed", taskId: task.id, rootCause: "scope_creep" })
    broadcast("task:updated", { id: task.id, status: "failed" })
    resetWorkerState()
    return
  }
  if (gate1.verdict === "recycle") {
    console.log(`[scheduler] Gate 1 RECYCLE task ${task.id}: ${gate1.reasons.join("; ")}`)
    emit({ type: "gate.rejected", taskId: task.id, gate: "gate1", verdict: "recycle", reason: gate1.reasons.join("; ") })
    appendLog(task.id, "gate1", `[recycle] ${gate1.reasons.join("; ")}`)
    requeueTask(task.id)
    broadcast("task:updated", { id: task.id, status: "pending" })
    resetWorkerState()
    return
  }
  emit({ type: "gate.passed", taskId: task.id, gate: "gate1" })

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
    emit({ type: "task.failed", taskId: task.id, rootCause: "env_issue" })
    broadcast("task:updated", { id: task.id, status: "failed" })
    resetWorkerState()
    return
  }

  try {
    // Tester: テスト先行生成
    setCurrentStage("tester")
    const spec = taskToPmOutput(task)
    let testFiles: string[] = []
    const GATE2_MAX_RETRIES = 1

    for (let testerAttempt = 0; testerAttempt <= GATE2_MAX_RETRIES; testerAttempt++) {
      console.log(`[scheduler] running tester for task ${task.id}${testerAttempt > 0 ? ` (retry ${testerAttempt})` : ""}`)
      appendLog(task.id, "tester", `[start] tester attempt ${testerAttempt + 1}`)
      const testerResult = await runTester(spec, worktreePath, task.id)
      testFiles = testerResult.testFiles

      if (testerResult.timedOut) {
        console.error(`[scheduler] tester timed out for task ${task.id}, skipping worker`)
        appendLog(task.id, "tester", `[timeout] tester timed out, skipping worker`)
        finishTask(task.id, "failed", JSON.stringify({ error: "tester_timeout" }))
        recordTaskMetrics(task.id, 0, Date.now() - taskStartTime, 0)
        emit({ type: "task.failed", taskId: task.id, rootCause: "timeout" })
        broadcast("task:updated", { id: task.id, status: "failed" })
        removeWorktree(task.id)
        resetWorkerState()
        return
      }

      if (testerResult.exit_code !== 0) {
        console.warn(`[scheduler] tester exited with code ${testerResult.exit_code} for task ${task.id}`)
        appendLog(task.id, "tester", `[warn] exit_code=${testerResult.exit_code}`)
      }

      // Gate 2: テストファイル品質検証
      setCurrentStage("gate2")
      const gate2 = runGate2(spec, testFiles, worktreePath)

      if (gate2.verdict === "go") {
        emit({ type: "gate.passed", taskId: task.id, gate: "gate2" })
        appendLog(task.id, "gate2", `[pass] ${testFiles.length} test files validated`)
        console.log(`[scheduler] Gate 2 PASS task ${task.id}: ${testFiles.length} test files`)
        break
      }

      // Gate 2 recycle
      const reason = gate2.reasons.join("; ")
      if (testerAttempt < GATE2_MAX_RETRIES) {
        emit({ type: "gate.rejected", taskId: task.id, gate: "gate2", verdict: "recycle", reason })
        appendLog(task.id, "gate2", `[recycle] ${reason} — retrying tester`)
        console.log(`[scheduler] Gate 2 RECYCLE task ${task.id}: ${reason}`)
      } else {
        // リトライ上限到達 — テストなしでWorker続行
        emit({ type: "gate.rejected", taskId: task.id, gate: "gate2", verdict: "recycle", reason: `${reason} (max tester retries)` })
        appendLog(task.id, "gate2", `[recycle→skip] ${reason} — proceeding without tests`)
        console.warn(`[scheduler] Gate 2 max retries, proceeding without tests for task ${task.id}`)
        testFiles = []
      }
    }

    setCurrentStage("worker")
    const startTime = Date.now()
    const result = await runWorker(task, worktreePath, testFiles)
    const executionMs = Date.now() - startTime
    const facts = collectFacts(task.id, task.title, worktreePath, result.exit_code)

    // Gate 3: Observable Facts判定（原理1: 判定はコード）
    setCurrentStage("gate3")
    const gate3 = runGate3(task.id, facts)

    let prUrl: string | null = null
    let prMerged = false

    if (gate3.verdict === "kill") {
      console.log(`[scheduler] Gate 3 KILL task ${task.id}: ${gate3.reasons.join("; ")}`)
      emit({ type: "gate.rejected", taskId: task.id, gate: "gate3", verdict: "kill", reason: gate3.reasons.join("; ") })
      remember("lesson", `[gate3:kill] ${gate3.reasons.join("; ")}`, task.id)
      finishTask(task.id, "failed", JSON.stringify({ ...facts, gate3: gate3 }))
      updateTaskCost(task.id, result.cost_usd, result.num_turns)
      const diffSize = facts.diff_stats.additions + facts.diff_stats.deletions
      recordTaskMetrics(task.id, result.cost_usd, executionMs, diffSize)
      emit({ type: "task.failed", taskId: task.id, rootCause: gate3.failure?.root_cause ?? "unknown" })
      await runHooks("task.failed", { task, rootCause: gate3.failure?.root_cause ?? "unknown" })
      broadcast("task:updated", { id: task.id, status: "failed", result: facts })
    } else if (gate3.verdict === "recycle") {
      emit({ type: "gate.rejected", taskId: task.id, gate: "gate3", verdict: "recycle", reason: gate3.reasons.join("; ") })
      remember("lesson", `[gate3:recycle] ${gate3.reasons.join("; ")}`, task.id)
      const retryCount = getRetryCount(task.id)
      updateTaskCost(task.id, result.cost_usd, result.num_turns)
      const diffSize = facts.diff_stats.additions + facts.diff_stats.deletions
      recordTaskMetrics(task.id, result.cost_usd, executionMs, diffSize)

      if (retryCount < config.MAX_RETRIES) {
        console.log(`[scheduler] Gate 3 RECYCLE task ${task.id} (retry ${retryCount + 1}/${config.MAX_RETRIES}): ${gate3.reasons.join("; ")}`)
        requeueTask(task.id)
        appendLog(task.id, "system", `[gate3] recycled (retry ${retryCount + 1}/${config.MAX_RETRIES}): ${gate3.reasons.join("; ")}`)
        broadcast("task:updated", { id: task.id, status: "pending" })
      } else {
        console.log(`[scheduler] Gate 3 RECYCLE→KILL task ${task.id} (max retries ${config.MAX_RETRIES}): ${gate3.reasons.join("; ")}`)
        finishTask(task.id, "failed", JSON.stringify({ ...facts, gate3: { ...gate3, verdict: "kill", reasons: [...gate3.reasons, `max retries (${config.MAX_RETRIES}) exceeded`] } }))
        emit({ type: "task.failed", taskId: task.id, rootCause: gate3.failure?.root_cause ?? "unknown" })
        await runHooks("task.failed", { task, rootCause: gate3.failure?.root_cause ?? "unknown" })
        broadcast("task:updated", { id: task.id, status: "failed", result: facts })
      }
    } else {
      // Gate 3 passed → PR作成
      emit({ type: "task.started", taskId: task.id, workerId })
      emit({ type: "gate.passed", taskId: task.id, gate: "gate3" })
      updateTaskCost(task.id, result.cost_usd, result.num_turns)
      const diffSize = facts.diff_stats.additions + facts.diff_stats.deletions

      console.log(`[scheduler] task ${task.id} done: ${facts.files_changed.length} files changed`)

      // PR作成 → 自動マージ
      setCurrentStage("pr")
      if (facts.commit_hash) {
        prUrl = createPullRequest(task.id, task.title, facts)
        if (prUrl) {
          console.log(`[scheduler] PR created for task ${task.id}: ${prUrl}`)
          appendLog(task.id, "system", `[pr] ${prUrl}`)
          emit({ type: "pr.created", taskId: task.id, url: prUrl })

          // Gate3通過済みなので自動マージ → baseブランチを最新化
          const merged = autoMergePr(task.id)
          if (merged) {
            console.log(`[scheduler] auto-merged PR for task ${task.id}`)
            appendLog(task.id, "system", `[auto-merge] done`)
            prMerged = true
            pullMain()
          } else {
            console.warn(`[scheduler] auto-merge failed for task ${task.id}, PR remains open`)
          }
        } else {
          console.error(`[scheduler] PR creation failed for task ${task.id}`)
          emit({ type: "pr.failed", taskId: task.id })
        }
      }

      // finishTaskはPR作成の成否が確定した後に1回だけ呼ぶ
      if (prUrl) {
        finishTask(task.id, "done", JSON.stringify(facts))
        emit({ type: "task.completed", taskId: task.id, costUsd: result.cost_usd })
        broadcast("task:updated", { id: task.id, status: "done", result: facts })
      } else {
        finishTask(task.id, "failed", JSON.stringify({ ...facts, pr_creation_failed: true }))
        broadcast("task:updated", { id: task.id, status: "failed" })
      }
      recordTaskMetrics(task.id, result.cost_usd, executionMs, diffSize)

      // Run registered post-task hooks (SPC, memory, effect measurement)
      // PR作成が成功した場合のみhooksを実行する
      if (prUrl) {
        const hookData: TaskCompletedData = {
          task,
          costUsd: result.cost_usd,
          numTurns: result.num_turns,
          executionMs,
          facts,
          prUrl,
        }
        await runHooks("task.completed", hookData)
      }
    }

    console.log(`[scheduler] task ${task.id} cost: $${result.cost_usd.toFixed(4)}, turns: ${result.num_turns}`)

    if (isRateLimitError(result.result_text)) {
      rateLimitHits++
      circuitBreaker.recordFailure()
    } else {
      circuitBreaker.recordSuccess()
    }

    // Cleanup worktree (keep branch only if PR exists but not yet merged)
    const keepBranch = !!prUrl && !prMerged
    try {
      removeWorktree(task.id, keepBranch)
      console.log(`[scheduler] cleaned up worktree for task ${task.id}${keepBranch ? " (branch kept for PR)" : ""}`)
    } catch (cleanupErr) {
      const cleanupMsg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
      console.warn(`[scheduler] worktree cleanup failed for ${task.id}: ${cleanupMsg}`)
    }
    resetWorkerState()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (isRateLimitError(msg)) {
      rateLimitHits++
      revertToPending(task.id)
      broadcast("task:updated", { id: task.id, status: "pending" })
      circuitBreaker.recordFailure()
    } else {
      console.error(`[scheduler] worker error: ${msg}`)
      finishTask(task.id, "failed", JSON.stringify({ exit_code: 1, error: msg }))
      emit({ type: "task.failed", taskId: task.id, rootCause: "env_issue" })
      await runHooks("task.failed", { task, rootCause: "env_issue" })
      broadcast("task:updated", { id: task.id, status: "failed" })

      // Record SPC metrics if cost is available on the error
      const costUsd = (err as Record<string, unknown>)?.cost_usd
      if (typeof costUsd === "number") {
        recordTaskMetrics(task.id, costUsd, 0, 0)
      }
    }

    // Cleanup worktree on failure too
    try {
      removeWorktree(task.id)
    } catch {
      // ignore cleanup errors on failure path
    }
    resetWorkerState()
  }
}

let dailyReportTimer: ReturnType<typeof setInterval> | null = null
let shiftStartIso: string | null = null
let wasWithinHours = false

function startDailyReportTimer(): void {
  // Check every 60s: when transitioning OUT of active hours, send morning report
  dailyReportTimer = setInterval(() => {
    const withinHours = isWithinActiveHours(config.ACTIVE_HOURS)

    // Transition: active → inactive = shift ended
    if (wasWithinHours && !withinHours && shiftStartIso) {
      console.log("[scheduler] shift ended, sending morning report")
      sendMorningReport(shiftStartIso).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[scheduler] morning report failed: ${msg}`)
        emit({ type: "morning_report.failed", error: msg })
      })
      shiftStartIso = null
    }

    // Transition: inactive → active = shift started
    if (!wasWithinHours && withinHours) {
      shiftStartIso = new Date().toISOString()
      console.log(`[scheduler] shift started at ${shiftStartIso}`)
    }

    wasWithinHours = withinHours
  }, 60_000)
}

function stopDailyReportTimer(): void {
  if (dailyReportTimer) {
    clearInterval(dailyReportTimer)
    dailyReportTimer = null
  }
}

export function recoverOrphanTasks(): void {
  const orphans = getTasksByStatus("running")
  if (orphans.length === 0) return
  const recoveredIds = recoverOrphanedTasks(config.WORKER_TIMEOUT_MS, config.MAX_RETRIES)
  if (recoveredIds.length > 0) {
    console.log(`[scheduler] recovered ${recoveredIds.length} orphan tasks (timeout: ${config.WORKER_TIMEOUT_MS}ms, maxRetries: ${config.MAX_RETRIES})`)
    for (const id of recoveredIds) {
      try {
        removeWorktree(id)
      } catch {
        // ignore cleanup errors during recovery
      }
      appendLog(id, "system", "[recovery] orphan task recovered on daemon restart")
    }
  }
}

export async function startScheduler(): Promise<void> {
  console.log("[scheduler] starting autonomous loop")
  alive = true
  try {
    pruneWorktrees()
  } catch (err) {
    console.error(`[scheduler] initial prune failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  lastPruneAt = Date.now()
  recoverOrphanTasks()

  // Initialize shift tracking
  wasWithinHours = isWithinActiveHours(config.ACTIVE_HOURS)
  if (wasWithinHours) {
    shiftStartIso = new Date().toISOString()
    console.log(`[scheduler] starting within active hours, shift started at ${shiftStartIso}`)
  }
  startDailyReportTimer()

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
      for (let i = 0; i < backoff && alive && !paused; i++) await sleep(1000)
      continue
    }

    // Periodic prune: 一定時間経過でworktree/branch掃除
    if (Date.now() - lastPruneAt >= config.PRUNE_INTERVAL_HOURS * 60 * 60 * 1000) {
      try {
        pruneWorktrees()
      } catch (err) {
        console.error(`[scheduler] periodic prune failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      lastPruneAt = Date.now()
    }

    // Active Hours: 稼働時間外ならタスク実行をスキップ
    if (!isWithinActiveHours(config.ACTIVE_HOURS)) {
      emit({ type: "scheduler.outside_hours" })
      console.log(`[scheduler] outside active hours, idling ${config.IDLE_INTERVAL_SEC}s`)
      for (let i = 0; i < config.IDLE_INTERVAL_SEC && alive && !paused; i++) await sleep(1000)
      continue
    }

    // WIP制限: 直列実行（WIP=1）— PRマージ後にmain pullしてから次タスク
    const openPrs = countOpenPrs()
    if (openPrs === null) {
      console.warn(`[scheduler] countOpenPrs failed, skipping task start for safety`)
      await sleep(config.IDLE_INTERVAL_SEC * 1000)
      continue
    }
    if (openPrs >= config.MAX_OPEN_PRS) {
      console.log(`[scheduler] WIP limit: ${openPrs} open PRs (max ${config.MAX_OPEN_PRS}), waiting...`)
      for (let i = 0; i < config.IDLE_INTERVAL_SEC && alive && !paused; i++) await sleep(1000)
      continue
    }
    // PRがなくなった = マージされた → mainを最新化してコンフリクト防止
    pullMain()

    // 1. Check for pending tasks
    let task = getNextPending()

    // 2. If no pending tasks, ask PM to generate some
    if (!task) {
      console.log("[scheduler] queue empty, asking PM for tasks...")
      const created = await callPm()

      if (created.length === 0) {
        console.log(`[scheduler] PM returned no tasks, idling ${config.IDLE_INTERVAL_SEC}s`)
        for (let i = 0; i < config.IDLE_INTERVAL_SEC && alive && !paused; i++) await sleep(1000)
        continue
      }

      console.log(`[scheduler] PM created ${created.length} tasks`)
      for (const t of created) broadcast("task:created", t)
      task = getNextPending()
      if (!task) continue
    }

    // 3. Execute the task
    currentTaskPromise = executeTask(task)
    await currentTaskPromise
    currentTaskPromise = null

    // 4. Brief pause between tasks to avoid hammering
    await sleep(1000)
  }

  console.log("[scheduler] loop stopped")
}
