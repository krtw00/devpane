import type { Task } from "@devpane/shared"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { getAllDoneTitles, getRetryCount } from "./db.js"
import { recall } from "./memory.js"
import { isDuplicate } from "./pm.js"
import { emit } from "./events.js"
import { appendLog } from "./db.js"
import { spawnClaude } from "./claude.js"
import { config } from "./config.js"

export type Gate1Result = {
  verdict: "go" | "kill" | "recycle"
  reasons: string[]
}

const GATE1_TIMEOUT_MS = 60000

// Phase 1: ルールベース（高速・無料）
export function runGate1Rules(task: Task): Gate1Result {
  const reasons: string[] = []

  // Rule 0: リトライ上限超過 → Worker実行前にkill
  const retryCount = getRetryCount(task.id)
  if (retryCount >= config.MAX_RETRIES) {
    reasons.push(`max retries exceeded (${retryCount}/${config.MAX_RETRIES})`)
    return { verdict: "kill", reasons }
  }

  if (!task.description || task.description.length < config.MIN_DESCRIPTION_LENGTH) {
    reasons.push(`description too short (${task.description?.length ?? 0} chars, min ${config.MIN_DESCRIPTION_LENGTH})`)
  }

  const doneTitles = getAllDoneTitles()
  if (isDuplicate(task.title, doneTitles)) {
    reasons.push(`duplicate of completed task`)
  }

  const features = recall("feature")
  const featureContents = features.map(m => m.content)
  if (isDuplicate(task.title, featureContents)) {
    reasons.push(`conflicts with existing feature memory`)
  }

  return { verdict: reasons.length > 0 ? "kill" : "go", reasons }
}

// Phase 2: LLM判定（意味的チェック）
function buildGate1Prompt(task: Task): string {
  const doneTitles = getAllDoneTitles()
  const features = recall("feature").map(m => m.content)
  const decisions = recall("decision").map(m => m.content)
  const lessons = recall("lesson").map(m => m.content)

  const claudeMd = (() => {
    try {
      const p = join(config.PROJECT_ROOT, "CLAUDE.md")
      return existsSync(p) ? readFileSync(p, "utf-8") : ""
    } catch { return "" }
  })()

  return [
    "あなたはGate1判定者です。以下のタスクが実装する価値があるかをYES/NOで判定してください。",
    "",
    "## 判定基準",
    "- このタスクはプロジェクトの改善に実際に貢献するか？",
    "- 既に実装済みの機能と実質的に同じではないか？（タイトルが違っても機能が同じなら重複）",
    "- タスクの説明はWorkerが単独で実装できる具体性があるか？",
    "- プロジェクトの方針（CLAUDE.md）に沿っているか？",
    "",
    "## タスク",
    `タイトル: ${task.title}`,
    `説明: ${task.description}`,
    "",
    "## 完了済みタスク",
    doneTitles.length > 0 ? doneTitles.map(t => `- ${t}`).join("\n") : "（なし）",
    "",
    "## 実装済み機能（memory）",
    features.length > 0 ? features.map(f => `- ${f}`).join("\n") : "（なし）",
    "",
    "## アーキテクチャ判断",
    decisions.length > 0 ? decisions.map(d => `- ${d}`).join("\n") : "（なし）",
    "",
    "## 過去の教訓",
    lessons.length > 0 ? lessons.map(l => `- ${l}`).join("\n") : "（なし）",
    "",
    claudeMd ? `## CLAUDE.md\n${claudeMd}\n` : "",
    '以下のJSON形式のみで回答せよ（説明文は不要）:',
    '{"verdict": "go" | "kill", "reason": "判定理由（1文）"}',
  ].join("\n")
}

async function runGate1Llm(task: Task): Promise<Gate1Result> {
  const prompt = buildGate1Prompt(task)
  const args = ["-p", prompt, "--output-format", "json"]

  try {
    const stdout = await spawnClaude(args, config.PROJECT_ROOT, GATE1_TIMEOUT_MS)

    // Parse claude CLI output
    let text: string
    try {
      const json = JSON.parse(stdout)
      text = json.result ?? stdout
    } catch {
      text = stdout
    }

    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      console.error(`[gate1] LLM output not parseable, recycling task`)
      emit({ type: "gate.llm_fallback", taskId: task.id, gate: "gate1", error: "LLM output not parseable" })
      return { verdict: "recycle", reasons: ["LLM output not parseable"] }
    }

    const parsed = JSON.parse(match[0])
    if (parsed.verdict === "kill") {
      return { verdict: "kill", reasons: [parsed.reason ?? "LLM rejected"] }
    }
    return { verdict: "go", reasons: [] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[gate1] LLM check failed, recycling task: ${msg}`)
    emit({ type: "gate.llm_fallback", taskId: task.id, gate: "gate1", error: msg })
    return { verdict: "recycle", reasons: [`LLM check failed: ${msg}`] }
  }
}

// 統合Gate1: ルール → LLM の2段階
export async function runGate1(task: Task): Promise<Gate1Result> {
  // Phase 1: ルールベース
  const ruleResult = runGate1Rules(task)
  if (ruleResult.verdict === "kill") {
    appendLog(task.id, "gate1", `[kill:rule] ${ruleResult.reasons.join("; ")}`)
    return ruleResult
  }

  // Phase 2: LLM判定
  console.log(`[gate1] running LLM check for task ${task.id}: ${task.title}`)
  const llmResult = await runGate1Llm(task)

  if (llmResult.verdict === "kill") {
    appendLog(task.id, "gate1", `[kill:llm] ${llmResult.reasons.join("; ")}`)
    return llmResult
  }

  if (llmResult.verdict === "recycle") {
    appendLog(task.id, "gate1", `[recycle:llm] ${llmResult.reasons.join("; ")}`)
    return llmResult
  }

  appendLog(task.id, "gate1", "[pass] rule + LLM checks passed")
  return { verdict: "go", reasons: [] }
}
