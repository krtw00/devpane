import type { PmOutput } from "@devpane/shared"
import { config } from "./config.js"
import { appendLog } from "./db.js"
import { emit } from "./events.js"
import { runAgentLoop, type AgentLoopCallbacks } from "./agent-loop.js"

export type TesterResult = {
  testFiles: string[]
  exit_code: number
  timedOut: boolean
}

export function killAllTesters(): void {
  // No-op: API mode does not spawn child processes
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

export function parseTesterOutput(stdout: string): string[] {
  const testFiles: string[] = []

  function addTestFile(filePath: string): void {
    if (filePath.endsWith(testFileSuffix()) && !testFiles.includes(filePath)) {
      testFiles.push(filePath)
    }
  }

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)

      if (event.type === "result" && event.result) {
        const matches = event.result.match(new RegExp(`[\\w/.-]+${testFileSuffix().replace(/\./g, "\\.")}`, "g"))
        if (matches) {
          for (const m of matches) {
            addTestFile(m)
          }
        }
      }
    } catch {
      // Non-JSON line, check for test file paths
      const matches = line.match(new RegExp(`[\\w/.-]+${testFileSuffix().replace(/\./g, "\\.")}`, "g"))
      if (matches) {
        for (const m of matches) {
          addTestFile(m)
        }
      }
    }
  }

  return testFiles
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === "AbortError") return true
  const message = error.message.toLowerCase()
  return message.includes("timeout") || message.includes("timed out") || message.includes("abort")
}

export async function runTester(spec: PmOutput, worktreePath: string, taskId?: string): Promise<TesterResult> {
  const testFiles: string[] = []
  const startedAt = Date.now()

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

    const callbacks: AgentLoopCallbacks = {
      onToolCall: (name, args) => {
        if (name === "write_file" && typeof args.path === "string" && !testFiles.includes(args.path)) {
          testFiles.push(args.path)
        }
      },
    }

    await runAgentLoop(
      "あなたはテストエンジニアです。仕様に基づいてテストファイルを作成してください。",
      buildTesterPrompt(spec),
      llmConfig,
      worktreePath,
      callbacks,
      undefined,
      config.TESTER_TIMEOUT_MS,
    )

    return {
      testFiles,
      exit_code: 0,
      timedOut: false,
    }
  } catch (error) {
    const timedOut = isTimeoutError(error)
    if (timedOut) {
      emit({ type: "task.failed", taskId: taskId ?? "tester", rootCause: "timeout" })
    }
    const elapsedMs = Date.now() - startedAt
    appendLog(taskId ?? "tester", "tester", `[error] ${error instanceof Error ? error.message : String(error)} (elapsed=${elapsedMs}ms)`)
    return {
      testFiles,
      exit_code: 1,
      timedOut,
    }
  }
}
