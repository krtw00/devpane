import { spawn, type ChildProcess } from "node:child_process"
import type { Task, TesterSpec, TesterOutput } from "@devpane/shared"
import { TesterOutputSchema, TesterSpecSchema } from "@devpane/shared/schemas"
import { config } from "./config.js"
import { appendLog } from "./db.js"

const activeProcs = new Set<ChildProcess>()

export function killAllTesters(): void {
  for (const proc of activeProcs) {
    proc.kill("SIGTERM")
  }
  activeProcs.clear()
}

function spawnClaude(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE

    const proc = spawn("claude", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    activeProcs.add(proc)

    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM")
    }, config.PM_TIMEOUT_MS)

    proc.on("close", (code, signal) => {
      activeProcs.delete(proc)
      clearTimeout(timeout)
      if (signal) {
        reject(new Error(`claude killed by signal ${signal} (timeout?). stderr: ${stderr.slice(0, 500)}`))
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
  })
}

function buildTesterPrompt(spec: TesterSpec): string {
  const lines: string[] = [
    "## タスク",
    "以下の構造化仕様に基づいて、Vitestのテストファイルを生成せよ。",
    "",
    "## 構造化仕様",
    "",
  ]

  for (const fn of spec.functions) {
    lines.push(`### ${fn.file} — \`${fn.name}\``)
    lines.push("")
    lines.push("不変条件（invariants）:")
    for (const inv of fn.invariants) {
      lines.push(`- ${inv}`)
    }
    lines.push("")
  }

  lines.push(
    "## 生成ルール",
    "- 各invariantに対して1つ以上のテストケースを生成する",
    "- テストファイルはソースファイルと同じディレクトリの `__tests__/` に配置する",
    "  - 例: `src/foo.ts` → `src/__tests__/foo.test.ts`",
    "- `import { describe, it, expect } from \"vitest\"` を使用する",
    "- テスト対象の関数を相対パスでimportする",
    "- テストは独立して実行可能であること",
    "- モックは最小限にし、実際の関数の振る舞いをテストする",
    "",
    "## 出力形式",
    "テストファイルを書き終えたら、以下のJSON形式のみで最終回答せよ:",
    '{"testFiles": ["src/__tests__/foo.test.ts"], "testCount": 5}',
    "",
    "testFiles: 生成したテストファイルの相対パス一覧",
    "testCount: 生成したテストケース（it()）の合計数",
  )

  return lines.join("\n")
}

export function parseTesterOutput(stdout: string): TesterOutput {
  let text: string
  try {
    const json = JSON.parse(stdout)
    text = json.result ?? stdout
  } catch {
    text = stdout
  }

  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`Tester output does not contain valid JSON: ${text.slice(0, 200)}`)

  const parsed = JSON.parse(match[0])
  const result = TesterOutputSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`Tester output validation failed: ${issues}`)
  }

  return result.data as TesterOutput
}

export async function runTester(task: Task, spec: TesterSpec, worktreePath: string): Promise<TesterOutput> {
  const prompt = buildTesterPrompt(spec)
  const args = [
    "-p", prompt,
    "--allowedTools", "Read,Edit,Write,Glob,Grep",
    "--output-format", "json",
    "--permission-mode", "bypassPermissions",
    "--no-session-persistence",
  ]

  console.log(`[tester] generating tests for task ${task.id} (${spec.functions.length} functions, prompt: ${prompt.length} chars)`)
  appendLog(task.id, "tester", `[start] generating tests for ${spec.functions.length} functions`)

  const stdout = await spawnClaude(args, worktreePath)
  const output = parseTesterOutput(stdout)

  console.log(`[tester] generated ${output.testCount} tests in ${output.testFiles.length} files`)
  appendLog(task.id, "tester", `[done] ${output.testCount} tests in ${output.testFiles.length} files: ${output.testFiles.join(", ")}`)

  return output
}

export function extractTesterSpec(description: string): TesterSpec | null {
  const match = description.match(/```json\s*\n([\s\S]*?)\n\s*```/)
  const jsonStr = match ? match[1] : description

  try {
    const parsed = JSON.parse(jsonStr)
    if (parsed.functions && Array.isArray(parsed.functions)) {
      const result = TesterSpecSchema.safeParse(parsed)
      if (result.success) return result.data as TesterSpec
    }
  } catch {
    // not a structured spec
  }

  return null
}
