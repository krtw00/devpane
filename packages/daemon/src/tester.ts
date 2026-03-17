import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import type { PmOutput } from "@devpane/shared"
import { buildTesterCliArgs } from "./claude.js"
import { config } from "./config.js"
import { appendLog } from "./db.js"
import { emit } from "./events.js"

export type TesterResult = {
  testFiles: string[]
  exit_code: number
  timedOut: boolean
}

const activeProcs = new Set<ChildProcess>()

export function killAllTesters(): void {
  for (const proc of activeProcs) {
    proc.kill("SIGTERM")
  }
  activeProcs.clear()
}

export function buildTesterPrompt(spec: PmOutput): string {
  const taskDescriptions = spec.tasks
    .map((t, i) => {
      const lines = [`### Task ${i + 1}: ${t.title}\n${t.description}`]
      if (t.constraints && t.constraints.length > 0) {
        lines.push(`\n**Constraints:**\n${t.constraints.map(c => `- ${c}`).join("\n")}`)
      }
      return lines.join("")
    })
    .join("\n\n")

  return [
    "Generate test code based on the following structured specification.",
    "",
    "## Specification",
    taskDescriptions,
    "",
    `## Design Intent\n${spec.reasoning}`,
    "",
    "## Test Generation Rules",
    "- Derive test cases from each task's title/description that the implementation must satisfy",
    `- Place test files in the \`${config.TEST_DIR}/\` directory`,
    `- Use ${config.TEST_FRAMEWORK} as the test framework`,
    "- Tests are written before implementation (TDD approach), so they may fail at this point",
    `- Name test files as \`${config.TEST_FILE_PATTERN}\``,
    "- Do NOT break existing test files",
    "",
    "## Quality Requirements (mandatory)",
    `- \`${config.BUILD_CMD}\` must pass (no type errors)`,
    "- No lint warnings (unused imports, unused variables, etc.)",
    "- New files must follow the existing code style",
  ].join("\n")
}

function testFileSuffix(): string {
  // "*.test.ts" → ".test.ts"
  return config.TEST_FILE_PATTERN.replace(/^\*/, "")
}

function addTestFile(testFiles: string[], filePath: string): void {
  if (filePath.endsWith(testFileSuffix()) && !testFiles.includes(filePath)) {
    testFiles.push(filePath)
  }
}

function extractFilePathFromJson(json: string): string | null {
  const match = json.match(/"file_path"\s*:\s*"([^"]+)"/)
  return match ? match[1] : null
}

export function parseTesterOutput(stdout: string): string[] {
  const testFiles: string[] = []
  let trackingToolUse = false
  let jsonBuffer = ""

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)

      if (event.type === "stream_event") {
        const inner = event.event
        if (
          inner?.type === "content_block_start" &&
          inner.content_block?.type === "tool_use" &&
          (inner.content_block.name === "Write" || inner.content_block.name === "Edit")
        ) {
          trackingToolUse = true
          jsonBuffer = ""
        } else if (
          inner?.type === "content_block_start" &&
          inner.content_block?.type === "tool_use"
        ) {
          trackingToolUse = false
          jsonBuffer = ""
        }

        if (
          trackingToolUse &&
          inner?.type === "content_block_delta" &&
          inner.delta?.type === "input_json_delta"
        ) {
          jsonBuffer += inner.delta.partial_json
        }

        if (inner?.type === "content_block_stop" && trackingToolUse) {
          const filePath = extractFilePathFromJson(jsonBuffer)
          if (filePath) addTestFile(testFiles, filePath)
          trackingToolUse = false
          jsonBuffer = ""
        }
      }

      // Capture from result text
      if (event.type === "result" && event.result) {
        const matches = event.result.match(new RegExp(`[\\w/.-]+${testFileSuffix().replace(/\./g, "\\.")}`, "g"))
        if (matches) {
          for (const m of matches) {
            addTestFile(testFiles, m)
          }
        }
      }
    } catch {
      // Non-JSON line, check for test file paths
      const matches = line.match(new RegExp(`[\\w/.-]+${testFileSuffix().replace(/\./g, "\\.")}`, "g"))
      if (matches) {
        for (const m of matches) {
          addTestFile(testFiles, m)
        }
      }
    }
  }

  return testFiles
}

