import type { Task } from "@devpane/shared"
import { config } from "./config.js"
import { appendLog } from "./db.js"
import { runAgentLoop, type AgentLoopCallbacks } from "./agent-loop.js"
import { broadcast } from "./ws.js"

export type WorkerResult = {
  exit_code: number
  result_text: string
  cost_usd: number
  num_turns: number
  duration_ms: number
}

export function killAllWorkers(): void {
  // No-op: API mode does not spawn child processes
}

function buildWorkerPrompt(task: Task, testFiles: string[]): string {
  const promptParts = [task.description]

  if (testFiles.length > 0) {
    promptParts.push(
      "",
      "## Test-First Implementation",
      "The following test files already exist in the worktree. Write the implementation that makes these tests pass.",
      "Read the tests to understand the specification. Do NOT delete or modify the test files.",
      ...testFiles.map(f => `- ${f}`),
    )
  }

  promptParts.push(
    "",
    "## Quality Requirements (mandatory)",
    `- \`${config.BUILD_CMD}\` must pass (no type errors)`,
    `- \`${config.TEST_CMD}\` must pass (do not break existing tests)`,
    "- No lint warnings (unused imports, unused variables, etc.)",
    "- New files must follow the existing code style",
  )

  return promptParts.join("\n")
}

export async function runWorker(task: Task, worktreePath: string, testFiles: string[] = []): Promise<WorkerResult> {
  try {
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

    const fullPrompt = buildWorkerPrompt(task, testFiles)
    const callbacks: AgentLoopCallbacks = {
      onText: (text) => {
        appendLog(task.id, "worker", text)
        broadcast("worker:text", { taskId: task.id, text })
      },
      onToolCall: (name, args) => {
        appendLog(task.id, "worker", `[tool] ${name}`)
        broadcast("worker:tool", { taskId: task.id, tool: name })

        const json = JSON.stringify(args)
        appendLog(task.id, "worker", `[tool_input] ${json}`)
        broadcast("worker:tool_input", { taskId: task.id, json })
      },
      onToolResult: (name, result) => {
        const text = `[${name}] ${result}`
        appendLog(task.id, "worker", text)
        broadcast("worker:text", { taskId: task.id, text })
      },
    }

    const result = await runAgentLoop(
      "あなたは優秀なソフトウェアエンジニアです。ツールを使ってタスクを完遂してください。",
      fullPrompt,
      llmConfig,
      worktreePath,
      callbacks,
      undefined,
      config.WORKER_TIMEOUT_MS,
    )

    return {
      exit_code: 0,
      cost_usd: result.cost_usd,
      num_turns: result.turns,
      result_text: result.text,
      duration_ms: result.duration_ms,
    }
  } catch (error) {
    appendLog(task.id, "worker", `[error] ${error instanceof Error ? error.message : String(error)}`)
    return {
      exit_code: 1,
      cost_usd: 0,
      num_turns: 0,
      result_text: "",
      duration_ms: 0,
    }
  }
}
