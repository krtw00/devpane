import { spawn, type ChildProcess } from "node:child_process"
import { config } from "./config.js"

const activeProcs = new Set<ChildProcess>()

export function killAllClaude(): void {
  for (const proc of activeProcs) {
    proc.kill("SIGTERM")
  }
  activeProcs.clear()
}

export function spawnClaude(args: string[], cwd: string, timeoutMs?: number): Promise<string> {
  const p = new Promise<string>((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE

    const proc = spawn("claude", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] })
    activeProcs.add(proc)

    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      proc.kill("SIGTERM")
    }, timeoutMs ?? config.PM_TIMEOUT_MS)

    proc.on("close", (code, signal) => {
      activeProcs.delete(proc)
      clearTimeout(timeout)
      proc.stdout.removeAllListeners("data")
      proc.stderr.removeAllListeners("data")
      let chunk
      while (null !== (chunk = proc.stdout.read())) { stdout += chunk.toString() }
      while (null !== (chunk = proc.stderr.read())) { stderr += chunk.toString() }
      if (timedOut) {
        reject(new Error(`claude killed by timeout after ${timeoutMs ?? config.PM_TIMEOUT_MS}ms. stderr: ${stderr.slice(0, 500)}`))
      } else if (signal) {
        reject(new Error(`claude killed by signal ${signal}. stderr: ${stderr.slice(0, 500)}`))
      } else if (code !== 0) {
        const detail = stderr || stdout
        reject(new Error(`claude exited ${code}: ${detail.slice(0, 1000)}`))
      } else {
        resolve(stdout)
      }
    })
    proc.on("error", (err) => {
      activeProcs.delete(proc)
      clearTimeout(timeout)
      reject(err)
    })

    proc.stdin.end()
  })
  p.catch(() => {})
  return p
}
