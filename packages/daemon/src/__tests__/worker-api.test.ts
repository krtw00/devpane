import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../agent-loop.js", () => ({
  runAgentLoop: vi.fn(),
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
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
    WORKER_LLM_API_KEY: "worker-key",
    WORKER_LLM_BASE_URL: "http://localhost:8082",
    WORKER_LLM_MODEL: "worker-model",
    WORKER_LLM_INPUT_PRICE: 0.111,
    WORKER_LLM_OUTPUT_PRICE: 0.222,
    WORKER_TIMEOUT_MS: 600_000,
    BUILD_CMD: "pnpm build",
    TEST_CMD: "pnpm test",
  },
}))

import { runWorker } from "../worker.js"
import { runAgentLoop } from "../agent-loop.js"
import { broadcast } from "../ws.js"
import { appendLog } from "../db.js"

const mockRunAgentLoop = vi.mocked(runAgentLoop)
const mockBroadcast = vi.mocked(broadcast)
const mockAppendLog = vi.mocked(appendLog)

describe("runWorker API mode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("builds WorkerResult from AgentLoopResult", async () => {
    mockRunAgentLoop.mockResolvedValueOnce({
      text: "implementation done",
      cost_usd: 0.42,
      tokens_in: 100,
      tokens_out: 50,
      turns: 4,
      duration_ms: 1234,
      tool_calls_count: 2,
    })

    const task = {
      id: "task-001",
      title: "Implement feature",
      description: "Implement X",
      status: "running" as const,
      created_by: "pm" as const,
      created_at: "",
      updated_at: "",
    }

    const result = await runWorker(task, "/tmp/worktree", ["src/__tests__/x.test.ts"])

    expect(result).toEqual({
      exit_code: 0,
      cost_usd: 0.42,
      num_turns: 4,
      result_text: "implementation done",
      duration_ms: 1234,
    })

    const [systemPrompt, userPrompt, llmConfig, rootDir, _callbacks, _maxTurns, timeoutMs] = mockRunAgentLoop.mock.calls[0]
    expect(systemPrompt).toBe("あなたは優秀なソフトウェアエンジニアです。ツールを使ってタスクを完遂してください。")
    expect(rootDir).toBe("/tmp/worktree")
    expect(timeoutMs).toBe(600_000)
    expect(llmConfig).toEqual({
      apiKey: "worker-key",
      baseUrl: "http://localhost:8082",
      model: "worker-model",
      inputPricePerToken: 0.111,
      outputPricePerToken: 0.222,
    })
    expect(userPrompt).toContain("Implement X")
    expect(userPrompt).toContain("src/__tests__/x.test.ts")
    expect(userPrompt).toContain("pnpm build")
    expect(userPrompt).toContain("pnpm test")
  })

  it("returns exit_code=1 when runAgentLoop throws", async () => {
    mockRunAgentLoop.mockRejectedValueOnce(new Error("timeout"))

    const task = {
      id: "task-err",
      title: "t",
      description: "d",
      status: "running" as const,
      created_by: "pm" as const,
      created_at: "",
      updated_at: "",
    }

    const result = await runWorker(task, "/tmp/worktree")

    expect(result.exit_code).toBe(1)
    expect(result.cost_usd).toBe(0)
    expect(result.num_turns).toBe(0)
    expect(result.result_text).toBe("")
    expect(result.duration_ms).toBe(0)
  })

  it("broadcasts callback events", async () => {
    mockRunAgentLoop.mockImplementationOnce(async (...args: unknown[]) => {
      const callbacks = args[4] as {
        onText?: (text: string) => void
        onToolCall?: (name: string, toolArgs: Record<string, unknown>) => void
        onToolResult?: (name: string, result: string, isError: boolean) => void
      }

      callbacks.onText?.("working")
      callbacks.onToolCall?.("read_file", { path: "src/a.ts" })
      callbacks.onToolResult?.("read_file", "ok", false)

      return {
        text: "done",
        cost_usd: 0,
        tokens_in: 0,
        tokens_out: 0,
        turns: 1,
        duration_ms: 10,
        tool_calls_count: 1,
      }
    })

    const task = {
      id: "task-cb",
      title: "t",
      description: "d",
      status: "running" as const,
      created_by: "pm" as const,
      created_at: "",
      updated_at: "",
    }

    await runWorker(task, "/tmp/worktree")

    expect(mockBroadcast).toHaveBeenCalledWith("worker:text", { taskId: "task-cb", text: "working" })
    expect(mockBroadcast).toHaveBeenCalledWith("worker:tool", { taskId: "task-cb", tool: "read_file" })
    expect(mockBroadcast).toHaveBeenCalledWith("worker:tool_input", { taskId: "task-cb", json: '{"path":"src/a.ts"}' })
    expect(mockBroadcast).toHaveBeenCalledWith("worker:text", { taskId: "task-cb", text: "[read_file] ok" })

    expect(mockAppendLog).toHaveBeenCalledWith("task-cb", "worker", "working")
    expect(mockAppendLog).toHaveBeenCalledWith("task-cb", "worker", "[tool] read_file")
    expect(mockAppendLog).toHaveBeenCalledWith("task-cb", "worker", "[tool_input] {\"path\":\"src/a.ts\"}")
    expect(mockAppendLog).toHaveBeenCalledWith("task-cb", "worker", "[read_file] ok")
  })
})
