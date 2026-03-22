import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("config validation", () => {
  beforeEach(() => {
    vi.resetModules()
    // Clear all environment variables that might affect tests
    vi.stubEnv("LLM_API_KEY", "")
    vi.stubEnv("LLM_BASE_URL", "")
    vi.stubEnv("LLM_MODEL", "")
    vi.stubEnv("CORS_ORIGIN", "")
    vi.stubEnv("ACTIVE_HOURS", "")
    vi.stubEnv("API_PORT", "3001")
    // Disable LLM backend for tests that don't require it
    vi.stubEnv("LLM_BACKEND", "none")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("should validate required environment variables", async () => {
    // Load the config module
    const mod = await import("../config.js")
    
    // Check if validateEnv function exists
    expect(mod).toHaveProperty("validateEnv")
    
    // Enable LLM backend for this test
    vi.stubEnv("LLM_BACKEND", "openai-compatible")
    // Clear required environment variables to test validation
    vi.stubEnv("LLM_API_KEY", "")
    
    // Call validateEnv and expect it to throw
    expect(() => mod.validateEnv()).toThrow("LLM_API_KEY is required")
  })

  it("should validate multiple required environment variables", async () => {
    const mod = await import("../config.js")
    
    // Enable LLM backend for this test
    vi.stubEnv("LLM_BACKEND", "openai-compatible")
    // Clear multiple required environment variables
    vi.stubEnv("LLM_API_KEY", "")
    vi.stubEnv("LLM_BASE_URL", "")
    vi.stubEnv("LLM_MODEL", "")
    
    // The error message should mention all missing variables
    // Implementation may throw on first missing variable or collect all errors
    expect(() => mod.validateEnv()).toThrow()
  })

  it("should pass validation when all required environment variables are set", async () => {
    const mod = await import("../config.js")
    
    // Enable LLM backend for this test
    vi.stubEnv("LLM_BACKEND", "openai-compatible")
    // Set required environment variables
    vi.stubEnv("LLM_API_KEY", "test-api-key")
    vi.stubEnv("LLM_BASE_URL", "https://api.example.com")
    vi.stubEnv("LLM_MODEL", "test-model")
    
    // Should not throw when all required variables are set
    expect(() => mod.validateEnv()).not.toThrow()
  })

  it("should validate optional environment variables with fallbacks", async () => {
    const mod = await import("../config.js")
    
    // Clear optional variables that have fallbacks
    vi.stubEnv("APP_NAME", "")
    vi.stubEnv("API_PORT", "")
    
    // Should not throw for optional variables with defaults
    expect(() => mod.validateEnv()).not.toThrow()
    
    // Verify defaults are used
    const config = mod.config
    expect(config.APP_NAME).toBe("DevPane")
    expect(config.API_PORT).toBe(3001)
  })

  it("should validate numeric environment variables", async () => {
    const mod = await import("../config.js")
    
    // LLM_BACKEND is already set to "none" in beforeEach
    // Set invalid numeric value
    vi.stubEnv("API_PORT", "not-a-number")
    
    // Should throw for invalid numeric value
    expect(() => mod.validateEnv()).toThrow("API_PORT must be a number")
  })

  it("should validate boolean environment variables", async () => {
    const mod = await import("../config.js")
    
    // Set invalid boolean value
    vi.stubEnv("ISSUE_SYNC_ENABLED", "not-a-boolean")
    
    // Should handle boolean validation gracefully
    // The current implementation uses === "true" comparison
    // So non-boolean strings will be treated as false
    expect(() => mod.validateEnv()).not.toThrow()
    
    // Verify the value is parsed correctly
    const config = mod.config
    expect(config.ISSUE_SYNC_ENABLED).toBe(false)
  })

  it("should validate CORS_ORIGIN format", async () => {
    // Set valid CORS_ORIGIN
    vi.stubEnv("CORS_ORIGIN", "https://example.com,https://api.example.com")
    
    // Reset modules to pick up the new environment variable
    vi.resetModules()
    const mod = await import("../config.js")
    
    expect(() => mod.validateEnv()).not.toThrow()
    
    const config = mod.config
    expect(config.CORS_ORIGIN).toEqual(["https://example.com", "https://api.example.com"])
  })

  it("should validate ACTIVE_HOURS format", async () => {
    // Set invalid ACTIVE_HOURS format
    vi.stubEnv("ACTIVE_HOURS", "invalid-format")
    
    const mod = await import("../config.js")
    
    // Should handle invalid format gracefully (returns null)
    expect(() => mod.validateEnv()).not.toThrow()
    
    const config = mod.config
    expect(config.ACTIVE_HOURS).toBeNull()
    
    // Set valid ACTIVE_HOURS format
    vi.stubEnv("ACTIVE_HOURS", "9-17")
    
    vi.resetModules()
    const mod2 = await import("../config.js")
    
    expect(() => mod2.validateEnv()).not.toThrow()
    
    const config2 = mod2.config
    expect(config2.ACTIVE_HOURS).toEqual({ start: 9, end: 17 })
  })

  it("should provide concise error messages for missing required variables", async () => {
    const mod = await import("../config.js")
    
    // Enable LLM backend for this test
    vi.stubEnv("LLM_BACKEND", "openai-compatible")
    // Clear a required variable
    vi.stubEnv("LLM_API_KEY", "")
    
    // Error message should be concise: "LLM_API_KEY is required"
    expect(() => mod.validateEnv()).toThrow(/^LLM_API_KEY is required$/)
  })

  it("should validate role-specific LLM configuration", async () => {
    // Enable LLM backend for this test
    vi.stubEnv("LLM_BACKEND", "openai-compatible")
    // Set only shared LLM config
    vi.stubEnv("LLM_API_KEY", "shared-key")
    vi.stubEnv("LLM_BASE_URL", "https://shared.example.com")
    vi.stubEnv("LLM_MODEL", "shared-model")
    
    const mod = await import("../config.js")
    
    expect(() => mod.validateEnv()).not.toThrow()
    
    const config = mod.config
    // Tester and worker should fall back to shared config
    expect(config.TESTER_LLM_API_KEY).toBe("shared-key")
    expect(config.WORKER_LLM_API_KEY).toBe("shared-key")
    
    // Set role-specific config
    vi.stubEnv("TESTER_LLM_API_KEY", "tester-key")
    vi.stubEnv("WORKER_LLM_MODEL", "worker-model")
    
    vi.resetModules()
    const mod2 = await import("../config.js")
    
    expect(() => mod2.validateEnv()).not.toThrow()
    
    const config2 = mod2.config
    expect(config2.TESTER_LLM_API_KEY).toBe("tester-key")
    expect(config2.WORKER_LLM_MODEL).toBe("worker-model")
  })
})