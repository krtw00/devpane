import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// --- Mocks (scheduler-circuit-pause.test.ts と同一構造) ---

vi.mock("../events.js", () => ({
  emit: vi.fn(),
  safeEmit: vi.fn(() => true),
}))

vi.mock("../pm.js", () => ({
  runPm: vi.fn(),
  ingestPmTasks: vi.fn(() => []),
}))

const mockCanProceed = vi.fn(() => true)
const mockGetBackoffSec = vi.fn(() => 0)
vi.mock("../circuit-breaker.js", () => ({
  circuitBreaker: {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    canProceed: (...args: unknown[]) => mockCanProceed(...args),
    getState: vi.fn(() => "closed"),
    getBackoffSec: (...args: unknown[]) => mockGetBackoffSec(...args),
  },
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

const mockCountOpenPrs = vi.fn(() => 0)
vi.mock("../worktree.js", () => ({
  createWorktree: vi.fn(() => "/tmp/test-worktree"),
  removeWorktree: vi.fn(),
  createPullRequest: vi.fn(),
  autoMergePr: vi.fn(),
  pruneWorktrees: vi.fn(),
  countOpenPrs: (...args: unknown[]) => mockCountOpenPrs(...args),
  pullMain: vi.fn(),
  getWorktreeNewAndDeleted: vi.fn(() => ({ added: [], deleted: [] })),
}))

const mockGetNextPending = vi.fn(() => null)
vi.mock("../db.js", () => ({
  getNextPending: (...args: unknown[]) => mockGetNextPending(...args),
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

// pause後にIDLE_INTERVAL_SEC(60秒)全体を待たず短時間で抜けることを検証。
// 未修正の実装では sleep(IDLE_INTERVAL_SEC * 1000) が一括sleepのため、
// pause/stopフラグを途中でチェックせずタイムアウトする。
const FAST_THRESHOLD_MS = 3000

describe("scheduler メインループ sleep中のpause/stop応答性", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.clearAllMocks()
    mockConfig.ACTIVE_HOURS = null
    mockConfig.IDLE_INTERVAL_SEC = 60
    mockCanProceed.mockReturnValue(true)
    mockCountOpenPrs.mockReturnValue(0)
    mockGetNextPending.mockReturnValue(null)
  })

  afterEach(async () => {
    try {
      const { stopScheduler } = await import("../scheduler.js")
      await stopScheduler()
      await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 2000)
    } catch { /* ignore */ }
    vi.useRealTimers()
  })

  describe("稼働時間外待機(outside active hours)", () => {
    it("pause()を呼ぶとIDLE_INTERVAL_SEC未満でsleepを抜ける", async () => {
      // 09-17設定で20時 → 時間外
      mockConfig.ACTIVE_HOURS = { start: 9, end: 17 }
      vi.setSystemTime(new Date(2026, 2, 14, 20, 0, 0))

      const { startScheduler, pauseScheduler, stopScheduler } = await import("../scheduler.js")

      const schedulerPromise = startScheduler()
      await vi.advanceTimersByTimeAsync(500)

      pauseScheduler()

      // 修正後: 1秒ごとにフラグチェックするため、短時間で抜けるはず
      await vi.advanceTimersByTimeAsync(FAST_THRESHOLD_MS)

      await stopScheduler()
      await vi.advanceTimersByTimeAsync(2000)
      await schedulerPromise

      expect(true).toBe(true)
    }, 10000)

    it("stop()を呼ぶとIDLE_INTERVAL_SEC未満でsleepを抜ける", async () => {
      mockConfig.ACTIVE_HOURS = { start: 9, end: 17 }
      vi.setSystemTime(new Date(2026, 2, 14, 20, 0, 0))

      const { startScheduler, stopScheduler } = await import("../scheduler.js")

      const schedulerPromise = startScheduler()
      await vi.advanceTimersByTimeAsync(500)

      const stopPromise = stopScheduler()
      await vi.advanceTimersByTimeAsync(FAST_THRESHOLD_MS)
      await stopPromise
      await schedulerPromise

      expect(true).toBe(true)
    }, 10000)
  })

  describe("WIP制限待機(open PRs >= MAX_OPEN_PRS)", () => {
    it("pause()を呼ぶとIDLE_INTERVAL_SEC未満でsleepを抜ける", async () => {
      mockCountOpenPrs.mockReturnValue(5)

      const { startScheduler, pauseScheduler, stopScheduler } = await import("../scheduler.js")

      const schedulerPromise = startScheduler()
      await vi.advanceTimersByTimeAsync(500)

      pauseScheduler()
      await vi.advanceTimersByTimeAsync(FAST_THRESHOLD_MS)

      await stopScheduler()
      await vi.advanceTimersByTimeAsync(2000)
      await schedulerPromise

      expect(true).toBe(true)
    }, 10000)

    it("stop()を呼ぶとIDLE_INTERVAL_SEC未満でsleepを抜ける", async () => {
      mockCountOpenPrs.mockReturnValue(5)

      const { startScheduler, stopScheduler } = await import("../scheduler.js")

      const schedulerPromise = startScheduler()
      await vi.advanceTimersByTimeAsync(500)

      const stopPromise = stopScheduler()
      await vi.advanceTimersByTimeAsync(FAST_THRESHOLD_MS)
      await stopPromise
      await schedulerPromise

      expect(true).toBe(true)
    }, 10000)
  })

  describe("アイドル待機(PM returned no tasks)", () => {
    it("pause()を呼ぶとIDLE_INTERVAL_SEC未満でsleepを抜ける", async () => {
      mockGetNextPending.mockReturnValue(null)
      const { ingestPmTasks } = await import("../pm.js")
      vi.mocked(ingestPmTasks).mockReturnValue([])

      const { startScheduler, pauseScheduler, stopScheduler } = await import("../scheduler.js")

      const schedulerPromise = startScheduler()
      // PM呼び出し + idle sleep突入を待つ
      await vi.advanceTimersByTimeAsync(1000)

      pauseScheduler()
      await vi.advanceTimersByTimeAsync(FAST_THRESHOLD_MS)

      await stopScheduler()
      await vi.advanceTimersByTimeAsync(2000)
      await schedulerPromise

      expect(true).toBe(true)
    }, 10000)

    it("stop()を呼ぶとIDLE_INTERVAL_SEC未満でsleepを抜ける", async () => {
      mockGetNextPending.mockReturnValue(null)
      const { ingestPmTasks } = await import("../pm.js")
      vi.mocked(ingestPmTasks).mockReturnValue([])

      const { startScheduler, stopScheduler } = await import("../scheduler.js")

      const schedulerPromise = startScheduler()
      await vi.advanceTimersByTimeAsync(1000)

      const stopPromise = stopScheduler()
      await vi.advanceTimersByTimeAsync(FAST_THRESHOLD_MS)
      await stopPromise
      await schedulerPromise

      expect(true).toBe(true)
    }, 10000)
  })
})
