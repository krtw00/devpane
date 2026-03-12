import { describe, it, expect, vi, beforeEach } from "vitest"

describe("config env overrides", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("uses default MAX_RETRIES=2 when env not set", async () => {
    delete process.env.DEVPANE_MAX_RETRIES
    const { config } = await vi.importActual<typeof import("../config.js")>("../config.js")
    expect(config.MAX_RETRIES).toBe(2)
  })

  it("uses default MAX_DIFF_SIZE=500 when env not set", async () => {
    delete process.env.DEVPANE_MAX_DIFF_SIZE
    const { config } = await vi.importActual<typeof import("../config.js")>("../config.js")
    expect(config.MAX_DIFF_SIZE).toBe(500)
  })

  it("overrides MAX_RETRIES from DEVPANE_MAX_RETRIES", async () => {
    vi.stubEnv("DEVPANE_MAX_RETRIES", "5")
    const { config } = await vi.importActual<typeof import("../config.js")>("../config.js")
    expect(config.MAX_RETRIES).toBe(5)
    vi.unstubAllEnvs()
  })

  it("overrides MAX_DIFF_SIZE from DEVPANE_MAX_DIFF_SIZE", async () => {
    vi.stubEnv("DEVPANE_MAX_DIFF_SIZE", "1000")
    const { config } = await vi.importActual<typeof import("../config.js")>("../config.js")
    expect(config.MAX_DIFF_SIZE).toBe(1000)
    vi.unstubAllEnvs()
  })

  it("uses default MAX_OPEN_PRS=1 when env not set", async () => {
    delete process.env.MAX_OPEN_PRS
    const { config } = await vi.importActual<typeof import("../config.js")>("../config.js")
    expect(config.MAX_OPEN_PRS).toBe(1)
  })

  it("overrides MAX_OPEN_PRS from MAX_OPEN_PRS env", async () => {
    vi.stubEnv("MAX_OPEN_PRS", "3")
    const { config } = await vi.importActual<typeof import("../config.js")>("../config.js")
    expect(config.MAX_OPEN_PRS).toBe(3)
    vi.unstubAllEnvs()
  })
})
