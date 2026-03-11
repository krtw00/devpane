import { readFileSync } from "node:fs"
import type { Gate2Output } from "@devpane/shared/schemas"
import { Gate2OutputSchema } from "@devpane/shared/schemas"
import { emit } from "./events.js"
import { appendLog } from "./db.js"

// Gate 2: 構造化仕様とテストファイルのカバレッジ照合
// 原理: 判定はコード（文字列マッチ）。LLMには委託しない。

export type StructuredSpec = {
  invariants: string[]
  endpoints: { method: string; path: string }[]
  constraints: string[]
}

export function runGate2(
  taskId: string,
  spec: StructuredSpec,
  testFilePaths: string[],
): Gate2Output {
  const testContents = testFilePaths.map((p) => readFileSync(p, "utf-8"))
  const joined = testContents.join("\n")

  const invariantsCovered = countMatches(spec.invariants, joined)
  const endpointsCovered = countEndpointMatches(spec.endpoints, joined)
  const constraintsCovered = countMatches(spec.constraints, joined)

  const coverage = {
    invariants: pct(invariantsCovered, spec.invariants.length),
    endpoints: pct(endpointsCovered, spec.endpoints.length),
    constraints: pct(constraintsCovered, spec.constraints.length),
  }

  const missing: string[] = []
  if (coverage.invariants < 100) missing.push(`invariants ${coverage.invariants}%`)
  if (coverage.endpoints < 100) missing.push(`endpoints ${coverage.endpoints}%`)
  if (coverage.constraints < 100) missing.push(`constraints ${coverage.constraints}%`)

  const verdict = missing.length === 0 ? "go" : "recycle"
  const reason =
    verdict === "go"
      ? "all spec items covered by tests"
      : `missing coverage: ${missing.join(", ")}`

  const result: Gate2Output = Gate2OutputSchema.parse({ verdict, reason, coverage })

  if (verdict === "go") {
    emit({ type: "gate.passed", taskId, gate: "gate2" })
    appendLog(taskId, "gate2", `[pass] ${reason}`)
  } else {
    emit({ type: "gate.rejected", taskId, gate: "gate2", verdict, reason })
    appendLog(taskId, "gate2", `[recycle] ${reason}`)
  }

  return result
}

function countMatches(items: string[], content: string): number {
  return items.filter((item) => content.toLowerCase().includes(item.toLowerCase())).length
}

function countEndpointMatches(
  endpoints: { method: string; path: string }[],
  content: string,
): number {
  const lower = content.toLowerCase()
  return endpoints.filter((ep) => {
    const method = ep.method.toLowerCase()
    const path = ep.path.toLowerCase()
    return lower.includes(method) && lower.includes(path)
  }).length
}

function pct(covered: number, total: number): number {
  if (total === 0) return 100
  return Math.round((covered / total) * 100)
}
