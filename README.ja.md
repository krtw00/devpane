# DevPane

日本語 | [English](README.md)

自律型AI開発デーモン — PM、Worker、Gateエージェントが、あなたが寝ている間にTDDパイプラインを回す。

寝る前にデーモンを起動し、朝にDiscord日報を確認。ブラウザからチャットで介入できるAI自律開発環境。

## 仕組み

```
You (browser chat) → PM Agent → Gate 1 → Tester → Gate 2 → Worker → Gate 3 → PR
                         ↑                                                    |
                         └──── Kaizen (self-improvement) ←────────────────────┘
```

1. **PM Agent** が CLAUDE.md とプロジェクトコンテキストから構造化された仕様を生成
2. **Gate 1** が仕様をプロジェクト目標と照合して検証
3. **Tester** がテストを自動生成（TDD: まずレッドから）
4. **Gate 2** がテストと仕様の整合性を確認
5. **Worker** が隔離されたGit worktreeで実装
6. **Gate 3** が観測可能な事実（終了コード、diff、テスト結果）を確認
7. **Kaizen** が失敗を分析し、改善を適用

## 特徴

- **自律パイプライン** — タスクがPM → Test → Implement → Reviewを人間の介入なしに通過
- **Git worktree隔離** — 各タスクが独自のworktreeで実行され、干渉なし
- **Observable Facts** — 完了判定は終了コード・diff・テスト結果による。LLMの意見ではない
- **3段階Gateシステム** — 各段階でGo / Kill / Recycleを判定
- **自己改善** — 失敗の根本原因分析と自動的なプロセス改善
- **ブラウザUI** — Vue 3ダッシュボードでタスク監視、エージェントとのチャット、SPCチャート表示
- **Discordレポート** — 毎日のPRサマリーをDiscordに投稿

## 技術スタック

| コンポーネント | 技術 |
|-----------|-----------|
| Daemon | Hono, TypeScript, Node.js |
| Web UI | Vue 3, Vite, Vue Router |
| Database | SQLite (better-sqlite3) |
| Shared | Zod schemas, TypeScript |
| Build | pnpm workspace, esbuild |

## クイックスタート

```bash
git clone https://github.com/krtw00/devpane.git
cd devpane
cp .env.example .env
# .envを編集: PROJECT_ROOTに対象リポジトリのパスを設定
pnpm install && pnpm build
pnpm dev
```

`http://localhost:3000` を開いてダッシュボードにアクセス。

## プロジェクトでの使い方

1. `.env` の `PROJECT_ROOT` に対象リポジトリのパスを設定
2. リポジトリにプロジェクトコンテキストを記載した `CLAUDE.md` を用意
3. devpaneを起動 — デーモンが自律的にタスクを取得して実行
4. ブラウザから進捗を監視、またはDiscordで日次レポートを確認

## コマンド

```bash
pnpm dev          # daemon + web UI を起動
pnpm build        # 全パッケージをビルド
pnpm test         # 全テストを実行
pnpm start        # daemon を起動（本番用）
```

## アーキテクチャ

```
packages/
├── daemon/   # Hono API (port 3001) — エージェントオーケストレーション
├── web/      # Vue 3 SPA (port 3000) — 監視ダッシュボード
└── shared/   # Zod schemas & 共有型定義
```

詳細なアーキテクチャは[設計ドキュメント](design/00-index.md)を参照。

## 設計原則

- **LLM as transformer** — LLMはinput→output変換のみ担当。フロー制御とGate判定はコードで行う
- **Blackboard as truth** — SQLiteが全エージェント状態の唯一の真実の源
- **Contracts at boundaries** — Zodスキーマで全入出力を検証

## ライセンス

MIT
