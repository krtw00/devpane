import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// --- Mocks (scheduler-sleep-pause.test.ts と同一構造) ---

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
    canProceed: () => mockCanProceed(),
    getState: vi.fn(() => "closed"),
    getBackoffSec: () => mockGetBackoffSec(),
  },
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

const mockCountOpenPrs = vi.fn<() => number | null>(() => null)
vi.mock("../worktree.js", () => ({
  createWorktree: vi.fn(() => "/tmp/test-worktree"),
  removeWorktree: vi.fn(),
  createPullRequest: vi.fn(),
  autoMergePr: vi.fn(),
  pruneWorktrees: vi.fn(),
  countOpenPrs: () => mockCountOpenPrs(),
  pullMain: vi.fn(),
  getWorktreeNewAndDeleted: vi.fn(() => ({ added: [], deleted: [] })),
}))

const mockGetNextPending = vi.fn(() => null)
const mockClaimNextPending = vi.fn(() => undefined)
vi.mock("../db.js", () => ({
  getNextPending: () => mockGetNextPending(),
  claimNextPending: () => mockClaimNextPending(),
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

// countOpenPrs失敗(null)時のsleep中にpause/stopが即座に効くことを検証。
// 未修正: sleep(IDLE_INTERVAL_SEC * 1000) の一括sleepのためpause/stop信号を無視する。
// 修正後: 1秒刻みsleep + フラグチェックパターンに統一。
const FAST_THRESHOLD_MS = 3000

describe("countOpenPrs失敗時のsleep中にpause/stopが応答する", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockConfig.ACTIVE_HOURS = null
    mockConfig.IDLE_INTERVAL_SEC = 60
    mockCanProceed.mockReturnValue(true)
    mockCountOpenPrs.mockReturnValue(null)
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

  it("countOpenPrsがnullを返した後のsleep中にstop()を呼ぶとIDLE_INTERVAL_SEC未満でループを抜ける", async () => {
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    const schedulerPromise = startScheduler()
    // countOpenPrs(null)後のsleep突入を待つ
    await vi.advanceTimersByTimeAsync(500)

    const stopPromise = stopScheduler()
    // 修正後: 1秒刻みsleepなのでFAST_THRESHOLD_MS以内に抜ける
    await vi.advanceTimersByTimeAsync(FAST_THRESHOLD_MS)
    await stopPromise
    await schedulerPromise

    expect(true).toBe(true)
  }, 10000)

  it("countOpenPrsがnullを返した後のsleep中にpause()を呼ぶとIDLE_INTERVAL_SEC未満でsleepを抜ける", async () => {
    const { startScheduler, pauseScheduler, stopScheduler } = await import("../scheduler.js")

    const schedulerPromise = startScheduler()
    await vi.advanceTimersByTimeAsync(500)

    pauseScheduler()
    // 修正後: 1秒刻みsleepなのでFAST_THRESHOLD_MS以内にpauseフラグを検知して抜ける
    await vi.advanceTimersByTimeAsync(FAST_THRESHOLD_MS)

    await stopScheduler()
    await vi.advanceTimersByTimeAsync(2000)
    await schedulerPromise

    expect(true).toBe(true)
  }, 10000)
})
