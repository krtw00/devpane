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
  recommended: "✅ Recommended",
  needs_review: "⚠️ Needs Review",
  not_recommended: "❌ Not Recommended",
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
    .filter((pr) => pr.headRefName.startsWith(`${config.BRANCH_PREFIX}/task-`))
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
    return { pr, diffSize, risk: "not_recommended", reason: "tests failed" }
  }

  if (pr.testStatus === "pass" && diffSize < config.PR_RISK_DIFF_THRESHOLD) {
    return { pr, diffSize, risk: "recommended", reason: "tests pass & small diff" }
  }

  const reasons: string[] = []
  if (pr.testStatus === "unknown") reasons.push("test status unknown")
  if (diffSize >= config.PR_RISK_DIFF_THRESHOLD) reasons.push(`large diff (${diffSize} lines)`)

  return { pr, diffSize, risk: "needs_review", reason: reasons.join(", ") }
}

function formatReport(reports: PrReport[]): string {
  if (reports.length === 0) {
    return `📋 **PR Daily Report**\nNo unmerged \`${config.BRANCH_PREFIX}/task-*\` PRs.`
  }

  const lines = [
    "📋 **PR Daily Report**",
    `PRs: ${reports.length}`,
    "",
    "```",
    "PR#  | Diff  | Tests  | Risk       | Title",
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
  lines.push(`Recommended: ${recommended} / Needs Review: ${needsReview} / Not Recommended: ${notRecommended}`)

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
