import { chatCompletionWithTools, type LlmConfig, type LlmMessage, type LlmResult } from "./llm-api.js"
import { getToolDefinitions, executeTool, type ToolResult } from "./tool-executor.js"

export type AgentLoopCallbacks = {
  onText?: (text: string) => void
  onToolCall?: (name: string, args: Record<string, unknown>) => void
  onToolResult?: (name: string, result: string, isError: boolean) => void
}

export type AgentLoopResult = {
  text: string
  cost_usd: number
  tokens_in: number
  tokens_out: number
  turns: number
  duration_ms: number
  tool_calls_count: number
}

const DEFAULT_MAX_TURNS = 30
const DEFAULT_TIMEOUT_MS = 600_000

export async function runAgentLoop(
  systemPrompt: string,
  userPrompt: string,
  llmConfig: LlmConfig,
  rootDir: string,
  callbacks?: AgentLoopCallbacks,
  maxTurns: number = DEFAULT_MAX_TURNS,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AgentLoopResult> {
  const startTime = Date.now()
  const tools = getToolDefinitions()
  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]

  let totalCost = 0
  let totalTokensIn = 0
  let totalTokensOut = 0
  let turns = 0
  let toolCallsCount = 0
  let lastText = ""

  while (turns < maxTurns) {
    // Timeout check
    if (Date.now() - startTime > timeoutMs) {
      break
    }

    turns++
    const result: LlmResult = await chatCompletionWithTools(messages, tools, llmConfig)

    totalCost += result.cost_usd
    totalTokensIn += result.tokens_in
    totalTokensOut += result.tokens_out

    if (result.text) {
      lastText = result.text
      callbacks?.onText?.(result.text)
    }

    if (result.finish_reason !== "tool_calls" || !result.tool_calls || result.tool_calls.length === 0) {
      // No tool calls -> done
      break
    }

    // Add assistant message with tool_calls to history
    // We need to include tool_calls in the message for the API protocol
    messages.push({
      role: "assistant",
      content: result.text || "",
      tool_calls: result.tool_calls,
    } as unknown as LlmMessage)

    // Execute each tool call and add results
    for (const tc of result.tool_calls) {
      let parsedArgs: Record<string, unknown>
      try {
        parsedArgs = JSON.parse(tc.function.arguments)
      } catch {
        parsedArgs = {}
      }

      callbacks?.onToolCall?.(tc.function.name, parsedArgs)

      const toolResult: ToolResult = executeTool(tc.function.name, parsedArgs, rootDir)
      toolCallsCount++

      callbacks?.onToolResult?.(tc.function.name, toolResult.output, toolResult.is_error)

      messages.push({
        role: "tool",
        content: toolResult.output,
        tool_call_id: tc.id,
      })
    }
  }

  return {
    text: lastText,
    cost_usd: totalCost,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
    turns,
    duration_ms: Date.now() - startTime,
    tool_calls_count: toolCallsCount,
  }
}
