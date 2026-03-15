---
depends_on:
  - ./goals.md
tags: [overview, scope, phases]
ai_summary: "DevPaneの対象範囲・対象外・フェーズ分割・前提条件・制約を定義"
---

# スコープ・対象外

> Status: Active
> 最終更新: 2026-03-15

本ドキュメントは、DevPaneのスコープ（範囲）を明確にする。

---

## スコープ定義

### 対象範囲

| カテゴリ | 対象 | 説明 |
|----------|------|------|
| 機能 | 自律開発ループ | PM→Gate→Tester→Worker→Gate→PRの一連のパイプライン |
| 機能 | タスクキュー管理 | SQLiteベースのタスク生成・割当・完了判定 |
| 機能 | 自己改善 | なぜなぜ分析・効果測定・Gate/PMテンプレート更新 |
| 機能 | PR Agent | 日次PR要約・Discordへの日報投稿 |
| 機能 | Web UI | タスク一覧・ログ閲覧・チャット介入 |
| ユーザー | 個人開発者 | iguchi個人環境で動作 |
| プラットフォーム | Linux | Arch Linux上のNode.js |

### 対象外

| カテゴリ | 対象外 | 理由 |
|----------|--------|------|
| ユーザー | チーム利用 | まず個人で安定稼働させる |
| 機能 | マルチリポジトリ | 単一リポジトリで検証を優先する |
| 機能 | AI非依存（RunnerAdapter） | Claude Code CLI固定で十分 |
| プラットフォーム | Windows / macOS | 開発環境がArch Linux |

---

## フェーズ分け

```mermaid
flowchart LR
    P1[Phase 1<br/>自律ループ] --> P2[Phase 2<br/>Web UI]
    P2 --> P3[Phase 3<br/>VPS常駐]
    P3 --> P4[Phase 4<br/>並列化]
```

### Phase 1: 自律ループ（現在）

| 機能 | 説明 |
|------|------|
| PM Agent | CLAUDE.md・記憶・履歴からタスク生成 |
| Worker Agent | worktreeで隔離実行 |
| Gate 1/2/3 | 方針チェック・仕様-テスト照合・成果物判定 |
| Tester | 構造化仕様からテスト自動生成 |
| Observable Facts | exit code・diff・テスト結果の自動収集 |
| Scheduler | ループ制御・heartbeat・エラーハンドリング |
| Kaizen | なぜなぜ分析・効果測定 |
| PR Agent | 日次PR要約・Discord通知 |

### Phase 2: Web UI

| 機能 | 説明 |
|------|------|
| ダッシュボード | タスク一覧・ステータス・コスト表示 |
| タスク詳細 | 構造化仕様・ログ・diff閲覧 |
| チャット介入 | Web UIからPMへの指示投入 |
| 記憶管理 | feature/decision/lesson の閲覧・編集 |

### Phase 3: VPS常駐

| 機能 | 説明 |
|------|------|
| VPSデプロイ | apps-vps（133.18.124.16）で24/7稼働 |
| HTTPS+認証 | Caddy + Tailscaleアクセス制限 |
| systemd管理 | 自動再起動・プロセス管理 |

### Phase 4: 並列化・拡張

| 機能 | 説明 |
|------|------|
| Worker並列化 | 複数Workerの同時実行 |
| GitHub Issues同期 | Issueからタスクを自動取り込み |
| チャット介入強化 | 自然言語→構造化指示の変換 |

---

## 前提条件

| 前提 | 説明 |
|------|------|
| Claude Code CLI | `claude` コマンドが使える状態 |
| Max plan認証 | `claude login` でOAuth認証済み |
| CLAUDE.md | 対象リポジトリにCLAUDE.mdが存在する |
| Git | リポジトリが初期化済みである |

---

## 制約事項

| 制約 | 種別 | 説明 |
|------|------|------|
| Max planレート制限 | 技術 | Claude Code CLIのレート制限内で運用する |
| 単一マシン | リソース | Phase 1はローカル環境のみ |
| 定額内運用 | コスト | API従量課金は使用しない |

---

## 関連ドキュメント

- [プロジェクト概要](./summary.md) - 1枚で全体像を把握
- [目的・解決する課題](./goals.md) - 課題と成功基準
