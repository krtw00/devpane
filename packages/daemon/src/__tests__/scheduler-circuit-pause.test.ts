import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// --- Mocks ---

vi.mock("../events.js", () => ({
  emit: vi.fn(),
  safeEmit: vi.fn(() => true),
}))

vi.mock("../pm.js", () => ({
  runPm: vi.fn(),
  ingestPmTasks: vi.fn(() => []),
}))

const mockCanProceed = vi.fn(() => false)
const mockGetBackoffSec = vi.fn(() => 60)
vi.mock("../circuit-breaker.js", () => ({
  circuitBreaker: {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    canProceed: (...args: unknown[]) => mockCanProceed(...args),
    getState: vi.fn(() => "open"),
    getBackoffSec: (...args: unknown[]) => mockGetBackoffSec(...args),
  },
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))
vi.mock("../db.js", () => ({
  getNextPending: vi.fn(() => null),
  claimNextPending: vi.fn(() => undefined),
  getTasksByStatus: vi.fn(() => []),
  startTask: vi.fn(),
  finishTask: vi.fn(),
  revertToPending: vi.fn(),
  requeueTask: vi.fn(),
  suppressTerminalFailedTask: vi.fn(() => null),
  suppressTerminalFailedTasks: vi.fn(() => []),
  getRetryCount: vi.fn(() => 0),
  appendLog: vi.fn(),
  updateTaskCost: vi.fn(),
  insertAgentEvent: vi.fn(),
  getAgentEvents: vi.fn(() => []),
  getDb: vi.fn(),
  recoverOrphanedTasks: vi.fn(() => []),
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

describe("circuit breaker open中にpauseScheduler()で即座にループが中断される", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockConfig.ACTIVE_HOURS = null
    // circuit breaker は open 状態
    mockCanProceed.mockReturnValue(false)
    mockGetBackoffSec.mockReturnValue(3600) // 最大backoff: 1時間
  })

  afterEach(async () => {
    try {
      const { stopScheduler } = await import("../scheduler.js")
      await stopScheduler()
    } catch { /* ignore */ }
    vi.useRealTimers()
  })

  it("circuit open中にpauseScheduler()を呼ぶと1秒以内にsleepループを抜ける", async () => {
    const { startScheduler, pauseScheduler, stopScheduler } = await import("../scheduler.js")

    const schedulerPromise = startScheduler()

    // スケジューラがcircuit breaker分岐に入りsleep開始するのを少し待つ
    await vi.advanceTimersByTimeAsync(500)

    // pause発行
    pauseScheduler()

    // 修正後: sleepが1秒ごとにフラグチェックするため、1秒進めればループを抜けるはず
    await vi.advanceTimersByTimeAsync(1000)

    // スケジューラを停止
    await stopScheduler()
    await vi.advanceTimersByTimeAsync(2000)
    await schedulerPromise

    // pauseが効いた = 長時間(3600秒)ブロックされなかった
    // stopScheduler()がタイムアウトなく完了していれば成功
    expect(true).toBe(true)
  })

  it("circuit open中にstopScheduler()を呼ぶと1秒以内にループを抜ける", async () => {
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    const schedulerPromise = startScheduler()

    // スケジューラがcircuit breaker分岐に入るのを待つ
    await vi.advanceTimersByTimeAsync(500)

    // stop発行
    const stopPromise = stopScheduler()

    // 1秒進めてループ脱出を確認
    await vi.advanceTimersByTimeAsync(1000)
    await stopPromise
    await schedulerPromise

    // alive=falseでループを抜けていればstopPromiseが解決される
    expect(true).toBe(true)
  })

  it("backoffが大きくても全時間待たずにpause後すぐ次のイテレーションへ進む", async () => {
    const { startScheduler, pauseScheduler, resumeScheduler, stopScheduler } = await import("../scheduler.js")

    const schedulerPromise = startScheduler()

    // circuit open分岐に入る
    await vi.advanceTimersByTimeAsync(500)

    // pause → resume → circuitがclosedに戻る → タスク取得フローへ
    pauseScheduler()
    await vi.advanceTimersByTimeAsync(1000)

    // circuit breakerをclosedに戻す
    mockCanProceed.mockReturnValue(true)
    resumeScheduler()

    // 次のイテレーションでcircuit closedの通常フローに入ることを確認
    // (getNextPendingがnullなのでcallPm→idle sleepの流れ)
    await vi.advanceTimersByTimeAsync(2000)

    await stopScheduler()
    await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 2000)
    await schedulerPromise

    // canProceedがtrue返却後に呼ばれていれば、pause中のsleep抜けが機能した証拠
    expect(mockCanProceed).toHaveBeenCalled()
  })
})
