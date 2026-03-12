import { execFileSync } from "node:child_process";
import type { ObservableFacts } from "@devpane/shared";
import { getDb } from "./db.js";
import { config } from "./config.js";
import { notify } from "./discord.js";

type GhPr = {
  number: number;
  title: string;
  headRefName: string;
  url: string;
  additions: number;
  deletions: number;
  author: { login: string };
};

type RiskLevel = "recommend" | "caution" | "reject";

type PrReport = {
  pr: GhPr;
  risk: RiskLevel;
  reasons: string[];
  taskId: string | null;
  facts: ObservableFacts | null;
};

function listOpenPrs(): GhPr[] {
  try {
    const out = execFileSync(
      "gh",
      [
        "pr", "list",
        "--json", "number,title,headRefName,url,additions,deletions,author",
        "--state", "open",
      ],
      { encoding: "utf-8", cwd: config.PROJECT_ROOT },
    );
    return JSON.parse(out) as GhPr[];
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    console.error(`[pr-agent] gh pr list failed: ${err.status} ${err.stderr}`);
    return [];
  }
}

function findTaskByBranch(branch: string): { taskId: string; facts: ObservableFacts } | null {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, result FROM tasks WHERE status IN ('done', 'failed') AND result IS NOT NULL ORDER BY finished_at DESC`,
  ).all() as { id: string; result: string }[];

  for (const row of rows) {
    try {
      const facts = JSON.parse(row.result) as ObservableFacts;
      if (facts.branch === branch) {
        return { taskId: row.id, facts };
      }
    } catch {
      // skip malformed result
    }
  }
  return null;
}

function hasGate3Kill(taskId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    `SELECT COUNT(*) AS cnt FROM agent_events WHERE type = 'gate.rejected' AND payload LIKE ?`,
  ).get(`%"taskId":"${taskId}"%"verdict":"kill"%`) as { cnt: number };
  return row.cnt > 0;
}

function assessRisk(pr: GhPr, taskId: string | null, facts: ObservableFacts | null): PrReport {
  const reasons: string[] = [];
  let risk: RiskLevel = "recommend";
  const diffSize = pr.additions + pr.deletions;

  // Gate3 kill → reject
  if (taskId && hasGate3Kill(taskId)) {
    risk = "reject";
    reasons.push("Gate3 kill");
  }

  // Test failure → caution
  if (facts?.test_result && facts.test_result.failed > 0) {
    risk = risk === "reject" ? "reject" : "caution";
    reasons.push(`テスト失敗: ${facts.test_result.failed}`);
  }

  // Diff size thresholds
  if (diffSize > 300) {
    risk = risk === "reject" ? "reject" : "caution";
    reasons.push(`大規模diff: +${pr.additions}/-${pr.deletions}`);
  } else if (diffSize < 100 && risk === "recommend") {
    reasons.push(`小規模diff: +${pr.additions}/-${pr.deletions}`);
  }

  // Lint errors
  if (facts?.lint_result && facts.lint_result.errors > 0) {
    risk = risk === "reject" ? "reject" : "caution";
    reasons.push(`lintエラー: ${facts.lint_result.errors}`);
  }

  // Test all passed + small diff → recommend
  if (risk === "recommend" && facts?.test_result && facts.test_result.failed === 0) {
    reasons.push(`テスト全通過: ${facts.test_result.passed}`);
  }

  if (reasons.length === 0) {
    reasons.push("facts不足");
  }

  return { pr, risk, reasons, taskId, facts };
}

function riskEmoji(risk: RiskLevel): string {
  switch (risk) {
    case "recommend": return "✅推奨";
    case "caution": return "⚠️要確認";
    case "reject": return "❌非推奨";
  }
}

function formatReport(reports: PrReport[]): string {
  if (reports.length === 0) {
    return "## PR Agent Report\n\nオープンPRなし";
  }

  const lines = [
    "## PR Agent Report",
    "",
    "| # | タイトル | diff | テスト | 判定 | 理由 |",
    "|---|---------|------|--------|------|------|",
  ];

  for (const r of reports) {
    const diffSize = r.pr.additions + r.pr.deletions;
    const testCol = r.facts?.test_result
      ? `${r.facts.test_result.passed}✓ ${r.facts.test_result.failed}✗`
      : "-";
    lines.push(
      `| [#${r.pr.number}](${r.pr.url}) | ${r.pr.title} | +${r.pr.additions}/-${r.pr.deletions} (${diffSize}) | ${testCol} | ${riskEmoji(r.risk)} | ${r.reasons.join(", ")} |`,
    );
  }

  return lines.join("\n");
}

export async function runPrAgent(): Promise<string> {
  console.log("[pr-agent] scanning open PRs...");

  const prs = listOpenPrs();
  console.log(`[pr-agent] found ${prs.length} open PRs`);

  const reports: PrReport[] = prs.map((pr) => {
    const match = findTaskByBranch(pr.headRefName);
    return assessRisk(pr, match?.taskId ?? null, match?.facts ?? null);
  });

  const markdown = formatReport(reports);
  await notify(markdown);

  console.log("[pr-agent] report sent");
  return markdown;
}
