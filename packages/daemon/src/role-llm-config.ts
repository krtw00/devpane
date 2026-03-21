import { config } from "./config.js"
import type { LlmConfig } from "./llm-api.js"

export type AgentRole = "tester" | "worker"

export function getRoleLlmConfig(role: AgentRole): LlmConfig {
  const roleConfig = role === "tester"
    ? {
        apiKey: config.TESTER_LLM_API_KEY,
        baseUrl: config.TESTER_LLM_BASE_URL,
        model: config.TESTER_LLM_MODEL,
        inputPricePerToken: config.TESTER_LLM_INPUT_PRICE,
        outputPricePerToken: config.TESTER_LLM_OUTPUT_PRICE,
      }
    : {
        apiKey: config.WORKER_LLM_API_KEY,
        baseUrl: config.WORKER_LLM_BASE_URL,
        model: config.WORKER_LLM_MODEL,
        inputPricePerToken: config.WORKER_LLM_INPUT_PRICE,
        outputPricePerToken: config.WORKER_LLM_OUTPUT_PRICE,
      }

  if (!roleConfig.apiKey || !roleConfig.baseUrl || !roleConfig.model) {
    throw new Error(`${role.toUpperCase()}_LLM_API_KEY, ${role.toUpperCase()}_LLM_BASE_URL, ${role.toUpperCase()}_LLM_MODEL (or shared LLM_*) are required when LLM_BACKEND=openai-compatible`)
  }

  return {
    apiKey: roleConfig.apiKey,
    baseUrl: roleConfig.baseUrl,
    model: roleConfig.model,
    inputPricePerToken: roleConfig.inputPricePerToken ?? undefined,
    outputPricePerToken: roleConfig.outputPricePerToken ?? undefined,
  }
}
