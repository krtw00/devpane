import { describe, it, expect, vi, beforeEach } from "vitest"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = Record<string, any>

async function loadConfig(): Promise<AnyConfig> {
  const mod = await vi.importActual<{ config: AnyConfig }>("../config.js")
  return mod.config
}

describe("config env overrides", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("uses default MAX_RETRIES=2 when env not set", async () => {
    delete process.env.DEVPANE_MAX_RETRIES
    const config = await loadConfig()
    expect(config.MAX_RETRIES).toBe(2)
  })

  it("uses default MAX_DIFF_SIZE=500 when env not set", async () => {
    delete process.env.DEVPANE_MAX_DIFF_SIZE
    const config = await loadConfig()
    expect(config.MAX_DIFF_SIZE).toBe(500)
  })

  it("overrides MAX_RETRIES from DEVPANE_MAX_RETRIES", async () => {
    vi.stubEnv("DEVPANE_MAX_RETRIES", "5")
    const config = await loadConfig()
    expect(config.MAX_RETRIES).toBe(5)
    vi.unstubAllEnvs()
  })

  it("overrides MAX_DIFF_SIZE from DEVPANE_MAX_DIFF_SIZE", async () => {
    vi.stubEnv("DEVPANE_MAX_DIFF_SIZE", "1000")
    const config = await loadConfig()
    expect(config.MAX_DIFF_SIZE).toBe(1000)
    vi.unstubAllEnvs()
  })

  // --- MAX_OPEN_PRS ---

  it("uses default MAX_OPEN_PRS=1 when env not set", async () => {
    delete process.env.DEVPANE_MAX_OPEN_PRS
    const config = await loadConfig()
    expect(config.MAX_OPEN_PRS).toBe(1)
  })

  it("overrides MAX_OPEN_PRS from DEVPANE_MAX_OPEN_PRS", async () => {
    vi.stubEnv("DEVPANE_MAX_OPEN_PRS", "3")
    const config = await loadConfig()
    expect(config.MAX_OPEN_PRS).toBe(3)
    vi.unstubAllEnvs()
  })

  // --- MIN_DESCRIPTION_LENGTH ---

  it("uses default MIN_DESCRIPTION_LENGTH=20 when env not set", async () => {
    delete process.env.DEVPANE_MIN_DESCRIPTION_LENGTH
    const config = await loadConfig()
    expect(config.MIN_DESCRIPTION_LENGTH).toBe(20)
  })

  it("overrides MIN_DESCRIPTION_LENGTH from DEVPANE_MIN_DESCRIPTION_LENGTH", async () => {
    vi.stubEnv("DEVPANE_MIN_DESCRIPTION_LENGTH", "50")
    const config = await loadConfig()
    expect(config.MIN_DESCRIPTION_LENGTH).toBe(50)
    vi.unstubAllEnvs()
  })

  // --- EFFECT_MEASURE_THRESHOLD ---

  it("uses default EFFECT_MEASURE_THRESHOLD=10 when env not set", async () => {
    delete process.env.DEVPANE_EFFECT_MEASURE_THRESHOLD
    const config = await loadConfig()
    expect(config.EFFECT_MEASURE_THRESHOLD).toBe(10)
  })

  it("overrides EFFECT_MEASURE_THRESHOLD from DEVPANE_EFFECT_MEASURE_THRESHOLD", async () => {
    vi.stubEnv("DEVPANE_EFFECT_MEASURE_THRESHOLD", "5")
    const config = await loadConfig()
    expect(config.EFFECT_MEASURE_THRESHOLD).toBe(5)
    vi.unstubAllEnvs()
  })

  // --- KAIZEN_THRESHOLD ---

  it("uses default KAIZEN_THRESHOLD=10 when env not set", async () => {
    delete process.env.DEVPANE_KAIZEN_THRESHOLD
    const config = await loadConfig()
    expect(config.KAIZEN_THRESHOLD).toBe(10)
  })

  it("overrides KAIZEN_THRESHOLD from DEVPANE_KAIZEN_THRESHOLD", async () => {
    vi.stubEnv("DEVPANE_KAIZEN_THRESHOLD", "20")
    const config = await loadConfig()
    expect(config.KAIZEN_THRESHOLD).toBe(20)
    vi.unstubAllEnvs()
  })

  // --- MEMORY_CLEANUP_THRESHOLD ---

  it("uses default MEMORY_CLEANUP_THRESHOLD=10 when env not set", async () => {
    delete process.env.DEVPANE_MEMORY_CLEANUP_THRESHOLD
    const config = await loadConfig()
    expect(config.MEMORY_CLEANUP_THRESHOLD).toBe(10)
  })

  it("overrides MEMORY_CLEANUP_THRESHOLD from DEVPANE_MEMORY_CLEANUP_THRESHOLD", async () => {
    vi.stubEnv("DEVPANE_MEMORY_CLEANUP_THRESHOLD", "25")
    const config = await loadConfig()
    expect(config.MEMORY_CLEANUP_THRESHOLD).toBe(25)
    vi.unstubAllEnvs()
  })
})
