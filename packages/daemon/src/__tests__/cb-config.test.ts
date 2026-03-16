import { describe, it, expect, vi, beforeEach } from "vitest"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = Record<string, any>

async function loadConfig(): Promise<AnyConfig> {
  const mod = await vi.importActual<{ config: AnyConfig }>("../config.js")
  return mod.config
}

describe("circuit-breaker config defaults", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  // --- CB_THRESHOLD ---

  it("uses default CB_THRESHOLD=3 when env not set", async () => {
    delete process.env.DEVPANE_CB_THRESHOLD
    const config = await loadConfig()
    expect(config.CB_THRESHOLD).toBe(3)
  })

  it("overrides CB_THRESHOLD from DEVPANE_CB_THRESHOLD", async () => {
    vi.stubEnv("DEVPANE_CB_THRESHOLD", "5")
    const config = await loadConfig()
    expect(config.CB_THRESHOLD).toBe(5)
    vi.unstubAllEnvs()
  })

  // --- CB_BACKOFF_SEC ---

  it("uses default CB_BACKOFF_SEC=300 when env not set", async () => {
    delete process.env.DEVPANE_CB_BACKOFF_SEC
    const config = await loadConfig()
    expect(config.CB_BACKOFF_SEC).toBe(300)
  })

  it("overrides CB_BACKOFF_SEC from DEVPANE_CB_BACKOFF_SEC", async () => {
    vi.stubEnv("DEVPANE_CB_BACKOFF_SEC", "60")
    const config = await loadConfig()
    expect(config.CB_BACKOFF_SEC).toBe(60)
    vi.unstubAllEnvs()
  })

  // --- CB_MAX_BACKOFF_SEC ---

  it("uses default CB_MAX_BACKOFF_SEC=3600 when env not set", async () => {
    delete process.env.DEVPANE_CB_MAX_BACKOFF_SEC
    const config = await loadConfig()
    expect(config.CB_MAX_BACKOFF_SEC).toBe(3600)
  })

  it("overrides CB_MAX_BACKOFF_SEC from DEVPANE_CB_MAX_BACKOFF_SEC", async () => {
    vi.stubEnv("DEVPANE_CB_MAX_BACKOFF_SEC", "7200")
    const config = await loadConfig()
    expect(config.CB_MAX_BACKOFF_SEC).toBe(7200)
    vi.unstubAllEnvs()
  })
})

describe("CircuitBreaker uses config values", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("uses config CB_THRESHOLD as default threshold", async () => {
    vi.stubEnv("DEVPANE_CB_THRESHOLD", "2")

    vi.mock("../events.js", () => ({ emit: vi.fn() }))
    const { CircuitBreaker } = await import("../circuit-breaker.js")

    let now = 0
    const cb = new CircuitBreaker(undefined, undefined, undefined, () => now)

    cb.recordFailure()
    expect(cb.getState()).toBe("closed")
    cb.recordFailure()
    expect(cb.getState()).toBe("open")

    vi.unstubAllEnvs()
  })

  it("uses config CB_BACKOFF_SEC as default backoff", async () => {
    vi.stubEnv("DEVPANE_CB_BACKOFF_SEC", "10")

    vi.mock("../events.js", () => ({ emit: vi.fn() }))
    const { CircuitBreaker } = await import("../circuit-breaker.js")

    let now = 0
    const cb = new CircuitBreaker(undefined, undefined, undefined, () => now)

    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.getState()).toBe("open")

    now = 10 * 1000
    expect(cb.getState()).toBe("half-open")

    vi.unstubAllEnvs()
  })

  it("uses config CB_MAX_BACKOFF_SEC as default max backoff", async () => {
    vi.stubEnv("DEVPANE_CB_BACKOFF_SEC", "100")
    vi.stubEnv("DEVPANE_CB_MAX_BACKOFF_SEC", "200")

    vi.mock("../events.js", () => ({ emit: vi.fn() }))
    const { CircuitBreaker } = await import("../circuit-breaker.js")

    let now = 0
    const cb = new CircuitBreaker(undefined, undefined, undefined, () => now)

    // open with backoff=100
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()

    // half-open → fail → backoff=200 (100*2, within max)
    now = 100 * 1000
    cb.canProceed()
    cb.recordFailure()

    // half-open → fail → backoff capped at 200 (200*2=400 → capped to 200)
    now += 200 * 1000
    cb.canProceed()
    cb.recordFailure()

    expect(cb.getBackoffSec()).toBe(200)

    vi.unstubAllEnvs()
  })
})
