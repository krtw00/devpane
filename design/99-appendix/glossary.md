---
depends_on: []
tags: [appendix, glossary, terminology]
ai_summary: "DevPaneのドメイン用語・技術用語・システム固有用語の定義"
---

# 用語集

> Status: Active
> 最終更新: 2026-03-15

本ドキュメントは、DevPaneで使用する用語を定義する。

---

## ドメイン用語

| 用語 | 定義 |
|------|------|
| オフィスの窓 | Web UIのコンセプト。AIチームが働いている様子をブラウザから覗く体験 |
| 介入レベル | 人間の関与度合いを0〜5で定義した段階。レベル0（放置）が正常系 |
| 日報 | PR Agentが日次でDiscordに投稿するPR要約テーブル |

---

## 技術用語

| 用語 | 正式名称 | 定義 |
|------|----------|------|
| ADR | Architecture Decision Record | 設計上の重要な決定とその理由を記録するドキュメント |
| SPC | Statistical Process Control | 統計的工程管理。管理図で異常を検出する手法 |
| TDD | Test-Driven Development | テスト先行開発。テストを書いてから実装する |
| UCL/LCL | Upper/Lower Control Limit | 管理図の上方/下方管理限界 |
| WIP | Work In Progress | 作業中。WIP制限はカンバンの流量制御 |
| ULID | Universally Unique Lexicographically Sortable Identifier | 時系列ソート可能な一意識別子 |

---

## システム固有用語

| 用語 | 定義 | 関連 |
|------|------|------|
| Blackboard | SQLiteを共有知識ベースとして使うパターン。全エージェントがここに読み書きする | [データモデル](../03-details/data-model.md) |
| Observable Facts | AIの自己申告に依存せず、exit code・diff・テスト結果で客観的に状態を判定する仕組み | [主要フロー](../03-details/flows.md) |
| Gate | パイプラインの品質検査ポイント。Go/Kill/Recycleの3判定を行う | [主要フロー](../03-details/flows.md) |
| Contract | エージェント間の入出力をZodスキーマで検証する設計原則 | [プロジェクト概要](../01-overview/summary.md) |
| Kaizen | なぜなぜ分析→改善→効果測定の自己改善ループ | [主要フロー](../03-details/flows.md) |
| PM | Project Manager Agent。CLAUDE.md・記憶・履歴から構造化仕様を生成する | [主要コンポーネント構成](../02-architecture/structure.md) |
| Worker | 実装Agent。worktree内でTDD実装を行う | [主要コンポーネント構成](../02-architecture/structure.md) |
| PR Agent | 日次PR要約・Discord日報・マージ実行を担うAgent | [主要コンポーネント構成](../02-architecture/structure.md) |

---

## 非推奨用語

| 非推奨 | 推奨 | 理由 |
|--------|------|------|
| AgentMine | DevPane | プロジェクト名をリセットした |
| 将軍/家老/足軽 | PM/Lead/Worker | Shogunの武士表現を一般表現に変更した |

---

## 関連ドキュメント

- [記載規範](../00-writing-guide.md) - 文章の書き方ルール
- [ドキュメントインデックス](../00-index.md) - ドキュメント全体のナビゲーション
