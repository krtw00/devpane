import type { Task } from "@devpane/shared"
import { config } from "./config.js"
import { appendLog, getTaskLogs } from "./db.js"
import { runAgentLoop, type AgentLoopCallbacks } from "./agent-loop.js"
import { getRoleLlmConfig } from "./role-llm-config.js"
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

function truncateLog(text: string, max = 400): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`
}

function collectRetryContext(task: Task): string[] {
  if ((task.retry_count ?? 0) <= 0) return []

  const relevantAgents = new Set(["worker", "gate3", "build", "system", "tester"])
  const relevantPattern = /\[error\]|\[kill\]|\[recycle\]|tests failed|diff too large|exit_code=|no commit produced|no files changed|lint errors|timed out|max retries/i

  const seen = new Set<string>()
  const lines = getTaskLogs(task.id)
    .filter((log) => relevantAgents.has(log.agent) && relevantPattern.test(log.message))
    .slice(-5)
    .map((log) => `${log.agent}: ${log.message.replace(/\s+/g, " ").trim()}`)
    .filter((line) => {
      if (seen.has(line)) return false
      seen.add(line)
      return true
    })

  return lines
}

function buildWorkerPrompt(task: Task, testFiles: string[]): string {
  const promptParts = [task.description]
  const retryContext = collectRetryContext(task)

  if (testFiles.length > 0) {
    promptParts.push(
      "",
      "## Test-First Implementation",
      "The following test files already exist in the worktree. Write the implementation that makes these tests pass.",
      "Read the tests to understand the specification. Do NOT delete or modify the test files.",
      ...testFiles.map(f => `- ${f}`),
    )
  }

  if (retryContext.length > 0) {
    promptParts.push(
      "",
      "## Retry Context",
      "Previous attempt signals to address first:",
      ...retryContext.map(line => `- ${line}`),
    )
  }

  promptParts.push(
    "",
    "## Execution Strategy (mandatory)",
    "- Prefer targeted reads and targeted test commands for the files you change",
    `- Avoid broad suite runs such as \`${config.TEST_CMD}\` during iteration; use them only for final verification`,
    "- If command output is long, narrow it with a single test file, rg, head, or tail instead of rerunning the full command",
    "- Fix the concrete failure in Retry Context before making unrelated changes",
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
    const llmConfig = getRoleLlmConfig("worker")

    const fullPrompt = buildWorkerPrompt(task, testFiles)
    const callbacks: AgentLoopCallbacks = {
      onText: (text) => {
        appendLog(task.id, "worker", truncateLog(text))
        broadcast("worker:text", { taskId: task.id, text })
      },
      onToolCall: (name, args) => {
        appendLog(task.id, "worker", `[tool] ${name}`)
        broadcast("worker:tool", { taskId: task.id, tool: name })

        const json = JSON.stringify(args)
        appendLog(task.id, "worker", `[tool_input] ${truncateLog(json)}`)
        broadcast("worker:tool_input", { taskId: task.id, json })
      },
      onToolResult: (name, result) => {
        const text = `[${name}] ${truncateLog(result)}`
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
      config.WORKER_LLM_REQUEST_TIMEOUT_MS,
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
