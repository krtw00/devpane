import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../agent-loop.js", () => ({
  runAgentLoop: vi.fn(),
}))

vi.mock("../db.js", () => ({
  appendLog: vi.fn(),
}))

vi.mock("../events.js", () => ({
  emit: vi.fn(),
}))

vi.mock("../config.js", () => ({
  config: {
    LLM_BACKEND: "openai-compatible",
    LLM_API_KEY: "test-key",
    LLM_BASE_URL: "http://localhost:8080",
    LLM_MODEL: "test-model",
    LLM_INPUT_PRICE: null,
    LLM_OUTPUT_PRICE: null,
    TESTER_LLM_API_KEY: "tester-key",
    TESTER_LLM_BASE_URL: "http://localhost:8081",
    TESTER_LLM_MODEL: "tester-model",
    TESTER_LLM_INPUT_PRICE: 0.123,
    TESTER_LLM_OUTPUT_PRICE: 0.456,
    TESTER_TIMEOUT_MS: 300_000,
    TEST_DIR: "src/__tests__",
    TEST_FILE_PATTERN: "*.test.ts",
    TEST_FRAMEWORK: "vitest",
    BUILD_CMD: "pnpm build",
  },
}))

import { runTester } from "../tester.js"
import { runAgentLoop } from "../agent-loop.js"
import { appendLog } from "../db.js"

const mockRunAgentLoop = vi.mocked(runAgentLoop)
const mockAppendLog = vi.mocked(appendLog)

describe("runTester API mode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("builds TesterResult from AgentLoop execution", async () => {
    mockRunAgentLoop.mockResolvedValueOnce({
      text: "tests created",
      cost_usd: 0.2,
      tokens_in: 120,
      tokens_out: 80,
      turns: 2,
      duration_ms: 500,
      tool_calls_count: 1,
    })

    const spec = {
      tasks: [{ title: "Task A", description: "Write tests", priority: 1 }],
      reasoning: "Reasoning text",
    }

    const result = await runTester(spec, "/tmp/worktree", "task-1")

    expect(result).toEqual({
      testFiles: [],
      exit_code: 0,
      timedOut: false,
    })

    const [systemPrompt, userPrompt, llmConfig, rootDir, _callbacks, _maxTurns, timeoutMs] = mockRunAgentLoop.mock.calls[0]
    expect(systemPrompt).toBe("あなたはテストエンジニアです。仕様に基づいてテストファイルを作成してください。")
    expect(rootDir).toBe("/tmp/worktree")
    expect(timeoutMs).toBe(300_000)
    expect(llmConfig).toEqual({
      apiKey: "tester-key",
      baseUrl: "http://localhost:8081",
      model: "tester-model",
      inputPricePerToken: 0.123,
      outputPricePerToken: 0.456,
    })
    expect(userPrompt).toContain("## Specification")
    expect(userPrompt).toContain("Task A")
    expect(userPrompt).toContain("Reasoning text")
  })

  it("collects test files from write_file tool calls", async () => {
    mockRunAgentLoop.mockImplementationOnce(async (...args: unknown[]) => {
      const callbacks = args[4] as {
        onToolCall?: (name: string, toolArgs: Record<string, unknown>) => void
      }

      callbacks.onToolCall?.("read_file", { path: "README.md" })
      callbacks.onToolCall?.("write_file", { path: "src/__tests__/alpha.test.ts" })
      callbacks.onToolCall?.("write_file", { path: "src/__tests__/beta.test.ts" })

      return {
        text: "done",
        cost_usd: 0,
        tokens_in: 0,
        tokens_out: 0,
        turns: 1,
        duration_ms: 20,
        tool_calls_count: 2,
      }
    })

    const spec = {
      tasks: [{ title: "Task A", description: "Write tests", priority: 1 }],
      reasoning: "Reasoning text",
    }

    const result = await runTester(spec, "/tmp/worktree", "task-2")

    expect(result.exit_code).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.testFiles).toEqual([
      "src/__tests__/alpha.test.ts",
      "src/__tests__/beta.test.ts",
    ])
  })

  it("ignores non-test files written by tester tools", async () => {
    mockRunAgentLoop.mockImplementationOnce(async (...args: unknown[]) => {
      const callbacks = args[4] as {
        onToolCall?: (name: string, toolArgs: Record<string, unknown>) => void
      }

      callbacks.onToolCall?.("write_file", { path: "packages/daemon/src/migrations/009_add_task_execution_logs.sql" })
      callbacks.onToolCall?.("write_file", { path: "src/__tests__/alpha.test.ts" })

      return {
        text: "done",
        cost_usd: 0,
        tokens_in: 0,
        tokens_out: 0,
        turns: 1,
        duration_ms: 20,
        tool_calls_count: 2,
      }
    })

    const spec = {
      tasks: [{ title: "Task A", description: "Write tests", priority: 1 }],
      reasoning: "Reasoning text",
    }

    const result = await runTester(spec, "/tmp/worktree", "task-3")

    expect(result.testFiles).toEqual(["src/__tests__/alpha.test.ts"])
  })

  it("logs tester tool activity and completion summary", async () => {
    mockRunAgentLoop.mockImplementationOnce(async (...args: unknown[]) => {
      const callbacks = args[4] as {
        onText?: (text: string) => void
        onToolCall?: (name: string, toolArgs: Record<string, unknown>) => void
        onToolResult?: (name: string, result: string, isError: boolean) => void
      }

      callbacks.onText?.("planning tests")
      callbacks.onToolCall?.("write_file", { path: "src/__tests__/alpha.test.ts" })
      callbacks.onToolResult?.("write_file", "Wrote src/__tests__/alpha.test.ts", false)

      return {
        text: "done",
        cost_usd: 0,
        tokens_in: 0,
        tokens_out: 0,
        turns: 3,
        duration_ms: 20,
        tool_calls_count: 1,
      }
    })

    const spec = {
      tasks: [{ title: "Task A", description: "Write tests", priority: 1 }],
      reasoning: "Reasoning text",
    }

    await runTester(spec, "/tmp/worktree", "task-4")

    expect(mockAppendLog).toHaveBeenCalledWith("task-4", "tester", "[text] planning tests")
    expect(mockAppendLog).toHaveBeenCalledWith("task-4", "tester", "[tool] write_file")
    expect(mockAppendLog).toHaveBeenCalledWith("task-4", "tester", "[write_file] Wrote src/__tests__/alpha.test.ts")
    expect(mockAppendLog).toHaveBeenCalledWith("task-4", "tester", "[done] turns=3 tool_calls=1 test_files=1")
  })
})
