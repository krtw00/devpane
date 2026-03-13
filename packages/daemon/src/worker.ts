import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import type { Task } from "@devpane/shared"
import { config } from "./config.js"
import { appendLog } from "./db.js"
import { emit } from "./events.js"
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

export function runWorker(task: Task, worktreePath: string, testFiles: string[] = []): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE

    const promptParts = [task.description]

    if (testFiles.length > 0) {
      promptParts.push(
        "",
        "## テスト先行実装",
        "以下のテストファイルが既にworktree内に存在する。これらのテストを通す実装を書け。",
        "テストの意図を読み取り、仕様通りの実装を行うこと。テストを削除・改変してはならない。",
        ...testFiles.map(f => `- ${f}`),
      )
    }

    promptParts.push(
      "",
      "## 品質要件（必須）",
      "- 実装後に `pnpm build` が通ること（型エラーなし）",
      "- `pnpm test` が通ること（既存テストを壊さない）",
      "- lint警告を残さないこと（未使用import、未使用変数など）",
      "- 新規ファイルは既存コードのスタイルに従うこと",
    )

    const fullPrompt = promptParts.join("\n")

    const proc = spawn("claude", [
      "-p", fullPrompt,
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
      clearInterval(idleCheck)
      rl.close()
      appendLog(task.id, "worker", `[error] ${err.message}`)
      reject(err)
    })
  })
}
