import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// --- Mocks (既存テストと同一構造) ---

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
const mockPullMain = vi.fn()
vi.mock("../worktree.js", () => ({
  createWorktree: vi.fn(() => "/tmp/test-worktree"),
  removeWorktree: vi.fn(),
  createPullRequest: vi.fn(),
  autoMergePr: vi.fn(),
  pruneWorktrees: vi.fn(),
  countOpenPrs: (...args: unknown[]) => mockCountOpenPrs(...args),
  pullMain: (...args: unknown[]) => mockPullMain(...args),
  getWorktreeNewAndDeleted: vi.fn(() => ({ added: [], deleted: [] })),
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
  parseConstraints: (raw: string | null) => { if (!raw) return []; try { const p = JSON.parse(raw); if (Array.isArray(p)) return p.filter((s: unknown): s is string => typeof s === "string"); } catch { /* ignore */ } return [] },
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
  PRUNE_INTERVAL_HOURS: 24,
  BASE_BRANCH: "main",
}

vi.mock("../config.js", () => ({
  config: mockConfig,
}))

describe("scheduler pullMain スロットリング", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 17, 12, 0, 0))
    vi.clearAllMocks()
    mockConfig.ACTIVE_HOURS = null
    mockConfig.IDLE_INTERVAL_SEC = 60
    mockCanProceed.mockReturnValue(true)
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

  it("openPrs数が変化しない場合、pullMainは2回目以降のループで呼ばれない", async () => {
    // openPrs = 0 が連続 → mainは最新のまま、pullは初回のみ or 不要
    mockCountOpenPrs.mockReturnValue(0)

    const { startScheduler, stopScheduler } = await import("../scheduler.js")
    const schedulerPromise = startScheduler()

    // 1ループ目: PMタスクなし→idle待機に入る
    await vi.advanceTimersByTimeAsync(500)
    // idle待機を抜けさせて2ループ目へ
    await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000)
    // 2ループ目を進める
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000)
    // 3ループ目を進める
    await vi.advanceTimersByTimeAsync(500)

    await stopScheduler()
    await vi.advanceTimersByTimeAsync(2000)
    await schedulerPromise

    // openPrsが変化していないので、毎ループpullMainが呼ばれるべきではない
    // 修正前: 3回呼ばれる（毎ループ無条件）
    // 修正後: 最大1回（初回のみ）or 0回
    expect(mockPullMain.mock.calls.length).toBeLessThanOrEqual(1)
  }, 15000)

  it("openPrs数が減少した場合、pullMainが呼ばれる", async () => {
    // 1ループ目: openPrs=1 → WIP制限でスキップ
    // 2ループ目: openPrs=0 → PRがマージされた → pullMainすべき
    mockCountOpenPrs
      .mockReturnValueOnce(1)  // 1ループ目
      .mockReturnValueOnce(0)  // 2ループ目

    const { startScheduler, stopScheduler } = await import("../scheduler.js")
    const schedulerPromise = startScheduler()

    // 1ループ目: WIP制限でidle
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000)
    // 2ループ目: openPrs減少 → pullMain呼ばれるべき
    await vi.advanceTimersByTimeAsync(500)

    await stopScheduler()
    await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 2000)
    await schedulerPromise

    // openPrsが1→0に減少したタイミングでpullMainが呼ばれるべき
    expect(mockPullMain).toHaveBeenCalled()
  }, 15000)

  it("一定時間経過後にpullMainが呼ばれる（タイムベースのスロットリング）", async () => {
    // openPrsは常に0（変化なし）だが、5分以上経過すればpullMainすべき
    mockCountOpenPrs.mockReturnValue(0)

    const { startScheduler, stopScheduler } = await import("../scheduler.js")
    const schedulerPromise = startScheduler()

    // 初回ループ
    await vi.advanceTimersByTimeAsync(500)
    mockPullMain.mockClear() // 初回呼び出しをリセット

    // 5分以上経過させる
    const fiveMinMs = 5 * 60 * 1000
    // idle待機を何度もスキップして時間を進める
    for (let elapsed = 0; elapsed < fiveMinMs + 10000; elapsed += mockConfig.IDLE_INTERVAL_SEC * 1000 + 500) {
      await vi.advanceTimersByTimeAsync(mockConfig.IDLE_INTERVAL_SEC * 1000 + 500)
    }

    await stopScheduler()
    await vi.advanceTimersByTimeAsync(2000)
    await schedulerPromise

    // 5分以上経過したので、スロットリング間隔によりpullMainが呼ばれるべき
    expect(mockPullMain).toHaveBeenCalled()
  }, 30000)

  // TODO: 実装完了後に it.todo → it に変更すること
  // 修正前: pullMainの例外がstartScheduler内で未キャッチ → unhandled rejection → vitest error
  // 修正後: scheduler側でpullMain()をtry-catchで囲むため、例外でもループ継続
  //
  // テスト内容:
  //   mockCountOpenPrs: 1→0→0 (openPrs減少でpullMain呼出)
  //   mockPullMain: throw Error("network error")
  //   期待: countOpenPrsが3回呼ばれる（=3ループ目に到達=ループ継続）
  it.todo("pullMain失敗時もループは継続する（scheduler側try-catch必須）")
})
