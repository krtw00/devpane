import { describe, expect, it, vi } from "vitest"

vi.mock("../llm-api.js", () => ({
  chatCompletionWithTools: vi.fn(),
}))

vi.mock("../tool-executor.js", () => ({
  getToolDefinitions: vi.fn(() => []),
  executeTool: vi.fn(),
}))

import { AgentLoopTimeoutError, runAgentLoop } from "../agent-loop.js"

describe("runAgentLoop timeout", () => {
  it("throws AgentLoopTimeoutError when the overall loop timeout is exceeded", async () => {
    await expect(
      runAgentLoop(
        "system",
        "user",
        { apiKey: "k", baseUrl: "https://example.com", model: "m" },
        "/tmp",
        undefined,
        30,
        0,
      ),
    ).rejects.toBeInstanceOf(AgentLoopTimeoutError)
  })
})
