// OpenAI-compatible chat/completions API client (Node.js fetch only)

export type LlmMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  tool_call_id?: string
}

export type LlmToolDefinition = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type LlmToolCall = {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export type LlmResult = {
  text: string
  cost_usd: number
  tokens_in: number
  tokens_out: number
  duration_ms: number
  tool_calls?: LlmToolCall[]
  finish_reason: string
}

export type LlmConfig = {
  apiKey: string
  baseUrl: string
  model: string
  inputPricePerToken?: number
  outputPricePerToken?: number
}

// $/token pricing table
const PRICING: Record<string, { input: number; output: number }> = {
  // DeepSeek
  "deepseek-chat": { input: 0.28e-6, output: 0.42e-6 },
  "deepseek-reasoner": { input: 0.55e-6, output: 2.19e-6 },
  // OpenAI
  "gpt-4o": { input: 2.5e-6, output: 10e-6 },
  "gpt-4o-mini": { input: 0.15e-6, output: 0.6e-6 },
  "o4-mini": { input: 1.1e-6, output: 4.4e-6 },
  // Google (OpenAI-compatible endpoint)
  "gemini-2.5-flash": { input: 0.15e-6, output: 0.6e-6 },
  "gemini-2.5-pro": { input: 1.25e-6, output: 10e-6 },
  // Claude (future adapter)
  "claude-sonnet-4-6": { input: 3e-6, output: 15e-6 },
}

export function calculateCost(
  model: string,
  tokensIn: number,
  tokensOut: number,
  config?: LlmConfig,
): number {
  const pricing = PRICING[model]
  if (pricing) {
    return tokensIn * pricing.input + tokensOut * pricing.output
  }
  if (config?.inputPricePerToken != null && config?.outputPricePerToken != null) {
    return tokensIn * config.inputPricePerToken + tokensOut * config.outputPricePerToken
  }
  console.warn(`[llm-api] Unknown model "${model}" and no price override — cost will be 0`)
  return 0
}

function buildHeaders(config: LlmConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  }
}

function buildUrl(config: LlmConfig): string {
  const base = config.baseUrl.replace(/\/+$/, "")
  return `${base}/chat/completions`
}

export async function chatCompletion(
  messages: LlmMessage[],
  config: LlmConfig,
  timeoutMs = 120_000,
): Promise<LlmResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()

  try {
    const res = await fetch(buildUrl(config), {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify({ model: config.model, messages, temperature: 0 }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`LLM API error ${res.status}: ${body}`)
    }

    const data = await res.json()
    const choice = data.choices?.[0]
    const tokensIn = data.usage?.prompt_tokens ?? 0
    const tokensOut = data.usage?.completion_tokens ?? 0

    return {
      text: choice?.message?.content ?? "",
      cost_usd: calculateCost(config.model, tokensIn, tokensOut, config),
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      duration_ms: Date.now() - start,
      finish_reason: choice?.finish_reason ?? "stop",
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function chatCompletionWithTools(
  messages: LlmMessage[],
  tools: LlmToolDefinition[],
  config: LlmConfig,
  timeoutMs = 120_000,
): Promise<LlmResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()

  try {
    const res = await fetch(buildUrl(config), {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify({ model: config.model, messages, tools, temperature: 0 }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`LLM API error ${res.status}: ${body}`)
    }

    const data = await res.json()
    const choice = data.choices?.[0]
    const tokensIn = data.usage?.prompt_tokens ?? 0
    const tokensOut = data.usage?.completion_tokens ?? 0
    const toolCalls: LlmToolCall[] | undefined = choice?.message?.tool_calls?.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tc: any) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }),
    )

    return {
      text: choice?.message?.content ?? "",
      cost_usd: calculateCost(config.model, tokensIn, tokensOut, config),
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      duration_ms: Date.now() - start,
      tool_calls: toolCalls,
      finish_reason: toolCalls && toolCalls.length > 0 ? "tool_calls" : (choice?.finish_reason ?? "stop"),
    }
  } finally {
    clearTimeout(timer)
  }
}

export type StreamCallbacks = {
  onText: (delta: string) => void
}

export async function chatCompletionStream(
  messages: LlmMessage[],
  config: LlmConfig,
  callbacks: StreamCallbacks,
  timeoutMs = 120_000,
): Promise<LlmResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()

  try {
    const res = await fetch(buildUrl(config), {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`LLM API error ${res.status}: ${body}`)
    }

    if (!res.body) {
      throw new Error("LLM API returned no body for streaming request")
    }

    let fullText = ""
    let tokensIn = 0
    let tokensOut = 0
    let hasUsage = false
    let finishReason = "stop"

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(":")) continue
        if (trimmed === "data: [DONE]") continue

        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6)
          try {
            const chunk = JSON.parse(jsonStr)

            // Usage chunk (last chunk with usage info)
            if (chunk.usage) {
              tokensIn = chunk.usage.prompt_tokens ?? 0
              tokensOut = chunk.usage.completion_tokens ?? 0
              hasUsage = true
            }

            const delta = chunk.choices?.[0]?.delta
            if (delta?.content) {
              fullText += delta.content
              callbacks.onText(delta.content)
            }

            const reason = chunk.choices?.[0]?.finish_reason
            if (reason) {
              finishReason = reason
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    }

    if (!hasUsage) {
      console.warn("[llm-api] Stream ended without usage chunk — cost will be 0")
    }

    return {
      text: fullText,
      cost_usd: calculateCost(config.model, tokensIn, tokensOut, config),
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      duration_ms: Date.now() - start,
      finish_reason: finishReason,
    }
  } finally {
    clearTimeout(timer)
  }
}
