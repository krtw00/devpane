import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { Gate2Verdict } from "@devpane/shared/schemas"
import { emit } from "./events.js"
import { appendLog } from "./db.js"

// Gate 2: 仕様-テスト照合（テスター完了後、Worker実行前）
// 原理1: 判定はコード（ルールベース）。LLMには委託しない。

export type Gate2Check = {
  type: "invariant" | "endpoint" | "constraint"
  spec_item: string
  covered: boolean
}

export type Gate2Result = {
  verdict: Gate2Verdict
  reasons: string[]
  checks: Gate2Check[]
}

// --- 仕様テキストからチェック項目を抽出 ---

const INVARIANT_PATTERNS = [
  /(?:invariant|不変条件|必ず|always|never|must not)\s*[:：]?\s*(.+)/gi,
  /^[-*]\s*(?:invariant|不変条件)\s*[:：]\s*(.+)/gim,
]

const ENDPOINT_PATTERN = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s,)]+)/gi

const CONSTRAINT_PATTERNS = [
  /(?:constraint|制約|validation|バリデーション|must|shall)\s*[:：]?\s*(.+)/gi,
  /^[-*]\s*(?:constraint|制約)\s*[:：]\s*(.+)/gim,
]

export function extractSpecItems(description: string): Gate2Check[] {
  const checks: Gate2Check[] = []
  const seen = new Set<string>()

  function add(type: Gate2Check["type"], item: string): void {
    const key = `${type}:${item}`
    if (seen.has(key)) return
    seen.add(key)
    checks.push({ type, spec_item: item, covered: false })
  }

  // Invariants
  for (const pattern of INVARIANT_PATTERNS) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(description)) !== null) {
      const item = m[1].trim()
      if (item.length > 0) add("invariant", item)
    }
  }

  // Endpoints
  ENDPOINT_PATTERN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ENDPOINT_PATTERN.exec(description)) !== null) {
    add("endpoint", `${m[1].toUpperCase()} ${m[2]}`)
  }

  // Constraints
  for (const pattern of CONSTRAINT_PATTERNS) {
    pattern.lastIndex = 0
    let cm: RegExpExecArray | null
    while ((cm = pattern.exec(description)) !== null) {
      const item = cm[1].trim()
      if (item.length > 0) add("constraint", item)
    }
  }

  return checks
}

// --- テストファイルの収集 ---

function collectTestFiles(worktreePath: string): { path: string; content: string }[] {
  const results: { path: string; content: string }[] = []

  function walk(dir: string): void {
    let names: string[]
    try {
      names = readdirSync(dir, "utf-8")
    } catch {
      return
    }
    for (const name of names) {
      if (name === "node_modules" || name === ".git" || name === "dist") continue
      const fullPath = join(dir, name)
      try {
        const st = statSync(fullPath)
        if (st.isDirectory()) {
          walk(fullPath)
        } else if (st.isFile() && /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(name)) {
          const content = readFileSync(fullPath, "utf-8")
          results.push({ path: relative(worktreePath, fullPath), content })
        }
      } catch {
        // skip inaccessible entries
      }
    }
  }

  walk(worktreePath)
  return results
}

// --- キーワードマッチング ---

function extractKeywords(specItem: string): string[] {
  return specItem
    .replace(/[^\w\s/\-_.:]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.toLowerCase())
}

function isEndpointCovered(endpoint: string, testContent: string): boolean {
  const lower = testContent.toLowerCase()
  const [method, path] = endpoint.split(" ", 2)
  // Check for method + path reference in test
  if (lower.includes(path.toLowerCase())) {
    if (lower.includes(method.toLowerCase()) || lower.includes(`"${path.toLowerCase()}"`) || lower.includes(`'${path.toLowerCase()}'`)) {
      return true
    }
  }
  // Check for path segments
  const segments = path.split("/").filter(Boolean)
  const lastSegment = segments[segments.length - 1]
  if (lastSegment && lower.includes(lastSegment.toLowerCase()) && lower.includes(method.toLowerCase())) {
    return true
  }
  return false
}

function isItemCovered(item: string, testContents: string[]): boolean {
  const keywords = extractKeywords(item)
  if (keywords.length === 0) return true // no meaningful keywords to check

  const threshold = Math.max(1, Math.ceil(keywords.length * 0.5))

  for (const content of testContents) {
    const lower = content.toLowerCase()
    const matched = keywords.filter((kw) => lower.includes(kw))
    if (matched.length >= threshold) return true
  }
  return false
}

// --- Gate 2 実行 ---

export function runGate2(taskId: string, description: string, worktreePath: string): Gate2Result {
  const checks = extractSpecItems(description)
  const testFiles = collectTestFiles(worktreePath)
  const testContents = testFiles.map((f) => f.content)
  const reasons: string[] = []

  // テストファイルが1つもない場合
  if (testFiles.length === 0 && checks.length > 0) {
    reasons.push("no test files found in worktree")
    for (const check of checks) {
      check.covered = false
    }

    emit({ type: "gate.rejected", taskId, gate: "gate2", verdict: "recycle", reason: reasons.join("; ") })
    appendLog(taskId, "gate2", `[recycle] ${reasons.join("; ")}`)

    return { verdict: "recycle", reasons, checks }
  }

  // 仕様にチェック項目がない場合はパス
  if (checks.length === 0) {
    emit({ type: "gate.passed", taskId, gate: "gate2" })
    appendLog(taskId, "gate2", "[pass] no spec items to verify")
    return { verdict: "go", reasons: [], checks: [] }
  }

  // 各チェック項目の照合
  for (const check of checks) {
    if (check.type === "endpoint") {
      check.covered = isEndpointCovered(check.spec_item, testContents.join("\n"))
    } else {
      check.covered = isItemCovered(check.spec_item, testContents)
    }

    if (!check.covered) {
      reasons.push(`uncovered ${check.type}: ${check.spec_item}`)
    }
  }

  const verdict: Gate2Verdict = reasons.length > 0 ? "recycle" : "go"

  if (verdict === "go") {
    emit({ type: "gate.passed", taskId, gate: "gate2" })
    appendLog(taskId, "gate2", `[pass] all ${checks.length} spec items covered by tests`)
  } else {
    emit({ type: "gate.rejected", taskId, gate: "gate2", verdict: "recycle", reason: reasons.join("; ") })
    appendLog(taskId, "gate2", `[recycle] ${reasons.join("; ")}`)
  }

  return { verdict, reasons, checks }
}
