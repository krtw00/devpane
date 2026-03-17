import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import type { Task } from "@devpane/shared"
import { buildWorkerCliArgs } from "./claude.js"
import { config } from "./config.js"
import { appendLog } from "./db.js"
import { emit } from "./events.js"
import { runAgentLoop, type AgentLoopCallbacks } from "./agent-loop.js"
import { broadcast } from "./ws.js"

export type WorkerResult = {
  exit_code: number
  result_text: string
  cost_usd: number
  num_turns: number
  duration_ms: number
}

// Track active child processes for cleanup on shutdown
const activeProcs = new Set<ChildProcess>()

export function killAllWorkers(): void {
  for (const proc of activeProcs) {
    proc.kill("SIGTERM")
  }
  activeProcs.clear()
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
  if (config.LLM_BACKEND === "openai-compatible") {
    return runWorkerApi(task, worktreePath, testFiles)
  }
  return runWorkerCli(task, worktreePath, testFiles)
}

async function runWorkerApi(task: Task, worktreePath: string, testFiles: string[] = []): Promise<WorkerResult> {
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

function runWorkerCli(task: Task, worktreePath: string, testFiles: string[] = []): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE

    const fullPrompt = buildWorkerPrompt(task, testFiles)

    const { bin, args: cliArgs } = buildWorkerCliArgs(fullPrompt)
    const proc = spawn(bin, cliArgs, {
      cwd: worktreePath,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    activeProcs.add(proc)

    let resultText = ""
    let costUsd = 0
    let numTurns = 0
    let durationMs = 0
    let lastActivity = Date.now()

    // Parse NDJSON lines from stdout
    const rl = createInterface({ input: proc.stdout })

    rl.on("line", (line) => {
      lastActivity = Date.now()
      if (!line.trim()) return

      try {
        const event = JSON.parse(line)

        if (event.type === "stream_event") {
          const inner = event.event
          // Log text deltas for progress visibility
          if (inner?.delta?.type === "text_delta" && inner.delta.text) {
            appendLog(task.id, "worker", inner.delta.text)
            broadcast("worker:text", { taskId: task.id, text: inner.delta.text })
          }
          // Log tool use starts
          if (inner?.type === "content_block_start" && inner.content_block?.type === "tool_use") {
            const name = inner.content_block.name
            appendLog(task.id, "worker", `[tool] ${name}`)
            broadcast("worker:tool", { taskId: task.id, tool: name })
          }
          // Log tool input for visibility
          if (inner?.delta?.type === "input_json_delta" && inner.delta.partial_json) {
            broadcast("worker:tool_input", { taskId: task.id, json: inner.delta.partial_json })
          }
        }

        // Codex format
        if (event.type === "message" && event.content) {
          for (const block of event.content) {
            if (block.type === "text" && block.text) {
              appendLog(task.id, "worker", block.text)
              broadcast("worker:text", { taskId: task.id, text: block.text })
              resultText = block.text
            }
          }
        }
        if (event.type === "function_call") {
          appendLog(task.id, "worker", `[tool] ${event.name}`)
          broadcast("worker:tool", { taskId: task.id, tool: event.name })
        }

        if (event.type === "result") {
          resultText = event.result ?? ""
          costUsd = event.total_cost_usd ?? 0
          numTurns = event.num_turns ?? 0
          durationMs = event.duration_ms ?? 0
        }
      } catch {
        // Non-JSON line, log as-is
        appendLog(task.id, "worker", line)
      }
    })

    const STDERR_MAX = 10_240
    let stderr = ""
    proc.stderr.on("data", (chunk: Buffer) => {
      lastActivity = Date.now()
      const text = chunk.toString()
      stderr += text
      if (stderr.length > STDERR_MAX) {
        stderr = stderr.slice(stderr.length - STDERR_MAX)
      }
      console.error(`[worker:${task.id.slice(0, 8)}:stderr] ${text.trimEnd()}`)
    })

    // Idle timeout: kill if no output for WORKER_TIMEOUT_MS
    let timedOut = false
    let sigTermAt = 0
    let sigkillCheck: ReturnType<typeof setInterval> | undefined
    const idleCheck = setInterval(() => {
      if (Date.now() - lastActivity > config.WORKER_TIMEOUT_MS) {
        timedOut = true
        appendLog(task.id, "worker", `[timeout] no activity for ${config.WORKER_TIMEOUT_MS / 1000}s, killing`)
        proc.kill("SIGTERM")
        clearInterval(idleCheck)

        // SIGKILL fallback: poll every 1s, force kill if SIGTERM ignored after 5s
        sigTermAt = Date.now()
        sigkillCheck = setInterval(() => {
          if (Date.now() - sigTermAt > 5_000) {
            clearInterval(sigkillCheck!)
            if (!proc.killed) {
              appendLog(task.id, "worker", `[timeout] SIGTERM ignored, sending SIGKILL`)
              proc.kill("SIGKILL")
            }
          }
        }, 1_000)
      }
    }, 30_000)

    proc.on("close", (code) => {
      activeProcs.delete(proc)
      clearInterval(idleCheck)
      if (sigkillCheck) clearInterval(sigkillCheck)
      rl.close()
      if (stderr) {
        appendLog(task.id, "worker", `[stderr] ${stderr}`)
      }
      if (timedOut) {
        emit({ type: "task.failed", taskId: task.id, rootCause: "timeout" })
      }
      resolve({
        exit_code: code ?? 1,
        result_text: resultText,
        cost_usd: costUsd,
        num_turns: numTurns,
        duration_ms: durationMs,
      })
    })

    proc.on("error", (err) => {
      activeProcs.delete(proc)
      clearInterval(idleCheck)
      if (sigkillCheck) clearInterval(sigkillCheck)
      rl.close()
      appendLog(task.id, "worker", `[error] ${err.message}`)
      reject(err)
    })
  })
}
