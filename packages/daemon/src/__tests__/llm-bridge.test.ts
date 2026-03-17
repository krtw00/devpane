import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock config
const mockConfig = {
  LLM_BACKEND: "cli" as "cli" | "openai-compatible",
  LLM_API_KEY: null as string | null,
  LLM_BASE_URL: null as string | null,
  LLM_MODEL: null as string | null,
  LLM_INPUT_PRICE: null as number | null,
  LLM_OUTPUT_PRICE: null as number | null,
  PM_TIMEOUT_MS: 300000,
  PROJECT_ROOT: "/tmp/test",
}

vi.mock("../config.js", () => ({
  config: mockConfig,
}))

const mockSpawnClaude = vi.fn()
vi.mock("../claude.js", () => ({
  spawnClaude: (...args: unknown[]) => mockSpawnClaude(...args),
}))

const mockChatCompletion = vi.fn()
vi.mock("../llm-api.js", () => ({
  chatCompletion: (...args: unknown[]) => mockChatCompletion(...args),
}))

describe("callLlm", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.LLM_BACKEND = "cli"
    mockConfig.LLM_API_KEY = null
    mockConfig.LLM_BASE_URL = null
    mockConfig.LLM_MODEL = null
    mockConfig.LLM_INPUT_PRICE = null
    mockConfig.LLM_OUTPUT_PRICE = null
  })

  it("CLI mode: calls spawnClaude with correct args", async () => {
    mockSpawnClaude.mockResolvedValue('{"result":"hello"}')

    const { callLlm } = await import("../llm-bridge.js")
    const result = await callLlm("test prompt", "/tmp/cwd", 60000)

    expect(mockSpawnClaude).toHaveBeenCalledOnce()
    expect(mockSpawnClaude).toHaveBeenCalledWith(
      ["-p", "test prompt", "--output-format", "json"],
      "/tmp/cwd",
      60000,
    )
    expect(result.text).toBe('{"result":"hello"}')
    expect(result.cost_usd).toBe(0)
    expect(result.tokens_used).toBe(0)
  })

  it("CLI mode: does not call chatCompletion", async () => {
    mockSpawnClaude.mockResolvedValue("output")

    const { callLlm } = await import("../llm-bridge.js")
    await callLlm("prompt", "/tmp/cwd")

    expect(mockChatCompletion).not.toHaveBeenCalled()
  })

  it("API mode: calls chatCompletion with correct config", async () => {
    mockConfig.LLM_BACKEND = "openai-compatible"
    mockConfig.LLM_API_KEY = "sk-test"
    mockConfig.LLM_BASE_URL = "https://api.example.com/v1"
    mockConfig.LLM_MODEL = "test-model"

    mockChatCompletion.mockResolvedValue({
      text: '{"tasks":[]}',
      cost_usd: 0.01,
      tokens_in: 100,
      tokens_out: 50,
      duration_ms: 1000,
      finish_reason: "stop",
    })

    const { callLlm } = await import("../llm-bridge.js")
    const result = await callLlm("test prompt", "/tmp/cwd", 120000)

    expect(mockChatCompletion).toHaveBeenCalledOnce()
    const [messages, llmConfig, timeout] = mockChatCompletion.mock.calls[0]
    expect(messages).toEqual([{ role: "user", content: "test prompt" }])
    expect(llmConfig.apiKey).toBe("sk-test")
    expect(llmConfig.baseUrl).toBe("https://api.example.com/v1")
    expect(llmConfig.model).toBe("test-model")
    expect(timeout).toBe(120000)

    expect(result.text).toBe('{"tasks":[]}')
    expect(result.cost_usd).toBe(0.01)
    expect(result.tokens_used).toBe(150)
  })

  it("API mode: does not call spawnClaude", async () => {
    mockConfig.LLM_BACKEND = "openai-compatible"
    mockConfig.LLM_API_KEY = "sk-test"
    mockConfig.LLM_BASE_URL = "https://api.example.com/v1"
    mockConfig.LLM_MODEL = "test-model"

    mockChatCompletion.mockResolvedValue({
      text: "output",
      cost_usd: 0,
      tokens_in: 0,
      tokens_out: 0,
      duration_ms: 0,
      finish_reason: "stop",
    })

    const { callLlm } = await import("../llm-bridge.js")
    await callLlm("prompt", "/tmp/cwd")

    expect(mockSpawnClaude).not.toHaveBeenCalled()
  })

  it("API mode: throws when LLM_API_KEY is missing", async () => {
    mockConfig.LLM_BACKEND = "openai-compatible"
    mockConfig.LLM_BASE_URL = "https://api.example.com/v1"
    mockConfig.LLM_MODEL = "test-model"
    // LLM_API_KEY is null

    const { callLlm } = await import("../llm-bridge.js")
    await expect(callLlm("prompt", "/tmp/cwd")).rejects.toThrow(
      "LLM_API_KEY, LLM_BASE_URL, LLM_MODEL are required",
    )
  })

  it("API mode: throws when LLM_BASE_URL is missing", async () => {
    mockConfig.LLM_BACKEND = "openai-compatible"
    mockConfig.LLM_API_KEY = "sk-test"
    mockConfig.LLM_MODEL = "test-model"
    // LLM_BASE_URL is null

    const { callLlm } = await import("../llm-bridge.js")
    await expect(callLlm("prompt", "/tmp/cwd")).rejects.toThrow(
      "LLM_API_KEY, LLM_BASE_URL, LLM_MODEL are required",
    )
  })

  it("API mode: throws when LLM_MODEL is missing", async () => {
    mockConfig.LLM_BACKEND = "openai-compatible"
    mockConfig.LLM_API_KEY = "sk-test"
    mockConfig.LLM_BASE_URL = "https://api.example.com/v1"
    // LLM_MODEL is null

    const { callLlm } = await import("../llm-bridge.js")
    await expect(callLlm("prompt", "/tmp/cwd")).rejects.toThrow(
      "LLM_API_KEY, LLM_BASE_URL, LLM_MODEL are required",
    )
  })

  it("API mode: passes price overrides when configured", async () => {
    mockConfig.LLM_BACKEND = "openai-compatible"
    mockConfig.LLM_API_KEY = "sk-test"
    mockConfig.LLM_BASE_URL = "https://api.example.com/v1"
    mockConfig.LLM_MODEL = "test-model"
    mockConfig.LLM_INPUT_PRICE = 0.5e-6
    mockConfig.LLM_OUTPUT_PRICE = 1.5e-6

    mockChatCompletion.mockResolvedValue({
      text: "output",
      cost_usd: 0.001,
      tokens_in: 100,
      tokens_out: 50,
      duration_ms: 500,
      finish_reason: "stop",
    })

    const { callLlm } = await import("../llm-bridge.js")
    await callLlm("prompt", "/tmp/cwd")

    const [, llmConfig] = mockChatCompletion.mock.calls[0]
    expect(llmConfig.inputPricePerToken).toBe(0.5e-6)
    expect(llmConfig.outputPricePerToken).toBe(1.5e-6)
  })

  it("CLI mode: uses PM_TIMEOUT_MS as default timeout for spawnClaude", async () => {
    mockSpawnClaude.mockResolvedValue("output")

    const { callLlm } = await import("../llm-bridge.js")
    await callLlm("prompt", "/tmp/cwd") // no timeoutMs

    const [, , timeout] = mockSpawnClaude.mock.calls[0]
    expect(timeout).toBeUndefined() // spawnClaude uses its own default
  })

  it("API mode: uses PM_TIMEOUT_MS as default timeout when timeoutMs not provided", async () => {
    mockConfig.LLM_BACKEND = "openai-compatible"
    mockConfig.LLM_API_KEY = "sk-test"
    mockConfig.LLM_BASE_URL = "https://api.example.com/v1"
    mockConfig.LLM_MODEL = "test-model"

    mockChatCompletion.mockResolvedValue({
      text: "output",
      cost_usd: 0,
      tokens_in: 0,
      tokens_out: 0,
      duration_ms: 0,
      finish_reason: "stop",
    })

    const { callLlm } = await import("../llm-bridge.js")
    await callLlm("prompt", "/tmp/cwd") // no timeoutMs

    const [, , timeout] = mockChatCompletion.mock.calls[0]
    expect(timeout).toBe(300000) // PM_TIMEOUT_MS
  })
})
