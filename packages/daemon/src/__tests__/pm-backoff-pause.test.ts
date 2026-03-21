import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// --- Mocks ---

vi.mock("../events.js", () => ({
  emit: vi.fn(),
  safeEmit: vi.fn(() => true),
}))

const mockRunPm = vi.fn()
vi.mock("../pm.js", () => ({
  runPm: (...args: unknown[]) => mockRunPm(...args),
  ingestPmTasks: vi.fn(() => []),
}))

vi.mock("../circuit-breaker.js", () => ({
  circuitBreaker: {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    canProceed: vi.fn(() => true),
    getState: vi.fn(() => "closed"),
    getBackoffSec: vi.fn(() => 0),
  },
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

const mockSendMessage = vi.fn(() => Promise.resolve())
vi.mock("../notifier-factory.js", () => ({
  getNotifier: vi.fn(() => ({
    sendMessage: mockSendMessage,
    sendReport: vi.fn(),
    notify: vi.fn(),
  })),
}))

vi.mock("../db.js", () => ({
  getNextPending: vi.fn(() => null),
  getTasksByStatus: vi.fn(() => []),
  startTask: vi.fn(),
  finishTask: vi.fn(),
  revertToPending: vi.fn(),
  requeueTask: vi.fn(),
  getRetryCount: vi.fn(() => 0),
  appendLog: vi.fn(),
  updateTaskCost: vi.fn(),
  insertAgentEvent: vi.fn(),
  getAgentEvents: vi.fn(() => []),
  getDb: vi.fn(),
  recoverOrphanedTasks: vi.fn(() => []),
  suppressTerminalFailedTask: vi.fn(() => null),
  suppressTerminalFailedTasks: vi.fn(() => []),
}))

vi.mock("../worktree.js", () => ({
  createWorktree: vi.fn(() => "/tmp/test-worktree"),
  removeWorktree: vi.fn(),
  createPullRequest: vi.fn(),
  autoMergePr: vi.fn(),
  pruneWorktrees: vi.fn(),
  countOpenPrs: vi.fn(() => 0),
  pullMain: vi.fn(),
  getWorktreeNewAndDeleted: vi.fn(() => ({ added: [], deleted: [] })),
}))

vi.mock("../worker.js", () => ({
  runWorker: vi.fn(),
  killAllWorkers: vi.fn(),
}))

vi.mock("../facts.js", () => ({
  collectFacts: vi.fn(),
}))

vi.mock("../gate1.js", () => ({
  runGate1: vi.fn(),
}))

vi.mock("../gate2.js", () => ({
  runGate2: vi.fn(),
}))

vi.mock("../gate.js", () => ({
  runGate3: vi.fn(),
}))

vi.mock("../tester.js", () => ({
  runTester: vi.fn(),
  buildTesterPrompt: vi.fn(() => "prompt"),
}))

vi.mock("../pr-agent.js", () => ({
  runPrAgent: vi.fn(),
}))

vi.mock("../scheduler-hooks.js", () => ({
  runHooks: vi.fn(),
}))

vi.mock("../memory.js", () => ({
  remember: vi.fn(),
  forget: vi.fn(),
  findSimilar: vi.fn(() => []),
  cleanupOldLessons: vi.fn(() => 0),
}))

vi.mock("../scheduler-plugins.js", () => ({
  EFFECT_MEASURE_THRESHOLD: 10,
  checkEffectMeasurement: vi.fn(),
  resetEffectMeasureCounter: vi.fn(),
  setEffectMeasureCounter: vi.fn(),
  getEffectMeasureCounter: vi.fn(() => 0),
  KAIZEN_THRESHOLD: 10,
  checkKaizenAnalysis: vi.fn(),
  resetKaizenCounter: vi.fn(),
  setKaizenCounter: vi.fn(),
  getKaizenCounter: vi.fn(() => 0),
  parseConstraints: (raw: string | null) => { if (!raw) return []; try { const p = JSON.parse(raw); if (Array.isArray(p)) return p.filter((s: unknown): s is string => typeof s === "string"); } catch {} return [] },
}))

vi.mock("../discord.js", () => ({
  notify: vi.fn(() => Promise.resolve()),
}))

vi.mock("../spc.js", () => ({
  recordTaskMetrics: vi.fn(),
  checkAllMetrics: vi.fn(() => []),
  recordMetric: vi.fn(),
  checkMetric: vi.fn(),
}))

vi.mock("../morning-report.js", () => ({
  sendMorningReport: vi.fn(),
}))

vi.mock("../kaizen.js", () => ({
  analyze: vi.fn(),
}))

vi.mock("../effect-measure.js", () => ({
  measureAllActive: vi.fn(() => []),
}))

const mockConfig = {
  PROJECT_ROOT: "/tmp",
  WORKER_TIMEOUT_MS: 600000,
  PM_TIMEOUT_MS: 300000,
  IDLE_INTERVAL_SEC: 60,
  PM_RETRY_INTERVAL_SEC: 30,
  COOLDOWN_INTERVAL_SEC: 300,
  WORKER_CONCURRENCY: 1,
  DB_PATH: "/tmp/test.db",
  API_PORT: 3001,
  MAX_RETRIES: 2,
  MAX_DIFF_SIZE: 500,
  MAX_OPEN_PRS: 1,
  ACTIVE_HOURS: null as { start: number; end: number } | null,
}

vi.mock("../config.js", () => ({
  config: mockConfig,
}))

/** fake timer環境で、指定ms以内にpromiseが解決するか判定 */
async function resolvesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let resolved = false
  const race = promise.then(() => { resolved = true })
  await vi.advanceTimersByTimeAsync(ms)
  await Promise.race([race, Promise.resolve()])
  return resolved
}

describe("callPm内バックオフsleepがpause/stopに即座に応答する", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockConfig.ACTIVE_HOURS = null
    mockConfig.PM_RETRY_INTERVAL_SEC = 30
  })

  afterEach(async () => {
    // テスト後はreal timersに戻してからstop（タイムアウト回避）
    vi.useRealTimers()
  })

  it("_callPm直接呼び出し: pause中はリトライsleep(PM_RETRY_INTERVAL_SEC)が即座に終了する", async () => {
    const { _callPm, pauseScheduler, resumeScheduler, resetPmConsecutiveFailures } = await import("../scheduler.js")

    resetPmConsecutiveFailures()
    mockRunPm.mockRejectedValue(new Error("PM internal error"))

    // pause状態にしてからcallPm
    pauseScheduler()

    const callPromise = _callPm()

    // 修正後: sleep内で毎秒pausedフラグをチェックするため、2秒で抜けるはず
    // 修正前: sleep(30000)はフラグを見ないので30秒必要
    const done = await resolvesWithin(callPromise, 2000)

    expect(done).toBe(true)
    expect(mockRunPm).toHaveBeenCalled()

    // cleanup
    resumeScheduler()
  })

  it("_callPm直接呼び出し: stop(alive=false)中はリトライsleepが即座に終了する", async () => {
    const { _callPm, stopScheduler, resetPmConsecutiveFailures } = await import("../scheduler.js")

    resetPmConsecutiveFailures()
    mockRunPm.mockRejectedValue(new Error("PM internal error"))

    // alive=falseにしてからcallPm
    await stopScheduler()

    const callPromise = _callPm()

    const done = await resolvesWithin(callPromise, 2000)

    expect(done).toBe(true)
    expect(mockRunPm).toHaveBeenCalled()
  })

  it("_callPm直接呼び出し: 3の倍数回失敗時のクールダウンsleepもpause中は即座に終了する", async () => {
    const mod = await import("../scheduler.js")

    // pmConsecutiveFailuresを2にセットし、次の失敗で3の倍数になるようにする
    mod.resetPmConsecutiveFailures()
    mockRunPm.mockRejectedValue(new Error("PM internal error"))

    // 2回失敗させてpmConsecutiveFailures=2にする
    // 各呼び出しでPM_RETRY_INTERVAL_SEC秒のsleepがあるのでそれを進める
    const p1 = mod._callPm()
    await vi.advanceTimersByTimeAsync(mockConfig.PM_RETRY_INTERVAL_SEC * 1000 + 1000)
    await p1

    const p2 = mod._callPm()
    await vi.advanceTimersByTimeAsync(mockConfig.PM_RETRY_INTERVAL_SEC * 1000 + 1000)
    await p2

    // 3回目失敗 → calculatePmBackoff(3) = 30秒のクールダウンsleep
    // pause状態にしてから呼ぶ
    mod.pauseScheduler()

    const p3 = mod._callPm()
    const done = await resolvesWithin(p3, 2000)

    expect(done).toBe(true)
    expect(mockRunPm).toHaveBeenCalledTimes(3)

    mod.resumeScheduler()
  })

  it("_callPm直接呼び出し: pause/stopしない場合はsleepが全時間待つ（正常系）", async () => {
    const { _callPm, resetPmConsecutiveFailures } = await import("../scheduler.js")

    resetPmConsecutiveFailures()
    mockRunPm.mockRejectedValue(new Error("PM internal error"))

    const callPromise = _callPm()

    // 2秒だけ進めても解決しない（30秒sleepの途中）
    const doneEarly = await resolvesWithin(callPromise, 2000)
    expect(doneEarly).toBe(false)

    // 残りの時間を進めて完了させる
    await vi.advanceTimersByTimeAsync(mockConfig.PM_RETRY_INTERVAL_SEC * 1000)
    // idle sleep分も進める
    await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 1000)
  })

  it("_callPm直接呼び出し: fatalなLLMエラーではスケジューラをpauseする", async () => {
    const { _callPm, getSchedulerState, resetPmConsecutiveFailures, resumeScheduler } = await import("../scheduler.js")
    const { broadcast } = await import("../ws.js")

    resetPmConsecutiveFailures()
    mockRunPm.mockRejectedValue(new Error("LLM API error 402: {\"error\":{\"message\":\"Insufficient Balance\"}}"))

    await _callPm()

    expect(getSchedulerState().paused).toBe(true)
    expect(broadcast).toHaveBeenCalledWith("scheduler:state", { paused: true })
    expect(mockSendMessage).toHaveBeenCalledTimes(1)

    resumeScheduler()
  })

  it("Gate1のfatalなLLMエラーではretryを消費せずpendingへ戻してpauseする", async () => {
    const { executeTask, getSchedulerState, resetPmConsecutiveFailures, resumeScheduler } = await import("../scheduler.js")
    const { runGate1 } = await import("../gate1.js")
    const { revertToPending, requeueTask } = await import("../db.js")

    resetPmConsecutiveFailures()
    vi.mocked(runGate1).mockResolvedValue({
      verdict: "recycle",
      reasons: ["LLM check failed: LLM API error 402: {\"error\":{\"message\":\"Insufficient Balance\"}}"],
    })

    await executeTask({
      id: "task-1",
      title: "fatal llm gate1",
      description: "reproduce fatal gate1 handling",
      status: "running",
      priority: 1,
      parent_id: null,
      created_by: "pm",
      assigned_to: "worker-0",
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      finished_at: null,
      result: null,
      cost_usd: 0,
      tokens_used: 0,
      retry_count: 0,
      constraints: null,
    })

    expect(getSchedulerState().paused).toBe(true)
    expect(revertToPending).toHaveBeenCalledWith("task-1")
    expect(requeueTask).not.toHaveBeenCalled()

    resumeScheduler()
  })
})
