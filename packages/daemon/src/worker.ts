import { spawn } from "node:child_process"
import type { Task } from "@devpane/shared"
import { config } from "./config.js"
import { appendLog } from "./db.js"

export type WorkerResult = {
  exit_code: number
  stdout: string
}

export function runWorker(task: Task, worktreePath: string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE // allow nested claude invocation

    const proc = spawn("claude", [
      "-p", task.description,
      "--allowedTools", "Read,Edit,Write,Bash,Glob,Grep",
      "--permission-mode", "bypassPermissions",
      "--output-format", "json",
    ], {
      cwd: worktreePath,
      timeout: config.WORKER_TIMEOUT_MS,
      env,
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      appendLog(task.id, "worker", text)
    })

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on("close", (code) => {
      if (stderr) {
        appendLog(task.id, "worker", `[stderr] ${stderr}`)
      }
      resolve({ exit_code: code ?? 1, stdout })
    })

    proc.on("error", (err) => {
      appendLog(task.id, "worker", `[error] ${err.message}`)
      reject(err)
    })
  })
}
