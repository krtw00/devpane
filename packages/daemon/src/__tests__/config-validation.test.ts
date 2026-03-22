import { describe, it, expect, vi, beforeEach } from "vitest"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = Record<string, any>

async function loadConfig(): Promise<AnyConfig> {
  const mod = await vi.importActual<{ config: AnyConfig }>("../config.js")
  return mod.config
}

async function loadConfigModule(): Promise<any> {
  return await vi.importActual<{ config: AnyConfig; validateEnv: () => void }>("../config.js")
}

describe("config validation", () => {
  beforeEach(() => {
    vi.resetModules()
    // Clear all environment variables for validation tests
    vi.unstubAllEnvs()
  })

  describe("validateEnv function", () => {
    it("should throw error with variable name when LLM_API_KEY is not set for LLM_BACKEND=openai-compatible", async () => {
      vi.stubEnv("LLM_BACKEND", "openai-compatible")
      delete process.env.LLM_API_KEY
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/LLM_API_KEY/i)
    })

    it("should throw error with variable name when LLM_BASE_URL is not set for LLM_BACKEND=openai-compatible", async () => {
      vi.stubEnv("LLM_BACKEND", "openai-compatible")
      vi.stubEnv("LLM_API_KEY", "test-key")
      delete process.env.LLM_BASE_URL
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/LLM_BASE_URL/i)
    })

    it("should throw error with variable name when LLM_MODEL is not set for LLM_BACKEND=openai-compatible", async () => {
      vi.stubEnv("LLM_BACKEND", "openai-compatible")
      vi.stubEnv("LLM_API_KEY", "test-key")
      vi.stubEnv("LLM_BASE_URL", "https://api.example.com")
      delete process.env.LLM_MODEL
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/LLM_MODEL/i)
    })

    it("should throw error with variable name when PROJECT_ROOT is empty string", async () => {
      vi.stubEnv("LLM_BACKEND", "mock")
      vi.stubEnv("PROJECT_ROOT", "")
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/PROJECT_ROOT/i)
    })

    it("should throw error with variable name when API_PORT is not a valid number", async () => {
      vi.stubEnv("API_PORT", "not-a-number")
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/API_PORT/i)
    })

    it("should throw error with variable name when API_PORT is out of range", async () => {
      vi.stubEnv("API_PORT", "0")
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/API_PORT/i)
    })

    it("should throw error with variable name when WORKER_CONCURRENCY is not a positive integer", async () => {
      vi.stubEnv("WORKER_CONCURRENCY", "0")
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/WORKER_CONCURRENCY/i)
    })

    it("should throw error with variable name when WORKER_CONCURRENCY is not a number", async () => {
      vi.stubEnv("WORKER_CONCURRENCY", "invalid")
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/WORKER_CONCURRENCY/i)
    })

    it("should throw error with variable name when ACTIVE_HOURS has invalid format", async () => {
      vi.stubEnv("ACTIVE_HOURS", "invalid-format")
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/ACTIVE_HOURS/i)
    })

    it("should throw error with variable name when ACTIVE_HOURS has out of range values", async () => {
      vi.stubEnv("ACTIVE_HOURS", "25-30")
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/ACTIVE_HOURS/i)
    })

    it("should not throw error when all required environment variables are properly set", async () => {
      vi.stubEnv("LLM_BACKEND", "openai-compatible")
      vi.stubEnv("LLM_API_KEY", "test-key")
      vi.stubEnv("LLM_BASE_URL", "https://api.example.com")
      vi.stubEnv("LLM_MODEL", "gpt-4")
      vi.stubEnv("PROJECT_ROOT", process.cwd())
      vi.stubEnv("API_PORT", "3001")
      vi.stubEnv("WORKER_CONCURRENCY", "1")
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).not.toThrow()
    })

    it("should not require LLM variables when LLM_BACKEND is not openai-compatible", async () => {
      vi.stubEnv("LLM_BACKEND", "mock")
      delete process.env.LLM_API_KEY
      delete process.env.LLM_BASE_URL
      delete process.env.LLM_MODEL
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).not.toThrow()
    })

    it("should validate numeric environment variables", async () => {
      vi.stubEnv("LLM_BACKEND", "mock")
      vi.stubEnv("WORKER_TIMEOUT_MS", "invalid-number")
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/WORKER_TIMEOUT_MS/i)
    })

    it("should validate that timeout values are positive", async () => {
      vi.stubEnv("LLM_BACKEND", "mock")
      vi.stubEnv("WORKER_TIMEOUT_MS", "-100")
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/WORKER_TIMEOUT_MS/i)
    })

    it("should validate that interval values are positive", async () => {
      vi.stubEnv("LLM_BACKEND", "mock")
      vi.stubEnv("IDLE_INTERVAL_SEC", "0")
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/IDLE_INTERVAL_SEC/i)
    })

    it("should validate CORS_ORIGIN format when provided", async () => {
      vi.stubEnv("LLM_BACKEND", "mock")
      vi.stubEnv("CORS_ORIGIN", "invalid url")
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).toThrow(/CORS_ORIGIN/i)
    })

    it("should accept valid CORS_ORIGIN format", async () => {
      vi.stubEnv("LLM_BACKEND", "mock")
      vi.stubEnv("CORS_ORIGIN", "https://example.com,http://localhost:3000")
      
      const mod = await loadConfigModule()
      
      expect(() => mod.validateEnv()).not.toThrow()
    })
  })

  describe("existing config tests compatibility", () => {
    it("should still load config successfully with valid environment", async () => {
      vi.stubEnv("LLM_BACKEND", "openai-compatible")
      vi.stubEnv("LLM_API_KEY", "test-key")
      vi.stubEnv("LLM_BASE_URL", "https://api.example.com")
      vi.stubEnv("LLM_MODEL", "gpt-4")
      vi.stubEnv("PROJECT_ROOT", process.cwd())
      
      const config = await loadConfig()
      
      expect(config.LLM_BACKEND).toBe("openai-compatible")
      expect(config.LLM_API_KEY).toBe("test-key")
      expect(config.LLM_BASE_URL).toBe("https://api.example.com")
      expect(config.LLM_MODEL).toBe("gpt-4")
    })

    it("should maintain backward compatibility for optional environment variables", async () => {
      vi.stubEnv("LLM_BACKEND", "mock")
      delete process.env.API_TOKEN
      delete process.env.CORS_ORIGIN
      
      const config = await loadConfig()
      
      expect(config.API_TOKEN).toBeNull()
      expect(config.CORS_ORIGIN).toBeNull()
    })
  })
})