export function runTester(spec: PmOutput, worktreePath: string, taskId?: string): Promise<TesterResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE

    const prompt = buildTesterPrompt(spec)

    const { bin, args: cliArgs } = buildTesterCliArgs(prompt)
    const proc = spawn(bin, cliArgs, {
      cwd: worktreePath,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    activeProcs.add(proc)

    const testFiles: string[] = []
    let lastActivity = Date.now()
    let trackingToolUse = false
    let jsonBuffer = ""

    const rl = createInterface({ input: proc.stdout })

    rl.on("line", (line) => {
      lastActivity = Date.now()
      if (!line.trim()) return

      try {
        const event = JSON.parse(line)

        if (event.type === "stream_event") {
          const inner = event.event
          if (
            inner?.type === "content_block_start" &&
            inner.content_block?.type === "tool_use" &&
            (inner.content_block.name === "Write" || inner.content_block.name === "Edit")
          ) {
            trackingToolUse = true
            jsonBuffer = ""
          } else if (
            inner?.type === "content_block_start" &&
            inner.content_block?.type === "tool_use"
          ) {
            trackingToolUse = false
            jsonBuffer = ""
          }

          if (
            trackingToolUse &&
            inner?.type === "content_block_delta" &&
            inner.delta?.type === "input_json_delta"
          ) {
            jsonBuffer += inner.delta.partial_json
          }

          if (inner?.type === "content_block_stop" && trackingToolUse) {
            const filePath = extractFilePathFromJson(jsonBuffer)
            if (filePath) addTestFile(testFiles, filePath)
            trackingToolUse = false
            jsonBuffer = ""
          }
        }

        // Codex format: detect test files from function_call events
        if (event.type === "function_call" && (event.name === "write" || event.name === "edit")) {
          try {
            const fnArgs = typeof event.arguments === "string" ? JSON.parse(event.arguments) : event.arguments
            const filePath = fnArgs?.file_path ?? fnArgs?.path
            if (filePath) addTestFile(testFiles, filePath)
          } catch { /* ignore parse errors */ }
        }
        if (event.type === "message" && event.content) {
          for (const block of event.content) {
            if (block.type === "text" && block.text) {
              const matches = block.text.match(new RegExp(`[\\w/.-]+${testFileSuffix().replace(/\./g, "\\.")}`, "g"))
              if (matches) {
                for (const m of matches) {
                  addTestFile(testFiles, m)
                }
              }
            }
          }
        }

        if (event.type === "result" && event.result) {
          const matches = event.result.match(new RegExp(`[\\w/.-]+${testFileSuffix().replace(/\./g, "\\.")}`, "g"))
          if (matches) {
            for (const m of matches) {
              addTestFile(testFiles, m)
            }
          }
        }
      } catch {
        // Non-JSON line
      }
    })

    const STDERR_MAX = 10_240
    let stderr = ""
    proc.stderr.on("data", (chunk: Buffer) => {
      lastActivity = Date.now()
      const text = chunk.toString()
      if (stderr.length + text.length <= STDERR_MAX) {
        stderr += text
      } else if (text.length >= STDERR_MAX) {
        stderr = text.slice(-STDERR_MAX)
      } else {
        stderr = text
      }
    })

    let timedOut = false
    let sigkillCheck: ReturnType<typeof setInterval> | undefined
    const idleCheck = setInterval(() => {
      if (Date.now() - lastActivity > config.TESTER_TIMEOUT_MS) {
        timedOut = true
        appendLog(taskId ?? "tester", "tester", `[timeout] no activity for ${config.TESTER_TIMEOUT_MS / 1000}s, killing`)
        proc.kill("SIGTERM")
        clearInterval(idleCheck)

        const sigTermAt = Date.now()
        sigkillCheck = setInterval(() => {
          if (Date.now() - sigTermAt > 5_000) {
            clearInterval(sigkillCheck!)
            if (!proc.killed) {
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
        appendLog(taskId ?? "tester", "tester", `[stderr] ${stderr}`)
      }
      if (timedOut) {
        emit({ type: "task.failed", taskId: taskId ?? "tester", rootCause: "timeout" })
      }
      resolve({
        testFiles,
        exit_code: code ?? 1,
        timedOut,
      })
    })

    proc.on("error", (err) => {
      activeProcs.delete(proc)
      clearInterval(idleCheck)
      if (sigkillCheck) clearInterval(sigkillCheck)
      rl.close()
      reject(err)
    })
  })
}
