import { execFileSync } from "node:child_process"
import { config } from "./config.js"
import { getNotifier } from "./notifier-factory.js"

export type PrInfo = {
  number: number
  title: string
  headRefName: string
  additions: number
  deletions: number
  url: string
  testStatus: "pass" | "fail" | "unknown"
}

export type RiskLevel = "recommended" | "needs_review" | "not_recommended"

export type PrReport = {
  pr: PrInfo
  diffSize: number
  risk: RiskLevel
  reason: string
}

const RISK_LABELS: Record<RiskLevel, string> = {
  recommended: "✅ マージ推奨",
  needs_review: "⚠️ 要確認",
  not_recommended: "❌ 非推奨",
}

export function parseGhPrList(json: string): PrInfo[] {
  const raw: Array<{
    number: number
    title: string
    headRefName: string
    additions: number
    deletions: number
    url: string
    statusCheckRollup?: Array<{ conclusion: string }> | null
  }> = JSON.parse(json)

  return raw
    .filter((pr) => pr.headRefName.startsWith("devpane/task-"))
    .map((pr) => {
      let testStatus: PrInfo["testStatus"] = "unknown"
      if (pr.statusCheckRollup && pr.statusCheckRollup.length > 0) {
        const allPass = pr.statusCheckRollup.every((c) => c.conclusion === "SUCCESS")
        const anyFail = pr.statusCheckRollup.some(
          (c) => c.conclusion === "FAILURE" || c.conclusion === "ERROR",
        )
        if (allPass) testStatus = "pass"
        else if (anyFail) testStatus = "fail"
      }
      return {
        number: pr.number,
        title: pr.title,
        headRefName: pr.headRefName,
        additions: pr.additions,
        deletions: pr.deletions,
        url: pr.url,
        testStatus,
      }
    })
}

export function assessRisk(pr: PrInfo): PrReport {
  const diffSize = pr.additions + pr.deletions

  if (pr.testStatus === "fail") {
    return { pr, diffSize, risk: "not_recommended", reason: "テスト失敗" }
  }

  if (pr.testStatus === "pass" && diffSize < config.PR_RISK_DIFF_THRESHOLD) {
    return { pr, diffSize, risk: "recommended", reason: "テスト通過 & diff小" }
  }

  const reasons: string[] = []
  if (pr.testStatus === "unknown") reasons.push("テスト結果不明")
  if (diffSize >= config.PR_RISK_DIFF_THRESHOLD) reasons.push(`diff大 (${diffSize}行)`)

  return { pr, diffSize, risk: "needs_review", reason: reasons.join(", ") }
}

function formatReport(reports: PrReport[]): string {
  if (reports.length === 0) {
    return "📋 **PR日次レポート**\n未マージの`devpane/task-*` PRはありません。"
  }

  const lines = [
    "📋 **PR日次レポート**",
    `対象PR: ${reports.length}件`,
    "",
    "```",
    "PR#  | Diff  | テスト | 判定       | タイトル",
    "-----|-------|--------|------------|--------",
  ]

  for (const r of reports) {
    const num = `#${r.pr.number}`.padEnd(4)
    const diff = `+${r.pr.additions}/-${r.pr.deletions}`.padEnd(7)
    const test = r.pr.testStatus.padEnd(8)
    const risk = RISK_LABELS[r.risk].padEnd(12)
    const title = r.pr.title.length > 40 ? r.pr.title.slice(0, 37) + "..." : r.pr.title
    lines.push(`${num} | ${diff}| ${test}| ${risk}| ${title}`)
  }

  lines.push("```")

  const recommended = reports.filter((r) => r.risk === "recommended").length
  const needsReview = reports.filter((r) => r.risk === "needs_review").length
  const notRecommended = reports.filter((r) => r.risk === "not_recommended").length

  lines.push("")
  lines.push(`推奨: ${recommended} / 要確認: ${needsReview} / 非推奨: ${notRecommended}`)

  return lines.join("\n")
}

export function fetchOpenPrs(): PrInfo[] {
  try {
    const result = execFileSync(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "open",
        "--json",
        "number,title,headRefName,additions,deletions,url,statusCheckRollup",
      ],
      { cwd: config.PROJECT_ROOT, encoding: "utf-8", timeout: 30000 },
    ).trim()
    return parseGhPrList(result)
  } catch (err) {
    console.error(
      `[pr-agent] gh pr list failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return []
  }
}

export async function runPrAgent(): Promise<{ reports: PrReport[]; message: string }> {
  console.log("[pr-agent] generating daily PR report")
  const prs = fetchOpenPrs()
  const reports = prs.map(assessRisk)
  const message = formatReport(reports)

  await getNotifier().sendMessage(message)
  console.log(`[pr-agent] report sent (${reports.length} PRs)`)

  return { reports, message }
}
