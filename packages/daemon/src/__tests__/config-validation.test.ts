import { describe, it, expect, vi, beforeEach } from "vitest"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = Record<string, any>

async function loadConfigWithValidation(): Promise<{ config: AnyConfig; validateEnv: () => void }> {
  const mod = await vi.importActual<{ config: AnyConfig; validateEnv: () => void }>("../config.js")
  return mod
}

describe("config validation", () => {
  beforeEach(() => {
    vi.resetModules()
    // テスト前に環境変数をクリア
    delete process.env.LLM_API_KEY
    delete process.env.LLM_BASE_URL
    delete process.env.LLM_MODEL
    delete process.env.TESTER_LLM_API_KEY
    delete process.env.TESTER_LLM_BASE_URL
    delete process.env.TESTER_LLM_MODEL
    delete process.env.WORKER_LLM_API_KEY
    delete process.env.WORKER_LLM_BASE_URL
    delete process.env.WORKER_LLM_MODEL
  })

  describe("validateEnv function", () => {
    it("should throw error when LLM_API_KEY is missing", async () => {
      const { validateEnv } = await loadConfigWithValidation()
      
      expect(() => validateEnv()).toThrow(/Missing required environment variable/)
      expect(() => validateEnv()).toThrow(/LLM_API_KEY/)
    })

    it("should throw error when LLM_BASE_URL is missing", async () => {
      vi.stubEnv("LLM_API_KEY", "test-api-key")
      const { validateEnv } = await loadConfigWithValidation()
      
      expect(() => validateEnv()).toThrow(/Missing required environment variable/)
      expect(() => validateEnv()).toThrow(/LLM_BASE_URL/)
      vi.unstubAllEnvs()
    })

    it("should throw error when LLM_MODEL is missing", async () => {
      vi.stubEnv("LLM_API_KEY", "test-api-key")
      vi.stubEnv("LLM_BASE_URL", "https://api.example.com")
      const { validateEnv } = await loadConfigWithValidation()
      
      expect(() => validateEnv()).toThrow(/Missing required environment variable/)
      expect(() => validateEnv()).toThrow(/LLM_MODEL/)
      vi.unstubAllEnvs()
    })

    it("should not throw error when all required LLM environment variables are set", async () => {
      vi.stubEnv("LLM_API_KEY", "test-api-key")
      vi.stubEnv("LLM_BASE_URL", "https://api.example.com")
      vi.stubEnv("LLM_MODEL", "gpt-4")
      const { validateEnv } = await loadConfigWithValidation()
      
      expect(() => validateEnv()).not.toThrow()
      vi.unstubAllEnvs()
    })

    it("should throw error with all missing variable names when multiple are missing", async () => {
      const { validateEnv } = await loadConfigWithValidation()
      
      expect(() => validateEnv()).toThrow(/Missing required environment variables: LLM_API_KEY, LLM_BASE_URL, LLM_MODEL/)
    })

    it("should accept role-specific environment variables as fallback", async () => {
      vi.stubEnv("TESTER_LLM_API_KEY", "tester-api-key")
      vi.stubEnv("TESTER_LLM_BASE_URL", "https://tester-api.example.com")
      vi.stubEnv("TESTER_LLM_MODEL", "tester-model")
      const { validateEnv } = await loadConfigWithValidation()
      
      expect(() => validateEnv()).not.toThrow()
      vi.unstubAllEnvs()
    })

    it("should accept worker-specific environment variables as fallback", async () => {
      vi.stubEnv("WORKER_LLM_API_KEY", "worker-api-key")
      vi.stubEnv("WORKER_LLM_BASE_URL", "https://worker-api.example.com")
      vi.stubEnv("WORKER_LLM_MODEL", "worker-model")
      const { validateEnv } = await loadConfigWithValidation()
      
      expect(() => validateEnv()).not.toThrow()
      vi.unstubAllEnvs()
    })

    it("should accept mixed environment variables configuration", async () => {
      vi.stubEnv("LLM_API_KEY", "shared-api-key")
      vi.stubEnv("TESTER_LLM_BASE_URL", "https://tester-api.example.com")
      vi.stubEnv("WORKER_LLM_MODEL", "worker-model")
      const { validateEnv } = await loadConfigWithValidation()
      
      expect(() => validateEnv()).not.toThrow()
      vi.unstubAllEnvs()
    })

    it("should prioritize role-specific variables over shared ones", async () => {
      vi.stubEnv("LLM_API_KEY", "shared-api-key")
      vi.stubEnv("LLM_BASE_URL", "https://shared-api.example.com")
      vi.stubEnv("LLM_MODEL", "shared-model")
      vi.stubEnv("TESTER_LLM_API_KEY", "tester-api-key")
      vi.stubEnv("WORKER_LLM_MODEL", "worker-model")
      
      const { config, validateEnv } = await loadConfigWithValidation()
      
      expect(() => validateEnv()).not.toThrow()
      expect(config.TESTER_LLM_API_KEY).toBe("tester-api-key")
      expect(config.WORKER_LLM_MODEL).toBe("worker-model")
      vi.unstubAllEnvs()
    })

    it("should have concise error message format", async () => {
      const { validateEnv } = await loadConfigWithValidation()
      
      try {
        validateEnv()
        expect.fail("Should have thrown an error")
      } catch (error) {
        const errorMessage = (error as Error).message
        // エラーメッセージが簡潔で具体的な変数名のみを含むことを確認
        expect(errorMessage).toMatch(/^Missing required environment variable/)
        expect(errorMessage).not.toContain("Error:")
        expect(errorMessage).not.toContain("Validation failed:")
        expect(errorMessage).not.toContain("Please set")
      }
    })

    it("should list all missing variables in a single error message", async () => {
      const { validateEnv } = await loadConfigWithValidation()
      
      try {
        validateEnv()
        expect.fail("Should have thrown an error")
      } catch (error) {
        const errorMessage = (error as Error).message
        // すべての欠けている変数が含まれていることを確認
        expect(errorMessage).toContain("LLM_API_KEY")
        expect(errorMessage).toContain("LLM_BASE_URL")
        expect(errorMessage).toContain("LLM_MODEL")
        // カンマ区切りで表示されることを確認
        expect(errorMessage).toMatch(/LLM_API_KEY,\s*LLM_BASE_URL,\s*LLM_MODEL/)
      }
    })
  })
})