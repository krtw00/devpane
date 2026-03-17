import { config } from "./config.js"
import { spawnClaude } from "./claude.js"
import { chatCompletion } from "./llm-api.js"

export type BridgeResult = {
  text: string
  cost_usd: number
  tokens_used: number
}

/**
 * LLM_BACKENDに応じてCLI or APIを呼び分ける
 * PM/Gate1/Kaizen用（ツール不要の単純なプロンプト→テキスト呼び出し）
 */
export async function callLlm(prompt: string, cwd: string, timeoutMs?: number): Promise<BridgeResult> {
  if (config.LLM_BACKEND === "openai-compatible") {
    if (!config.LLM_API_KEY || !config.LLM_BASE_URL || !config.LLM_MODEL) {
      throw new Error("LLM_API_KEY, LLM_BASE_URL, LLM_MODEL are required when LLM_BACKEND=openai-compatible")
    }
    const llmConfig = {
      apiKey: config.LLM_API_KEY,
      baseUrl: config.LLM_BASE_URL,
      model: config.LLM_MODEL,
      inputPricePerToken: config.LLM_INPUT_PRICE ?? undefined,
      outputPricePerToken: config.LLM_OUTPUT_PRICE ?? undefined,
    }
    const result = await chatCompletion(
      [{ role: "user", content: prompt }],
      llmConfig,
      timeoutMs ?? config.PM_TIMEOUT_MS,
    )
    return { text: result.text, cost_usd: result.cost_usd, tokens_used: result.tokens_in + result.tokens_out }
  }

  // CLI mode
  const stdout = await spawnClaude(
    ["-p", prompt, "--output-format", "json"],
    cwd,
    timeoutMs,
  )
  return { text: stdout, cost_usd: 0, tokens_used: 0 }
}
