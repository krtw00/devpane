import { describe, it, expect, vi, beforeEach } from "vitest"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = Record<string, any>

async function loadConfig(): Promise<AnyConfig> {
  const mod = await vi.importActual<{ config: AnyConfig }>("../config.js")
  return mod.config
}

describe("facts timeout config", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  // --- BUILD_TIMEOUT_MS ---

  it("uses default BUILD_TIMEOUT_MS=120000 when env not set", async () => {
    delete process.env.BUILD_TIMEOUT_MS
    const config = await loadConfig()
    expect(config.BUILD_TIMEOUT_MS).toBe(120000)
  })

  it("overrides BUILD_TIMEOUT_MS from env", async () => {
    vi.stubEnv("BUILD_TIMEOUT_MS", "300000")
    const config = await loadConfig()
    expect(config.BUILD_TIMEOUT_MS).toBe(300000)
    vi.unstubAllEnvs()
  })

  // --- TEST_TIMEOUT_MS ---

  it("uses default TEST_TIMEOUT_MS=120000 when env not set", async () => {
    delete process.env.TEST_TIMEOUT_MS
    const config = await loadConfig()
    expect(config.TEST_TIMEOUT_MS).toBe(120000)
  })

  it("overrides TEST_TIMEOUT_MS from env", async () => {
    vi.stubEnv("TEST_TIMEOUT_MS", "240000")
    const config = await loadConfig()
    expect(config.TEST_TIMEOUT_MS).toBe(240000)
    vi.unstubAllEnvs()
  })

  // --- LINT_TIMEOUT_MS ---

  it("uses default LINT_TIMEOUT_MS=60000 when env not set", async () => {
    delete process.env.LINT_TIMEOUT_MS
    const config = await loadConfig()
    expect(config.LINT_TIMEOUT_MS).toBe(60000)
  })

  it("overrides LINT_TIMEOUT_MS from env", async () => {
    vi.stubEnv("LINT_TIMEOUT_MS", "180000")
    const config = await loadConfig()
    expect(config.LINT_TIMEOUT_MS).toBe(180000)
    vi.unstubAllEnvs()
  })
})
