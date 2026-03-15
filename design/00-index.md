---
depends_on: []
tags: [navigation, index]
ai_summary: "DevPane設計ドキュメントへのナビゲーションハブ"
---

# 設計ドキュメントインデックス

> Status: Active
> 最終更新: 2026-03-15

本ドキュメントは、設計ドキュメント全体のナビゲーションを提供する。

---

## ドキュメント構造

```mermaid
flowchart LR
    A[01-overview<br/>全体像] --> B[02-architecture<br/>設計]
    B --> C[03-details<br/>詳細]
    C --> D[04-decisions<br/>決定記録]
```

| レベル | 目的 | 対象読者 |
|--------|------|----------|
| **01-overview** | 何を作るか、なぜ作るか | 初見・思い出し用 |
| **02-architecture** | どう構成するか | 設計理解 |
| **03-details** | 具体的な仕様 | 実装時参照 |
| **04-decisions** | なぜその選択をしたか | 判断根拠 |

---

## ドキュメント一覧

### 00 - メタドキュメント

| ドキュメント | 説明 |
|--------------|------|
| [00-index.md](./00-index.md) | 本ドキュメント。全体ナビゲーション |
| [00-template-guide.md](./00-template-guide.md) | 内容と配置先の対応表（どこに何を書くか） |
| [00-writing-guide.md](./00-writing-guide.md) | 記載規範（文章の書き方） |
| [00-format-guide.md](./00-format-guide.md) | フォーマット規範（構造・メタ情報・図・命名） |
| [00-git-guide.md](./00-git-guide.md) | Git規範（コミット・ブランチ・変更履歴） |

### 01 - Overview（全体像）

| ドキュメント | 説明 |
|--------------|------|
| [summary.md](./01-overview/summary.md) | プロジェクト概要（1枚で全体把握） |
| [goals.md](./01-overview/goals.md) | 目的・解決する課題・成功基準 |
| [scope.md](./01-overview/scope.md) | スコープ・フェーズ分割・前提条件 |

### 02 - Architecture（設計）

| ドキュメント | 説明 |
|--------------|------|
| [context.md](./02-architecture/context.md) | システム境界・外部連携（C4 Context） |
| [structure.md](./02-architecture/structure.md) | 主要コンポーネント構成（C4 Container） |
| [tech-stack.md](./02-architecture/tech-stack.md) | 技術スタック・選定理由 |

### 03 - Details（詳細）

| ドキュメント | 説明 |
|--------------|------|
| [data-model.md](./03-details/data-model.md) | SQLiteスキーマ・ER図・状態遷移 |
| [api.md](./03-details/api.md) | Hono APIエンドポイント仕様 |
| [flows.md](./03-details/flows.md) | パイプライン・自律ループ・worktreeフロー |
| [ui.md](./03-details/ui.md) | Web UI画面設計・介入レベル |

### 04 - Decisions（決定記録）

| ドキュメント | 説明 |
|--------------|------|
| [0001-template.md](./04-decisions/0001-template.md) | ADRテンプレート |

### 99 - Appendix（付録）

| ドキュメント | 説明 |
|--------------|------|
| [glossary.md](./99-appendix/glossary.md) | 用語集 |
| [brainstorm_2026-03-10.md](./99-appendix/brainstorm_2026-03-10.md) | 初期ブレスト整理・市場比較・Shogun/AgentMine分析 |

---

## 読み方ガイド

### 初めて読む場合

1. [summary.md](./01-overview/summary.md) - プロジェクト概要を把握
2. [goals.md](./01-overview/goals.md) - 目的を理解
3. [context.md](./02-architecture/context.md) - システム境界を確認

### 設計を理解したい場合

1. [structure.md](./02-architecture/structure.md) - コンポーネント構成
2. [tech-stack.md](./02-architecture/tech-stack.md) - 技術選定理由
3. [04-decisions/](./04-decisions/) - 設計判断の根拠

### 実装時に参照する場合

1. [data-model.md](./03-details/data-model.md) - データ構造
2. [flows.md](./03-details/flows.md) - 処理フロー
3. [glossary.md](./99-appendix/glossary.md) - 用語確認

---

## 関連ドキュメント

- [記載規範](./00-writing-guide.md) - 文章の書き方ルール
- [フォーマット規範](./00-format-guide.md) - 構造・メタ情報・図・命名規則
- [Git規範](./00-git-guide.md) - コミット・ブランチ・変更履歴
