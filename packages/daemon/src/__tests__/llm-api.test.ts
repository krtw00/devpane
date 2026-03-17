import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  chatCompletion,
  chatCompletionWithTools,
  chatCompletionStream,
  calculateCost,
  type LlmConfig,
  type LlmMessage,
} from "../llm-api.js"

const BASE_CONFIG: LlmConfig = {
  apiKey: "test-key",
  baseUrl: "https://api.example.com/v1",
  model: "gpt-4o",
}

const MESSAGES: LlmMessage[] = [{ role: "user", content: "hello" }]

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

describe("calculateCost", () => {
  it("calculates cost for known model", () => {
    // gpt-4o: input=2.5e-6, output=10e-6
    const cost = calculateCost("gpt-4o", 1000, 500)
    expect(cost).toBeCloseTo(1000 * 2.5e-6 + 500 * 10e-6, 10)
  })

  it("returns 0 for unknown model without override", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const cost = calculateCost("unknown-model", 1000, 500)
    expect(cost).toBe(0)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it("uses config override for unknown model", () => {
    const cfg: LlmConfig = {
      ...BASE_CONFIG,
      model: "unknown-model",
      inputPricePerToken: 1e-6,
      outputPricePerToken: 2e-6,
    }
    const cost = calculateCost("unknown-model", 1000, 500, cfg)
    expect(cost).toBeCloseTo(1000 * 1e-6 + 500 * 2e-6, 10)
  })

  it("prefers pricing table over config override for known model", () => {
    const cfg: LlmConfig = {
      ...BASE_CONFIG,
      inputPricePerToken: 999,
      outputPricePerToken: 999,
    }
    const cost = calculateCost("gpt-4o", 1000, 500, cfg)
    expect(cost).toBeCloseTo(1000 * 2.5e-6 + 500 * 10e-6, 10)
  })
})

describe("chatCompletion", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("returns LlmResult on success", async () => {
    globalThis.fetch = mockFetchJson({
      choices: [{ message: { content: "hi there" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }) as unknown as typeof fetch

    const result = await chatCompletion(MESSAGES, BASE_CONFIG)
    expect(result.text).toBe("hi there")
    expect(result.tokens_in).toBe(10)
    expect(result.tokens_out).toBe(5)
    expect(result.finish_reason).toBe("stop")
    expect(result.cost_usd).toBeGreaterThan(0)
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)

    // Verify fetch was called with correct params
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe("https://api.example.com/v1/chat/completions")
    const body = JSON.parse(call[1].body)
    expect(body.model).toBe("gpt-4o")
    expect(body.temperature).toBe(0)
  })

  it("throws on API error", async () => {
    globalThis.fetch = mockFetchJson({ error: "bad request" }, 400) as unknown as typeof fetch

    await expect(chatCompletion(MESSAGES, BASE_CONFIG)).rejects.toThrow("LLM API error 400")
  })

  it("throws on timeout", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
        }),
    ) as unknown as typeof fetch

    await expect(chatCompletion(MESSAGES, BASE_CONFIG, 10)).rejects.toThrow()
  })
})

describe("chatCompletionWithTools", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("parses tool_calls from response", async () => {
    globalThis.fetch = mockFetchJson({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 15 },
    }) as unknown as typeof fetch

    const tools = [
      {
        type: "function" as const,
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      },
    ]

    const result = await chatCompletionWithTools(MESSAGES, tools, BASE_CONFIG)
    expect(result.finish_reason).toBe("tool_calls")
    expect(result.tool_calls).toHaveLength(1)
    expect(result.tool_calls![0].function.name).toBe("get_weather")
    expect(result.tool_calls![0].function.arguments).toBe('{"city":"Tokyo"}')
    expect(result.tokens_in).toBe(20)
    expect(result.tokens_out).toBe(15)
  })

  it("returns stop when no tool_calls", async () => {
    globalThis.fetch = mockFetchJson({
      choices: [{ message: { content: "no tools needed" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }) as unknown as typeof fetch

    const result = await chatCompletionWithTools(MESSAGES, [], BASE_CONFIG)
    expect(result.finish_reason).toBe("stop")
    expect(result.tool_calls).toBeUndefined()
    expect(result.text).toBe("no tools needed")
  })
})

describe("chatCompletionStream", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("parses SSE chunks and calls onText", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop","delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      "data: [DONE]\n\n",
    ]

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    }) as unknown as typeof fetch

    const deltas: string[] = []
    const result = await chatCompletionStream(MESSAGES, BASE_CONFIG, {
      onText: (d) => deltas.push(d),
    })

    expect(result.text).toBe("Hello world")
    expect(deltas).toEqual(["Hello", " world"])
    expect(result.tokens_in).toBe(5)
    expect(result.tokens_out).toBe(2)
    expect(result.finish_reason).toBe("stop")
    expect(result.cost_usd).toBeGreaterThan(0)
  })

  it("warns when no usage chunk is present", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\n',
      "data: [DONE]\n\n",
    ]

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    }) as unknown as typeof fetch

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = await chatCompletionStream(MESSAGES, BASE_CONFIG, { onText: () => {} })

    expect(result.cost_usd).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("usage chunk"))
    warn.mockRestore()
  })

  it("throws on API error", async () => {
    globalThis.fetch = mockFetchJson({ error: "unauthorized" }, 401) as unknown as typeof fetch

    await expect(
      chatCompletionStream(MESSAGES, BASE_CONFIG, { onText: () => {} }),
    ).rejects.toThrow("LLM API error 401")
  })
})
