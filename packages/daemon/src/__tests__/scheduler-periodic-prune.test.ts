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

const mockCanProceed = vi.fn(() => true)
vi.mock("../circuit-breaker.js", () => ({
  circuitBreaker: {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    canProceed: (...args: unknown[]) => mockCanProceed(...args),
    getState: vi.fn(() => "closed"),
    getBackoffSec: vi.fn(() => 0),
  },
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

const mockGetNextPending = vi.fn(() => null)
const mockClaimNextPending = vi.fn(() => undefined)
vi.mock("../db.js", () => ({
  getNextPending: (...args: unknown[]) => mockGetNextPending(...args),
  claimNextPending: (...args: unknown[]) => mockClaimNextPending(...args),
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

const mockPruneWorktrees = vi.fn()
vi.mock("../worktree.js", () => ({
  createWorktree: vi.fn(() => "/tmp/test-worktree"),
  removeWorktree: vi.fn(),
  createPullRequest: vi.fn(),
  autoMergePr: vi.fn(),
  pruneWorktrees: (...args: unknown[]) => mockPruneWorktrees(...args),
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
  PRUNE_INTERVAL_HOURS: 6,
}

vi.mock("../config.js", () => ({
  config: mockConfig,
}))

describe("pruneWorktreesの定期実行", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockConfig.ACTIVE_HOURS = null
    mockConfig.PRUNE_INTERVAL_HOURS = 6
    mockCanProceed.mockReturnValue(true)
    mockGetNextPending.mockReturnValue(null)
  })

  afterEach(async () => {
    try {
      const { stopScheduler } = await import("../scheduler.js")
      await stopScheduler()
    } catch { /* ignore */ }
    vi.useRealTimers()
  })

  it("startScheduler起動時にpruneWorktreesが呼ばれる", async () => {
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    const schedulerPromise = startScheduler()
    await vi.advanceTimersByTimeAsync(500)

    expect(mockPruneWorktrees).toHaveBeenCalledTimes(1)

    await stopScheduler()
    await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 2000)
    await schedulerPromise
  })

  it("PRUNE_INTERVAL_HOURS経過後にpruneWorktreesが再度呼ばれる", async () => {
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    const schedulerPromise = startScheduler()
    // 起動直後の1回
    await vi.advanceTimersByTimeAsync(500)
    expect(mockPruneWorktrees).toHaveBeenCalledTimes(1)

    // 6時間分進める（IDLE_INTERVAL_SECごとにループが回るため十分な時間）
    const sixHoursMs = 6 * 60 * 60 * 1000
    await vi.advanceTimersByTimeAsync(sixHoursMs)

    // 2回目のpruneが呼ばれているはず
    expect(mockPruneWorktrees.mock.calls.length).toBeGreaterThanOrEqual(2)

    await stopScheduler()
    await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 2000)
    await schedulerPromise
  })

  it("PRUNE_INTERVAL_HOURS未満ではpruneWorktreesが再呼び出しされない", async () => {
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    const schedulerPromise = startScheduler()
    await vi.advanceTimersByTimeAsync(500)
    expect(mockPruneWorktrees).toHaveBeenCalledTimes(1)

    // 5時間分進める（6時間未満）
    const fiveHoursMs = 5 * 60 * 60 * 1000
    await vi.advanceTimersByTimeAsync(fiveHoursMs)

    // 起動時の1回のみ
    expect(mockPruneWorktrees).toHaveBeenCalledTimes(1)

    await stopScheduler()
    await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 2000)
    await schedulerPromise
  })

  it("pruneWorktreesが例外を投げてもメインループが継続する", async () => {
    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    // 最初の呼び出しは成功、2回目以降は例外
    mockPruneWorktrees
      .mockImplementationOnce(() => {})
      .mockImplementation(() => { throw new Error("prune failed") })

    const schedulerPromise = startScheduler()
    await vi.advanceTimersByTimeAsync(500)

    // 6時間進めてprune再実行（例外が発生するはず）
    const sixHoursMs = 6 * 60 * 60 * 1000
    await vi.advanceTimersByTimeAsync(sixHoursMs)

    // pruneが呼ばれた（例外でもメインループは死んでいない）
    expect(mockPruneWorktrees.mock.calls.length).toBeGreaterThanOrEqual(2)

    // さらにループが回り続けることを確認（stopが正常に効く = ループ生存）
    await stopScheduler()
    await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 2000)
    await schedulerPromise
  })

  it("PRUNE_INTERVAL_HOURSを変更すると間隔が変わる", async () => {
    mockConfig.PRUNE_INTERVAL_HOURS = 1 // 1時間に短縮

    const { startScheduler, stopScheduler } = await import("../scheduler.js")

    const schedulerPromise = startScheduler()
    await vi.advanceTimersByTimeAsync(500)
    expect(mockPruneWorktrees).toHaveBeenCalledTimes(1)

    // 1時間進める
    const oneHourMs = 1 * 60 * 60 * 1000
    await vi.advanceTimersByTimeAsync(oneHourMs)

    // 1時間間隔なので2回目が呼ばれる
    expect(mockPruneWorktrees.mock.calls.length).toBeGreaterThanOrEqual(2)

    await stopScheduler()
    await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 2000)
    await schedulerPromise
  })
})
