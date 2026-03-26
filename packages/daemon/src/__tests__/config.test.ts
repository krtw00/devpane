import { describe, it, expect, vi, beforeEach } from "vitest"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = Record<string, any>

async function loadConfig(): Promise<AnyConfig> {
  const mod = await vi.importActual<{ config: AnyConfig }>("../config.js")
  return mod.config
}

async function loadConfigModule(): Promise<{ config: AnyConfig; validateEnv: () => void }> {
  return await vi.importActual<{ config: AnyConfig; validateEnv: () => void }>("../config.js")
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

  // --- TESTER_TIMEOUT_MS ---

  it("uses default TESTER_TIMEOUT_MS=600000 when env not set", async () => {
    delete process.env.TESTER_TIMEOUT_MS
    const config = await loadConfig()
    expect(config.TESTER_TIMEOUT_MS).toBe(600000)
  })

  it("overrides TESTER_TIMEOUT_MS from TESTER_TIMEOUT_MS env", async () => {
    vi.stubEnv("TESTER_TIMEOUT_MS", "120000")
    const config = await loadConfig()
    expect(config.TESTER_TIMEOUT_MS).toBe(120000)
    vi.unstubAllEnvs()
  })

  it("uses default LLM request timeout and allows role-specific overrides", async () => {
    delete process.env.LLM_REQUEST_TIMEOUT_MS
    delete process.env.TESTER_LLM_REQUEST_TIMEOUT_MS
    delete process.env.WORKER_LLM_REQUEST_TIMEOUT_MS
    let config = await loadConfig()
    expect(config.LLM_REQUEST_TIMEOUT_MS).toBe(120000)
    expect(config.TESTER_LLM_REQUEST_TIMEOUT_MS).toBe(120000)
    expect(config.WORKER_LLM_REQUEST_TIMEOUT_MS).toBe(120000)

    vi.resetModules()
    vi.stubEnv("LLM_REQUEST_TIMEOUT_MS", "180000")
    vi.stubEnv("TESTER_LLM_REQUEST_TIMEOUT_MS", "300000")
    config = await loadConfig()
    expect(config.LLM_REQUEST_TIMEOUT_MS).toBe(180000)
    expect(config.TESTER_LLM_REQUEST_TIMEOUT_MS).toBe(300000)
    expect(config.WORKER_LLM_REQUEST_TIMEOUT_MS).toBe(180000)
    vi.unstubAllEnvs()
  })

  it("uses shared LLM config as fallback for tester/worker role config", async () => {
    vi.stubEnv("LLM_API_KEY", "shared-key")
    vi.stubEnv("LLM_BASE_URL", "https://example.com/v1")
    vi.stubEnv("LLM_MODEL", "shared-model")
    vi.stubEnv("LLM_INPUT_PRICE", "0.1")
    vi.stubEnv("LLM_OUTPUT_PRICE", "0.2")
    const config = await loadConfig()
    expect(config.TESTER_LLM_API_KEY).toBe("shared-key")
    expect(config.TESTER_LLM_BASE_URL).toBe("https://example.com/v1")
    expect(config.TESTER_LLM_MODEL).toBe("shared-model")
    expect(config.TESTER_LLM_INPUT_PRICE).toBe(0.1)
    expect(config.TESTER_LLM_OUTPUT_PRICE).toBe(0.2)
    expect(config.WORKER_LLM_API_KEY).toBe("shared-key")
    expect(config.WORKER_LLM_BASE_URL).toBe("https://example.com/v1")
    expect(config.WORKER_LLM_MODEL).toBe("shared-model")
    expect(config.WORKER_LLM_INPUT_PRICE).toBe(0.1)
    expect(config.WORKER_LLM_OUTPUT_PRICE).toBe(0.2)
    vi.unstubAllEnvs()
  })

  it("overrides role-specific LLM config when tester/worker env is set", async () => {
    vi.stubEnv("LLM_API_KEY", "shared-key")
    vi.stubEnv("TESTER_LLM_API_KEY", "tester-key")
    vi.stubEnv("WORKER_LLM_MODEL", "worker-model")
    const config = await loadConfig()
    expect(config.TESTER_LLM_API_KEY).toBe("tester-key")
    expect(config.WORKER_LLM_MODEL).toBe("worker-model")
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

  // --- API_TOKEN ---

  it("uses null API_TOKEN when env not set", async () => {
    delete process.env.API_TOKEN
    const config = await loadConfig()
    expect(config.API_TOKEN).toBeNull()
  })

  it("overrides API_TOKEN from env", async () => {
    vi.stubEnv("API_TOKEN", "secret-token")
    const config = await loadConfig()
    expect(config.API_TOKEN).toBe("secret-token")
    vi.unstubAllEnvs()
  })

  // --- CORS_ORIGIN ---

  it("uses null CORS_ORIGIN when env not set", async () => {
    delete process.env.CORS_ORIGIN
    const config = await loadConfig()
    expect(config.CORS_ORIGIN).toBeNull()
  })

  it("parses CORS_ORIGIN from comma-separated env", async () => {
    vi.stubEnv("CORS_ORIGIN", "https://a.example, https://b.example")
    const config = await loadConfig()
    expect(config.CORS_ORIGIN).toEqual(["https://a.example", "https://b.example"])
    vi.unstubAllEnvs()
  })

  // --- BACKUP_DIR / BACKUP_KEEP_COUNT ---

  it("uses default BACKUP_KEEP_COUNT=7 when env not set", async () => {
    delete process.env.BACKUP_KEEP_COUNT
    const config = await loadConfig()
    expect(config.BACKUP_KEEP_COUNT).toBe(7)
  })

  it("overrides BACKUP_KEEP_COUNT from env", async () => {
    vi.stubEnv("BACKUP_KEEP_COUNT", "14")
    const config = await loadConfig()
    expect(config.BACKUP_KEEP_COUNT).toBe(14)
    vi.unstubAllEnvs()
  })

  it("uses default BACKUP_DIR under PROJECT_ROOT when env not set", async () => {
    delete process.env.BACKUP_DIR
    vi.stubEnv("PROJECT_ROOT", "/tmp/devpane-root")
    const config = await loadConfig()
    expect(config.BACKUP_DIR).toBe("/tmp/devpane-root/.devpane-backups")
    vi.unstubAllEnvs()
  })

  it("overrides BACKUP_DIR from env", async () => {
    vi.stubEnv("BACKUP_DIR", "/tmp/custom-backups")
    const config = await loadConfig()
    expect(config.BACKUP_DIR).toBe("/tmp/custom-backups")
    vi.unstubAllEnvs()
  })
})

describe("validateEnv", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("throws error with specific variable name when PROJECT_ROOT is empty", async () => {
    vi.stubEnv("PROJECT_ROOT", "")
    const { validateEnv } = await loadConfigModule()
    expect(() => validateEnv()).toThrow("Invalid environment variable: PROJECT_ROOT must be a non-empty string")
    vi.unstubAllEnvs()
  })

  it("throws error with specific variable name when APP_NAME is empty", async () => {
    vi.stubEnv("APP_NAME", "")
    const { validateEnv } = await loadConfigModule()
    expect(() => validateEnv()).toThrow("Invalid environment variable: APP_NAME must be a non-empty string")
    vi.unstubAllEnvs()
  })

  it("throws error with specific variable name when WORKER_TIMEOUT_MS is not a number", async () => {
    vi.stubEnv("WORKER_TIMEOUT_MS", "not-a-number")
    const { validateEnv } = await loadConfigModule()
    expect(() => validateEnv()).toThrow("Invalid environment variable: WORKER_TIMEOUT_MS must be a positive number")
    vi.unstubAllEnvs()
  })

  it("throws error with specific variable name when WORKER_TIMEOUT_MS is negative", async () => {
    vi.stubEnv("WORKER_TIMEOUT_MS", "-100")
    const { validateEnv } = await loadConfigModule()
    expect(() => validateEnv()).toThrow("Invalid environment variable: WORKER_TIMEOUT_MS must be a positive number")
    vi.unstubAllEnvs()
  })

  it("throws error with specific variable name when API_PORT is not a valid port number", async () => {
    vi.stubEnv("API_PORT", "70000")
    const { validateEnv } = await loadConfigModule()
    expect(() => validateEnv()).toThrow("Invalid environment variable: API_PORT must be a valid port number (1-65535)")
    vi.unstubAllEnvs()
  })

  it("does not throw when all environment variables are valid", async () => {
    // Set valid values for required variables
    vi.stubEnv("PROJECT_ROOT", "/tmp/test-project")
    vi.stubEnv("APP_NAME", "TestApp")
    vi.stubEnv("WORKER_TIMEOUT_MS", "600000")
    vi.stubEnv("API_PORT", "3001")
    
    const { validateEnv } = await loadConfigModule()
    expect(() => validateEnv()).not.toThrow()
    vi.unstubAllEnvs()
  })

  it("includes variable name in error message for all validation errors", async () => {
    vi.stubEnv("PROJECT_ROOT", "")
    vi.stubEnv("APP_NAME", "")
    vi.stubEnv("WORKER_TIMEOUT_MS", "invalid")
    
    const { validateEnv } = await loadConfigModule()
    
    expect(() => validateEnv()).toThrow()
    
    // エラーメッセージをキャプチャして検証
    let errorMessage = ""
    try {
      validateEnv()
    } catch (error) {
      errorMessage = (error as Error).message
    }
    
    // Check that the error message contains variable names
    expect(errorMessage).toContain("PROJECT_ROOT")
    expect(errorMessage).toContain("APP_NAME")
    expect(errorMessage).toContain("WORKER_TIMEOUT_MS")
    
    vi.unstubAllEnvs()
  })

  it("formats error message with 'Invalid environment variable: ' prefix for single error", async () => {
    vi.stubEnv("PROJECT_ROOT", "")
    
    const { validateEnv } = await loadConfigModule()
    
    expect(() => validateEnv()).toThrow("Invalid environment variable: PROJECT_ROOT must be a non-empty string")
    
    vi.unstubAllEnvs()
  })

  it("formats error messages with 'Invalid environment variable: ' prefix for multiple errors separated by semicolons", async () => {
    vi.stubEnv("PROJECT_ROOT", "")
    vi.stubEnv("APP_NAME", "")
    vi.stubEnv("WORKER_TIMEOUT_MS", "invalid")
    vi.stubEnv("API_PORT", "70000")
    
    const { validateEnv } = await loadConfigModule()
    
    expect(() => validateEnv()).toThrow()
    
    // エラーメッセージをキャプチャして検証
    let errorMessage = ""
    try {
      validateEnv()
    } catch (error) {
      errorMessage = (error as Error).message
    }
    
    // Check that all error messages have the correct prefix
    expect(errorMessage).toMatch(/^Invalid environment variable: .*; Invalid environment variable: .*; Invalid environment variable: .*; Invalid environment variable: .*$/)
    
    // Check that each variable name appears in the error message
    expect(errorMessage).toContain("PROJECT_ROOT")
    expect(errorMessage).toContain("APP_NAME")
    expect(errorMessage).toContain("WORKER_TIMEOUT_MS")
    expect(errorMessage).toContain("API_PORT")
    
    vi.unstubAllEnvs()
  })

  it("includes variable name in error message for DB_PATH validation", async () => {
    vi.stubEnv("PROJECT_ROOT", "/tmp/test")
    vi.stubEnv("APP_NAME", "Test")
    vi.stubEnv("DB_PATH", "")
    
    const { validateEnv } = await loadConfigModule()
    
    expect(() => validateEnv()).toThrow("Invalid environment variable: DB_PATH must be a non-empty string")
    
    vi.unstubAllEnvs()
  })

  it("includes variable name in error message for BACKUP_DIR validation", async () => {
    vi.stubEnv("PROJECT_ROOT", "/tmp/test")
    vi.stubEnv("APP_NAME", "Test")
    vi.stubEnv("BACKUP_DIR", "")
    
    const { validateEnv } = await loadConfigModule()
    
    expect(() => validateEnv()).toThrow("Invalid environment variable: BACKUP_DIR must be a non-empty string")
    
    vi.unstubAllEnvs()
  })

  it("includes variable name in error message for WORKER_CONCURRENCY validation", async () => {
    vi.stubEnv("PROJECT_ROOT", "/tmp/test")
    vi.stubEnv("APP_NAME", "Test")
    vi.stubEnv("WORKER_CONCURRENCY", "0")
    
    const { validateEnv } = await loadConfigModule()
    
    expect(() => validateEnv()).toThrow("Invalid environment variable: WORKER_CONCURRENCY must be at least 1")
    
    vi.unstubAllEnvs()
  })

  it("includes variable name in error message for BACKUP_KEEP_COUNT validation", async () => {
    vi.stubEnv("PROJECT_ROOT", "/tmp/test")
    vi.stubEnv("APP_NAME", "Test")
    vi.stubEnv("BACKUP_KEEP_COUNT", "-1")
    
    const { validateEnv } = await loadConfigModule()
    
    expect(() => validateEnv()).toThrow("Invalid environment variable: BACKUP_KEEP_COUNT must be a non-negative number")
    
    vi.unstubAllEnvs()
  })

  it("includes variable name in error message for TESTER_TIMEOUT_MS validation when not a number", async () => {
    vi.stubEnv("PROJECT_ROOT", "/tmp/test")
    vi.stubEnv("APP_NAME", "Test")
    vi.stubEnv("TESTER_TIMEOUT_MS", "not-a-number")
    
    const { validateEnv } = await loadConfigModule()
    
    expect(() => validateEnv()).toThrow("Invalid environment variable: TESTER_TIMEOUT_MS must be a positive number")
    
    vi.unstubAllEnvs()
  })

  it("includes variable name in error message for TESTER_TIMEOUT_MS validation when negative", async () => {
    vi.stubEnv("PROJECT_ROOT", "/tmp/test")
    vi.stubEnv("APP_NAME", "Test")
    vi.stubEnv("TESTER_TIMEOUT_MS", "-100")
    
    const { validateEnv } = await loadConfigModule()
    
    expect(() => validateEnv()).toThrow("Invalid environment variable: TESTER_TIMEOUT_MS must be a positive number")
    
    vi.unstubAllEnvs()
  })

  it("includes variable name in error message for PM_TIMEOUT_MS validation when not a number", async () => {
    vi.stubEnv("PROJECT_ROOT", "/tmp/test")
    vi.stubEnv("APP_NAME", "Test")
    vi.stubEnv("PM_TIMEOUT_MS", "not-a-number")
    
    const { validateEnv } = await loadConfigModule()
    
    expect(() => validateEnv()).toThrow("Invalid environment variable: PM_TIMEOUT_MS must be a positive number")
    
    vi.unstubAllEnvs()
  })

  it("includes variable name in error message for PM_TIMEOUT_MS validation when negative", async () => {
    vi.stubEnv("PROJECT_ROOT", "/tmp/test")
    vi.stubEnv("APP_NAME", "Test")
    vi.stubEnv("PM_TIMEOUT_MS", "-100")
    
    const { validateEnv } = await loadConfigModule()
    
    expect(() => validateEnv()).toThrow("Invalid environment variable: PM_TIMEOUT_MS must be a positive number")
    
    vi.unstubAllEnvs()
  })
})
