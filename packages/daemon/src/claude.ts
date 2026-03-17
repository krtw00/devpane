import { spawn, type ChildProcess } from "node:child_process"
import { config } from "./config.js"

const activeProcs = new Set<ChildProcess>()

export function killAllClaude(): void {
  for (const proc of activeProcs) {
    proc.kill("SIGTERM")
  }
  activeProcs.clear()
}

export function translateArgs(claudeArgs: string[]): { bin: string; args: string[] } {
  if (config.CLI_BACKEND === "claude") {
    return { bin: "claude", args: claudeArgs }
  }

  const args: string[] = ["exec"]
  let i = 0
  while (i < claudeArgs.length) {
    const arg = claudeArgs[i]
    if (arg === "-p") {
      args.push(claudeArgs[++i])
    } else if (arg === "--allowedTools") {
      const tools = claudeArgs[++i]
      if (tools.includes("Bash")) {
        args.push("--full-auto")
      } else if (tools.includes("Write") || tools.includes("Edit")) {
        args.push("-s", "workspace-write")
      } else {
        args.push("-s", "read-only")
      }
    } else if (arg === "--output-format") {
      const fmt = claudeArgs[++i]
      args.push("--json")
      if (fmt === "json") {
        args.push("-o", "/dev/stdout")
      }
    } else if (arg === "--permission-mode" || arg === "--max-turns") {
      i++ // skip value
    } else if (arg === "--no-session-persistence" || arg === "--verbose") {
      // skip flag (no value)
    } else {
      args.push(arg)
    }
    i++
  }
  return { bin: "codex", args }
}

export function buildWorkerCliArgs(prompt: string): { bin: string; args: string[] } {
  if (config.CLI_BACKEND === "codex") {
    return { bin: "codex", args: ["exec", prompt, "--json", "--full-auto"] }
  }
  return {
    bin: "claude",
    args: [
      "-p", prompt,
      "--output-format", "stream-json",
      "--verbose",
      "--max-turns", "30",
      "--allowedTools", "Read,Edit,Write,Bash,Glob,Grep",
      "--permission-mode", "bypassPermissions",
      "--no-session-persistence",
    ],
  }
}

export function buildTesterCliArgs(prompt: string): { bin: string; args: string[] } {
  if (config.CLI_BACKEND === "codex") {
    return { bin: "codex", args: ["exec", prompt, "--json", "-s", "workspace-write"] }
  }
  return {
    bin: "claude",
    args: [
      "-p", prompt,
      "--output-format", "stream-json",
      "--verbose",
      "--max-turns", "30",
      "--allowedTools", "Read,Edit,Write,Glob,Grep",
      "--permission-mode", "bypassPermissions",
      "--no-session-persistence",
    ],
  }
}

export function spawnClaude(args: string[], cwd: string, timeoutMs?: number): Promise<string> {
  const p = new Promise<string>((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE

    const { bin, args: cliArgs } = translateArgs(args)
    const proc = spawn(bin, cliArgs, { cwd, env, stdio: ["pipe", "pipe", "pipe"] })
    activeProcs.add(proc)

    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

    let timedOut = false
    let sigkillTimer: ReturnType<typeof setTimeout> | undefined
    const timeout = setTimeout(() => {
      timedOut = true
      proc.kill("SIGTERM")
      sigkillTimer = setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL")
        }
      }, 5_000)
    }, timeoutMs ?? config.PM_TIMEOUT_MS)

    proc.on("close", (code, signal) => {
      activeProcs.delete(proc)
      clearTimeout(timeout)
      if (sigkillTimer) clearTimeout(sigkillTimer)
      proc.stdout.removeAllListeners("data")
      proc.stderr.removeAllListeners("data")
      let chunk
      while (null !== (chunk = proc.stdout.read())) { stdout += chunk.toString() }
      while (null !== (chunk = proc.stderr.read())) { stderr += chunk.toString() }
      if (timedOut) {
        reject(new Error(`${config.CLI_BACKEND} killed by timeout after ${timeoutMs ?? config.PM_TIMEOUT_MS}ms. stderr: ${stderr.slice(0, 500)}`))
      } else if (signal) {
        reject(new Error(`${config.CLI_BACKEND} killed by signal ${signal}. stderr: ${stderr.slice(0, 500)}`))
      } else if (code !== 0) {
        const detail = stderr || stdout
        reject(new Error(`${config.CLI_BACKEND} exited ${code}: ${detail.slice(0, 1000)}`))
      } else {
        resolve(stdout)
      }
    })
    proc.on("error", (err) => {
      activeProcs.delete(proc)
      clearTimeout(timeout)
      if (sigkillTimer) clearTimeout(sigkillTimer)
      reject(err)
    })

    proc.stdin.end()
  })
  p.catch(() => {})
  return p
}
