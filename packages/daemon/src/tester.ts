import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import type { PmOutput } from "@devpane/shared"
import { config } from "./config.js"

export type TesterResult = {
  testFiles: string[]
  exit_code: number
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
      const lines = [`### タスク${i + 1}: ${t.title}\n${t.description}`]
      if (t.constraints && t.constraints.length > 0) {
        lines.push(`\n**制約条件:**\n${t.constraints.map(c => `- ${c}`).join("\n")}`)
      }
      return lines.join("")
    })
    .join("\n\n")

  return [
    "以下の構造化仕様に基づき、テストコードを生成せよ。",
    "",
    "## 仕様",
    taskDescriptions,
    "",
    `## 設計意図\n${spec.reasoning}`,
    "",
    "## テスト生成ルール",
    "- 各タスクのtitle/descriptionから、実装が満たすべきテストケースを導出せよ",
    "- テストファイルは `src/__tests__/` ディレクトリに配置すること",
    "- テストフレームワークは vitest を使用",
    "- テストは実装前に書く（TDD的アプローチ）ため、現時点で失敗しても構わない",
    "- ファイル名は `*.test.ts` とすること",
    "- 既存のテストファイルを壊さないこと",
    "",
    "## 品質要件（必須）",
    "- `pnpm build` が通ること（型エラーなし）",
    "- lint警告を残さないこと（未使用import、未使用変数など）",
    "- 新規ファイルは既存コードのスタイルに従うこと",
  ].join("\n")
}

export function parseTesterOutput(stdout: string): string[] {
  const testFiles: string[] = []

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)

      // Track file writes to *.test.ts files
      if (event.type === "stream_event") {
        const inner = event.event
        if (
          inner?.type === "content_block_start" &&
          inner.content_block?.type === "tool_use" &&
          (inner.content_block.name === "Write" || inner.content_block.name === "Edit")
        ) {
          // File path will be in subsequent input_json_delta events
        }
      }

      // Capture from result text
      if (event.type === "result" && event.result) {
        const matches = event.result.match(/[\w/.-]+\.test\.ts/g)
        if (matches) {
          for (const m of matches) {
            if (!testFiles.includes(m)) testFiles.push(m)
          }
        }
      }
    } catch {
      // Non-JSON line, check for test file paths
      const matches = line.match(/[\w/.-]+\.test\.ts/g)
      if (matches) {
        for (const m of matches) {
          if (!testFiles.includes(m)) testFiles.push(m)
        }
      }
    }
  }

  return testFiles
}

export function runTester(spec: PmOutput, worktreePath: string): Promise<TesterResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE

    const prompt = buildTesterPrompt(spec)

    const proc = spawn("claude", [
      "-p", prompt,
      "--output-format", "stream-json",
      "--verbose",
      "--max-turns", "30",
      "--allowedTools", "Read,Edit,Write,Glob,Grep",
      "--permission-mode", "bypassPermissions",
      "--no-session-persistence",
    ], {
      cwd: worktreePath,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    activeProcs.add(proc)

    const testFiles: string[] = []
    let lastActivity = Date.now()

    const rl = createInterface({ input: proc.stdout })

    rl.on("line", (line) => {
      lastActivity = Date.now()
      if (!line.trim()) return

      try {
        const event = JSON.parse(line)

        if (event.type === "result" && event.result) {
          const matches = event.result.match(/[\w/.-]+\.test\.ts/g)
          if (matches) {
            for (const m of matches) {
              if (!testFiles.includes(m)) testFiles.push(m)
            }
          }
        }
      } catch {
        // Non-JSON line
      }
    })

    proc.stderr.on("data", () => {
      lastActivity = Date.now()
    })

    const idleCheck = setInterval(() => {
      if (Date.now() - lastActivity > config.WORKER_TIMEOUT_MS) {
        proc.kill("SIGTERM")
        clearInterval(idleCheck)
      }
    }, 30_000)

    proc.on("close", (code) => {
      activeProcs.delete(proc)
      clearInterval(idleCheck)
      rl.close()
      resolve({
        testFiles,
        exit_code: code ?? 1,
      })
    })

    proc.on("error", (err) => {
      activeProcs.delete(proc)
      clearInterval(idleCheck)
      rl.close()
      reject(err)
    })
  })
}
