import { describe, it, expect, vi, beforeEach } from "vitest"
import type { LlmConfig, LlmResult } from "../llm-api.js"

// Mock llm-api before importing agent-loop
vi.mock("../llm-api.js", () => ({
  chatCompletionWithTools: vi.fn(),
}))

// Mock tool-executor to avoid real file operations
vi.mock("../tool-executor.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([
    {
      type: "function",
      function: { name: "read_file", description: "Read file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    },
  ]),
  executeTool: vi.fn().mockReturnValue({ output: "file content", is_error: false }),
}))

import { runAgentLoop } from "../agent-loop.js"
import { chatCompletionWithTools } from "../llm-api.js"
import { executeTool } from "../tool-executor.js"

const mockChat = vi.mocked(chatCompletionWithTools)
const mockExec = vi.mocked(executeTool)

const CONFIG: LlmConfig = {
  apiKey: "test",
  baseUrl: "https://api.example.com/v1",
  model: "gpt-4o",
}

function makeResult(overrides: Partial<LlmResult>): LlmResult {
  return {
    text: "",
    cost_usd: 0.001,
    tokens_in: 100,
    tokens_out: 50,
    duration_ms: 500,
    finish_reason: "stop",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("runAgentLoop", () => {
  it("returns text on single turn (no tool calls)", async () => {
    mockChat.mockResolvedValueOnce(makeResult({ text: "Hello!", finish_reason: "stop" }))

    const result = await runAgentLoop("system", "user", CONFIG, "/tmp")
    expect(result.text).toBe("Hello!")
    expect(result.turns).toBe(1)
    expect(result.tool_calls_count).toBe(0)
    expect(result.cost_usd).toBeCloseTo(0.001)
    expect(mockChat).toHaveBeenCalledOnce()
  })

  it("handles tool call then stop (2 turns)", async () => {
    // Turn 1: tool call
    mockChat.mockResolvedValueOnce(
      makeResult({
        text: "",
        finish_reason: "tool_calls",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"test.ts"}' } },
        ],
      }),
    )
    // Turn 2: final answer
    mockChat.mockResolvedValueOnce(makeResult({ text: "Done!", finish_reason: "stop" }))

    const result = await runAgentLoop("system", "user", CONFIG, "/tmp")
    expect(result.text).toBe("Done!")
    expect(result.turns).toBe(2)
    expect(result.tool_calls_count).toBe(1)
    expect(result.cost_usd).toBeCloseTo(0.002)
    expect(mockExec).toHaveBeenCalledWith("read_file", { path: "test.ts" }, "/tmp")
  })

  it("stops at maxTurns", async () => {
    // Always return tool calls
    mockChat.mockResolvedValue(
      makeResult({
        text: "thinking...",
        finish_reason: "tool_calls",
        tool_calls: [
          { id: "call_x", type: "function", function: { name: "read_file", arguments: '{"path":"x"}' } },
        ],
      }),
    )

    const result = await runAgentLoop("system", "user", CONFIG, "/tmp", undefined, 3)
    expect(result.turns).toBe(3)
    expect(result.text).toBe("thinking...")
  })

  it("accumulates cost and tokens", async () => {
    mockChat
      .mockResolvedValueOnce(
        makeResult({
          text: "",
          finish_reason: "tool_calls",
          cost_usd: 0.01,
          tokens_in: 200,
          tokens_out: 100,
          tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }],
        }),
      )
      .mockResolvedValueOnce(
        makeResult({
          text: "result",
          finish_reason: "stop",
          cost_usd: 0.02,
          tokens_in: 300,
          tokens_out: 150,
        }),
      )

    const result = await runAgentLoop("system", "user", CONFIG, "/tmp")
    expect(result.cost_usd).toBeCloseTo(0.03)
    expect(result.tokens_in).toBe(500)
    expect(result.tokens_out).toBe(250)
  })

  it("calls callbacks", async () => {
    mockChat
      .mockResolvedValueOnce(
        makeResult({
          text: "",
          finish_reason: "tool_calls",
          tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }],
        }),
      )
      .mockResolvedValueOnce(makeResult({ text: "final", finish_reason: "stop" }))

    const onText = vi.fn()
    const onToolCall = vi.fn()
    const onToolResult = vi.fn()

    await runAgentLoop("system", "user", CONFIG, "/tmp", { onText, onToolCall, onToolResult })

    expect(onToolCall).toHaveBeenCalledWith("read_file", { path: "a.ts" })
    expect(onToolResult).toHaveBeenCalledWith("read_file", "file content", false)
    expect(onText).toHaveBeenCalledWith("final")
  })
})
