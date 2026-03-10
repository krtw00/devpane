# DevPane

AIチームのバーチャルオフィスをブラウザの窓から覗く。
階層型マルチエージェント（PM→リード→メンバー）が常駐で自律開発し、人間はブラウザからチャットで介入する。

## モノレポ構成

```
packages/
├── daemon/   # Hono API (port 3001) - エージェントオーケストレーション
├── web/      # Vue 3 + Vite (port 3000) - "オフィスの窓" UI
└── shared/   # 共通型定義
```

## コマンド

```bash
pnpm dev          # daemon + web 同時起動
pnpm build        # 全パッケージビルド
pnpm test         # 全テスト実行

# 個別
pnpm --filter @devpane/daemon dev
pnpm --filter @devpane/web dev
```

## 技術スタック

- **Web**: Vue 3, Vite, Vue Router
- **Daemon**: Hono, Node.js
- **共通**: TypeScript, pnpm workspace
- **DB**: SQLite（予定）

## 設計方針

- AgentMineの安全性レイヤー（Proof-Carrying Run, Observable Facts, worktree隔離）を継承
- Shogunの階層型並列実行アーキテクチャを参考
- 常駐デーモン型：人間がトリガーを引かず、タスクキューを自律消化
- 例外処理型：正常系で人間を挟まず、異常時だけ通知
