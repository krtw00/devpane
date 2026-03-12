import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { PmOutput } from "@devpane/shared"

// Gate 2: テスターが生成したテストファイルの妥当性チェック
// 構造化仕様(PmOutput)に対してテストが最低限揃っているか判定する

export type Gate2Result = {
  verdict: "go" | "recycle"
  reasons: string[]
}

export function runGate2(_spec: PmOutput, testFiles: string[], worktreePath: string): Gate2Result {
  const reasons: string[] = []

  // Rule 1: テストファイルが1つ以上存在する
  const existing = testFiles.filter(f => existsSync(join(worktreePath, f)))
  if (existing.length === 0) {
    reasons.push("no test files found")
    return { verdict: "recycle", reasons }
  }

  for (const file of existing) {
    const fullPath = join(worktreePath, file)
    let content: string
    try {
      content = readFileSync(fullPath, "utf-8")
    } catch {
      reasons.push(`cannot read: ${file}`)
      continue
    }

    // Rule 2: describe/test/itブロックが存在する
    if (!/\b(describe|test|it)\s*\(/.test(content)) {
      reasons.push(`no test blocks in: ${file}`)
    }

    // Rule 3: 構文チェック — importパスとブロック構造
    const importLines = content.match(/^import\s.+$/gm) ?? []
    for (const line of importLines) {
      if (/from\s+['"]\s*['"]/.test(line)) {
        reasons.push(`empty import path in: ${file}`)
      }
    }

    const opens = (content.match(/\{/g) ?? []).length
    const closes = (content.match(/\}/g) ?? []).length
    if (opens !== closes) {
      reasons.push(`unbalanced braces in: ${file}`)
    }
  }

  return {
    verdict: reasons.length > 0 ? "recycle" : "go",
    reasons,
  }
}
