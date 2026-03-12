import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { Memory } from "@devpane/shared"
import type { PmTask } from "@devpane/shared/schemas"
import { emit } from "./events.js"
import { appendLog } from "./db.js"
import { config } from "./config.js"

export type Gate1Result = {
  verdict: "go" | "kill" | "recycle"
  reasons: string[]
}

// CLAUDE.mdからconstraintsセクションを抽出
function extractConstraints(claudeMdPath: string): string[] {
  if (!existsSync(claudeMdPath)) return []
  try {
    const content = readFileSync(claudeMdPath, "utf-8")
    const constraints: string[] = []

    // "constraints" や "制約" セクションを探す
    const constraintPattern = /^#{1,3}\s*(?:constraints|制約|禁止事項|ルール)/im
    const match = content.match(constraintPattern)
    if (!match || match.index === undefined) return []

    const section = content.slice(match.index)
    const lines = section.split("\n").slice(1) // ヘッダ行を除く

    for (const line of lines) {
      // 次のセクションヘッダで終了
      if (/^#{1,3}\s/.test(line)) break
      const trimmed = line.replace(/^[-*]\s*/, "").trim()
      if (trimmed.length > 0) constraints.push(trimmed)
    }

    return constraints
  } catch {
    return []
  }
}

// タスクの title+description からキーワードを抽出して重複チェック
function isDuplicateOfMemory(spec: PmTask, featureMemories: Memory[]): Memory | null {
  const specText = `${spec.title} ${spec.description}`.toLowerCase()

  for (const mem of featureMemories) {
    const memContent = mem.content.toLowerCase()
    // メモリ内容からファイルパスやキーワードを抽出
    const keywords = memContent
      .split(/[\s（）()、,]+/)
      .filter((w: string) => w.length >= 3)

    // キーワードの半数以上がspec内に出現 → 重複と判定
    const matchCount = keywords.filter((k: string) => specText.includes(k)).length
    if (keywords.length > 0 && matchCount >= Math.ceil(keywords.length / 2)) {
      return mem
    }
  }

  return null
}

// CLAUDE.md制約との整合性チェック
function violatesConstraint(spec: PmTask, constraints: string[]): string | null {
  const specText = `${spec.title} ${spec.description}`.toLowerCase()

  for (const constraint of constraints) {
    const lower = constraint.toLowerCase()
    // 禁止キーワードパターン: "〜しない" "〜禁止" "don't" "never" "no "
    const prohibitions = lower.match(/(?:しない|禁止|don'?t|never|(?:^|\s)no\s)\s*(.+)/i)
    if (prohibitions) {
      const forbidden = prohibitions[1].trim().toLowerCase()
      if (forbidden.length >= 3 && specText.includes(forbidden)) {
        return constraint
      }
    }
  }

  return null
}

// 仕様にfunctions/endpointsの記述があるか（空でないか）
function hasConcreteSpec(spec: PmTask): boolean {
  const desc = spec.description.toLowerCase()

  // functions/endpoints/関数/エンドポイント の記述チェック
  const hasKeywords = /(?:function|endpoint|関数|エンドポイント|api|実装)/i.test(desc)
  if (!hasKeywords) return true // これらのキーワードがなければスキップ（他の種類のタスク）

  // 「空」「未定義」「TBD」パターン検出
  if (/(?:functions|endpoints|関数|エンドポイント)\s*[:：]\s*(?:\[\s*\]|空|なし|TBD|TODO|未定)/i.test(desc)) {
    return false
  }

  return true
}

export function runGate1(spec: PmTask, memories: Memory[]): Gate1Result {
  const reasons: string[] = []
  let verdict: "go" | "kill" | "recycle" = "go"

  // Rule 1: featureメモリとの重複チェック
  const featureMemories = memories.filter(m => m.category === "feature")
  const duplicate = isDuplicateOfMemory(spec, featureMemories)
  if (duplicate) {
    verdict = "kill"
    reasons.push(`duplicate of existing feature: ${duplicate.content}`)
  }

  // Rule 2: CLAUDE.md制約との整合性
  const claudeMdPath = join(config.PROJECT_ROOT, "CLAUDE.md")
  const constraints = extractConstraints(claudeMdPath)
  const violation = violatesConstraint(spec, constraints)
  if (violation) {
    verdict = "kill"
    reasons.push(`violates constraint: ${violation}`)
  }

  // Rule 3: 仕様のfunctions/endpointsが空 → recycle
  if (!hasConcreteSpec(spec)) {
    verdict = verdict === "kill" ? "kill" : "recycle"
    reasons.push("spec has empty functions/endpoints definition")
  }

  // Emit event
  if (verdict === "go") {
    emit({ type: "gate.passed", taskId: "pre-create", gate: "gate1" })
    appendLog("scheduler", "gate1", `[pass] ${spec.title}: all checks passed`)
  } else {
    emit({ type: "gate.rejected", taskId: "pre-create", gate: "gate1", verdict, reason: reasons.join("; ") })
    appendLog("scheduler", "gate1", `[${verdict}] ${spec.title}: ${reasons.join("; ")}`)
  }

  return { verdict, reasons }
}
