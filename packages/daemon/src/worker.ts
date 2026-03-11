import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import type { Task } from "@devpane/shared"
import { config } from "./config.js"
import { appendLog } from "./db.js"

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

export function runWorker(task: Task, worktreePath: string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE

    const proc = spawn("claude", [
      "-p", task.description,
      "--output-format", "stream-json",
      "--verbose",
      "--max-turns", "30",
      "--allowedTools", "Read,Edit,Write,Bash,Glob,Grep",
      "--permission-mode", "bypassPermissions",
      "--no-session-persistence",
    ], {
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
          }
          // Log tool use starts
          if (inner?.type === "content_block_start" && inner.content_block?.type === "tool_use") {
            const name = inner.content_block.name
            appendLog(task.id, "worker", `[tool] ${name}`)
          }
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

    let stderr = ""
    proc.stderr.on("data", (chunk: Buffer) => {
      lastActivity = Date.now()
      const text = chunk.toString()
      stderr += text
      console.error(`[worker:${task.id.slice(0, 8)}:stderr] ${text.trimEnd()}`)
    })

    // Idle timeout: kill if no output for WORKER_TIMEOUT_MS
    const idleCheck = setInterval(() => {
      if (Date.now() - lastActivity > config.WORKER_TIMEOUT_MS) {
        appendLog(task.id, "worker", `[timeout] no activity for ${config.WORKER_TIMEOUT_MS / 1000}s, killing`)
        proc.kill("SIGTERM")
        clearInterval(idleCheck)
      }
    }, 30_000)

    proc.on("close", (code) => {
      activeProcs.delete(proc)
      clearInterval(idleCheck)
      rl.close()
      if (stderr) {
        appendLog(task.id, "worker", `[stderr] ${stderr}`)
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
      clearInterval(idleCheck)
      rl.close()
      appendLog(task.id, "worker", `[error] ${err.message}`)
      reject(err)
    })
  })
}
