# Contributing to DevPane

[日本語](#日本語) | [English](#english)

---

## English

Thank you for your interest in contributing to DevPane!

### What is DevPane?

DevPane is an autonomous AI development daemon. PM, Worker, and Gate agents orchestrate TDD pipelines while you sleep. You monitor progress through a browser dashboard and intervene via chat when needed.

- **Daemon**: TypeScript, Hono, Node.js, SQLite
- **Web UI**: Vue 3, Vite, Vue Router
- **Shared**: Zod schemas, TypeScript types

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 22+ |
| pnpm | 10+ |
| Git | Latest |
| Claude Code CLI | Latest (for running agents) |

### Setup

```bash
# 1. Clone
git clone https://github.com/krtw00/devpane.git
cd devpane

# 2. Install dependencies
pnpm install

# 3. Build all packages
pnpm build

# 4. Run tests
pnpm test

# 5. Start dev servers (daemon + web)
pnpm dev
```

Open `http://localhost:3000` in your browser. API requests are proxied to `http://localhost:3001`.

### Architecture

```
Scheduler → PM Agent → Gate 1 → Tester → Gate 2 → Worker → Gate 3 → PR
                ↑                                                      |
                └──────────── Kaizen (self-improvement) ←──────────────┘
```

All agents run as `claude -p` subprocesses. State is stored in SQLite (Blackboard pattern). Worker tasks execute in isolated Git worktrees.

#### Directory structure

```
devpane/
├── packages/
│   ├── daemon/              # Hono API server (port 3001)
│   │   ├── src/
│   │   │   ├── index.ts     # Entrypoint (Hono + Scheduler)
│   │   │   ├── scheduler.ts # Autonomous loop control
│   │   │   ├── pm.ts        # PM Agent (task generation)
│   │   │   ├── worker.ts    # Worker Agent (TDD implementation)
│   │   │   ├── tester.ts    # Tester Agent (test generation)
│   │   │   ├── gate.ts      # Gate 1/2/3 (Go/Kill/Recycle)
│   │   │   ├── gate1.ts     # Gate 1 (policy check)
│   │   │   ├── facts.ts     # Observable Facts collection
│   │   │   ├── worktree.ts  # Git worktree management
│   │   │   ├── kaizen.ts    # Self-improvement analysis
│   │   │   ├── pr-agent.ts  # Daily PR report
│   │   │   ├── spc.ts       # Statistical Process Control
│   │   │   ├── config.ts    # Configuration (env vars)
│   │   │   ├── db/          # SQLite operations
│   │   │   └── api/         # REST API endpoints
│   │   └── src/__tests__/   # Vitest tests
│   ├── web/                 # Vue 3 SPA (port 3000)
│   │   └── src/
│   │       ├── views/       # Page components
│   │       ├── components/  # Shared components
│   │       ├── composables/ # Vue composables (API, WebSocket)
│   │       └── router/      # Vue Router
│   └── shared/              # Shared types & Zod schemas
│       └── src/
│           ├── types.ts     # TypeScript type definitions
│           └── schemas.ts   # Zod validation schemas
├── design/                  # Design documents (templarc format)
├── deploy/                  # Deployment scripts & systemd unit
└── CLAUDE.md                # Project context for AI agents
```

#### Layer responsibilities

| Layer | Does | Does NOT do |
|-------|------|-------------|
| Scheduler | Loop control, heartbeat, error handling | Task generation, code changes |
| PM Agent | Read project context, generate structured specs | Write code, run tests |
| Gate 1/2/3 | Go/Kill/Recycle decisions based on rules + LLM | Generate specs, write code |
| Worker | TDD implementation in worktree | Decide what to build |
| Tester | Generate tests from specs | Implement features |

### Branch strategy

```
main (stable, protected)
├── develop (human development)
└── ai-develop (AI autonomous, deployed to VPS)
```

| Branch | Purpose | Merge target |
|--------|---------|-------------|
| `main` | Stable release | — |
| `develop` | Human development | → main (PR) |
| `ai-develop` | AI autonomous | → main (PR) |
| `feat/*`, `fix/*` | Feature branches | → develop (PR) |

**Important**: `ai-develop` is managed by the AI daemon. Do not commit directly to it.

### Development workflow

#### 1. Open an issue (recommended)

For large changes or new features, discuss the approach in an issue first. Small bug fixes and typos can go straight to a PR.

#### 2. Create a branch

```bash
git checkout develop
git pull origin develop
git checkout -b feat/your-feature   # New feature
git checkout -b fix/your-bugfix     # Bug fix
```

#### 3. Make your changes

- Build check: `pnpm build`
- Run tests: `pnpm test`
- Start dev servers: `pnpm dev`

#### 4. Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) required:

```
feat(web): add SPC chart to dashboard
fix(gate): fix unreachable timeout classification
refactor(scheduler): extract rate limit logic
docs(design): update data model documentation
test(pm): add tests for JSON parsing edge cases
```

| type | Purpose |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Refactoring (no behavior change) |
| `test` | Tests |
| `ci` | CI/CD changes |
| `chore` | Build, dependencies, tooling |

#### 5. Open a Pull Request

- One PR per change
- Describe **why** the change is needed
- Include test results
- Target branch: `develop` (not `main`)

### Common development tasks

#### Adding a new API endpoint

1. Add handler in `packages/daemon/src/api/`
2. Register route in `packages/daemon/src/index.ts`
3. Add types in `packages/shared/src/types.ts` if needed
4. Add client function in `packages/web/src/composables/useApi.ts`
5. Add tests in `packages/daemon/src/__tests__/`

#### Adding a new dashboard component

1. Create component in `packages/web/src/components/`
2. Import and use in `packages/web/src/views/Dashboard.vue`
3. Add API data fetching in `packages/web/src/composables/useApi.ts`

#### Adding a new DB table

1. Add migration in `packages/daemon/src/migrations/`
2. Add query functions in `packages/daemon/src/db/`
3. Add types in `packages/shared/src/types.ts`
4. Update [design/03-details/data-model.md](design/03-details/data-model.md)

### Coding conventions

#### TypeScript

- Strict mode enabled
- Avoid `any` — use proper types or `unknown`
- Prefer `const` over `let`
- No unnecessary comments or over-engineering

#### Daemon

- All agent communication goes through SQLite (Blackboard pattern)
- Agent inputs/outputs validated with Zod schemas
- Worker execution always in Git worktrees (never on main branch)
- Configuration via environment variables (see `.env.example`)

#### Web UI

- GitHub Dark theme (#0d1117 background, #c9d1d9 text, #58a6ff accent)
- Monospace font (SF Mono / Fira Code)
- No external chart libraries — use SVG for visualizations
- Vue 3 Composition API with `<script setup>`

### Design documents

Design docs are maintained in [design/](design/00-index.md) using [templarc](https://github.com/krtw00/templarc-docs) format. Update them when making design changes.

| Topic | Reference |
|-------|-----------|
| Project overview | [design/01-overview/summary.md](design/01-overview/summary.md) |
| Components | [design/02-architecture/structure.md](design/02-architecture/structure.md) |
| Tech stack | [design/02-architecture/tech-stack.md](design/02-architecture/tech-stack.md) |
| Data model | [design/03-details/data-model.md](design/03-details/data-model.md) |
| Flows | [design/03-details/flows.md](design/03-details/flows.md) |
| Glossary | [design/99-appendix/glossary.md](design/99-appendix/glossary.md) |

### Environment variables

See [.env.example](.env.example) for the full list. Key variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PROJECT_ROOT` | No | Git root | Target repository path |
| `DB_PATH` | No | `./devpane.db` | SQLite database path |
| `SLACK_WEBHOOK_URL` | No | — | Slack notification webhook |
| `DISCORD_WEBHOOK_URL` | No | — | Discord notification webhook |
| `ACTIVE_HOURS` | No | — | Operating hours (e.g. `00-06`) |
| `DEVPANE_BASE_BRANCH` | No | `main` | Base branch for PRs |
| `DEVPANE_BRANCH_PREFIX` | No | `devpane` | Branch prefix for tasks |

### Testing

```bash
pnpm test                              # All tests
pnpm --filter @devpane/daemon test     # Daemon tests only
pnpm --filter @devpane/web test        # Web tests only
pnpm build                             # Type check + build
```

### License

All contributions are released under the [MIT License](LICENSE).

---

## 日本語

DevPane へのコントリビュートに興味を持っていただきありがとうございます！

### DevPane とは

DevPane は AI 自律開発デーモンです。PM・Worker・Gate エージェントが TDD パイプラインを自律的に回し、人間はブラウザのダッシュボードから監視、チャットで介入します。

- **Daemon**: TypeScript, Hono, Node.js, SQLite
- **Web UI**: Vue 3, Vite, Vue Router
- **共通**: Zod スキーマ, TypeScript 型定義

### 前提条件

| ツール | バージョン |
|--------|-----------|
| Node.js | 22+ |
| pnpm | 10+ |
| Git | 最新 |
| Claude Code CLI | 最新（エージェント実行に必要） |

### セットアップ

```bash
# 1. クローン
git clone https://github.com/krtw00/devpane.git
cd devpane

# 2. 依存インストール
pnpm install

# 3. 全パッケージビルド
pnpm build

# 4. テスト実行
pnpm test

# 5. 開発サーバー起動（daemon + web）
pnpm dev
```

ブラウザで `http://localhost:3000` を開いてください。API は `http://localhost:3001` にプロキシされます。

### アーキテクチャ

```
Scheduler → PM Agent → Gate 1 → Tester → Gate 2 → Worker → Gate 3 → PR
                ↑                                                      |
                └──────────── Kaizen（自己改善） ←──────────────────────┘
```

全エージェントは `claude -p` サブプロセスとして実行されます。状態は SQLite（Blackboard パターン）に保存されます。Worker タスクは Git worktree で隔離実行されます。

#### ディレクトリ構成

```
devpane/
├── packages/
│   ├── daemon/              # Hono API サーバー（port 3001）
│   │   ├── src/
│   │   │   ├── index.ts     # エントリポイント（Hono + Scheduler）
│   │   │   ├── scheduler.ts # 自律ループ制御
│   │   │   ├── pm.ts        # PM Agent（タスク生成）
│   │   │   ├── worker.ts    # Worker Agent（TDD 実装）
│   │   │   ├── tester.ts    # Tester Agent（テスト生成）
│   │   │   ├── gate.ts      # Gate 1/2/3（Go/Kill/Recycle）
│   │   │   ├── gate1.ts     # Gate 1（方針チェック）
│   │   │   ├── facts.ts     # Observable Facts 収集
│   │   │   ├── worktree.ts  # Git worktree 管理
│   │   │   ├── kaizen.ts    # 自己改善分析
│   │   │   ├── pr-agent.ts  # 日次 PR レポート
│   │   │   ├── spc.ts       # 統計的工程管理
│   │   │   ├── config.ts    # 設定（環境変数）
│   │   │   ├── db/          # SQLite 操作
│   │   │   └── api/         # REST API エンドポイント
│   │   └── src/__tests__/   # Vitest テスト
│   ├── web/                 # Vue 3 SPA（port 3000）
│   │   └── src/
│   │       ├── views/       # ページコンポーネント
│   │       ├── components/  # 共通コンポーネント
│   │       ├── composables/ # Vue composables（API, WebSocket）
│   │       └── router/      # Vue Router
│   └── shared/              # 共通型定義・Zod スキーマ
│       └── src/
│           ├── types.ts     # TypeScript 型定義
│           └── schemas.ts   # Zod バリデーションスキーマ
├── design/                  # 設計ドキュメント（templarc 形式）
├── deploy/                  # デプロイスクリプト・systemd unit
└── CLAUDE.md                # AI エージェント向けプロジェクトコンテキスト
```

#### レイヤーの責務

| レイヤー | やること | やらないこと |
|---------|---------|-------------|
| Scheduler | ループ制御、heartbeat、エラー処理 | タスク生成、コード変更 |
| PM Agent | プロジェクト読み取り、構造化仕様生成 | コード変更、テスト実行 |
| Gate 1/2/3 | ルール + LLM による Go/Kill/Recycle 判定 | 仕様生成、コード変更 |
| Worker | worktree 内で TDD 実装 | 何を作るかの判断 |
| Tester | 仕様からテスト生成 | 機能実装 |

### ブランチ戦略

```
main（安定版、保護）
├── develop（人間の開発用）
└── ai-develop（AI 自走用、VPS で自動稼働）
```

| ブランチ | 用途 | マージ先 |
|---------|------|---------|
| `main` | 安定リリース | — |
| `develop` | 人間の開発 | → main (PR) |
| `ai-develop` | AI 自走 | → main (PR) |
| `feat/*`, `fix/*` | 作業ブランチ | → develop (PR) |

**重要**: `ai-develop` は AI デーモンが管理しています。直接コミットしないでください。

### 開発フロー

#### 1. Issue で相談（推奨）

大きな変更や新機能は、先に Issue で方針を相談してください。小さなバグ修正や typo は直接 PR で OK です。

#### 2. ブランチを切る

```bash
git checkout develop
git pull origin develop
git checkout -b feat/your-feature   # 機能追加
git checkout -b fix/your-bugfix     # バグ修正
```

#### 3. 変更を加える

- ビルド確認: `pnpm build`
- テスト実行: `pnpm test`
- 開発サーバー起動: `pnpm dev`

#### 4. コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/) に準拠:

```
feat(web): ダッシュボードに SPC 管理図を追加
fix(gate): timeout 判定の到達不能コード修正
refactor(scheduler): レート制限ロジックを抽出
docs(design): データモデルドキュメント更新
test(pm): JSON パースのエッジケーステスト追加
```

| type | 用途 |
|------|------|
| `feat` | 新機能 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみ |
| `refactor` | リファクタリング（動作変更なし） |
| `test` | テスト |
| `ci` | CI/CD |
| `chore` | ビルド・依存・ツール |

#### 5. Pull Request を作成

- 1 つの PR で 1 つの変更
- 変更の目的（なぜ）を書く
- テスト結果を含める
- マージ先: `develop`（`main` ではない）

### よくある開発タスク

#### 新しい API エンドポイント追加

1. `packages/daemon/src/api/` にハンドラ追加
2. `packages/daemon/src/index.ts` にルート登録
3. 必要に応じて `packages/shared/src/types.ts` に型追加
4. `packages/web/src/composables/useApi.ts` にクライアント関数追加
5. `packages/daemon/src/__tests__/` にテスト追加

#### 新しいダッシュボードコンポーネント追加

1. `packages/web/src/components/` にコンポーネント作成
2. `packages/web/src/views/Dashboard.vue` で import して使用
3. `packages/web/src/composables/useApi.ts` に API データ取得追加

#### 新しい DB テーブル追加

1. `packages/daemon/src/migrations/` にマイグレーション追加
2. `packages/daemon/src/db/` にクエリ関数追加
3. `packages/shared/src/types.ts` に型追加
4. [design/03-details/data-model.md](design/03-details/data-model.md) を更新

### コーディング規約

#### TypeScript

- strict mode 有効
- `any` を避ける — 適切な型か `unknown` を使う
- `let` より `const` を優先
- 不要なコメントや過剰なエンジニアリングは避ける

#### Daemon

- 全エージェント間の通信は SQLite 経由（Blackboard パターン）
- エージェントの入出力は Zod スキーマで検証
- Worker は必ず Git worktree で実行（main ブランチ直接は禁止）
- 設定は環境変数で管理（`.env.example` 参照）

#### Web UI

- GitHub Dark テーマ（#0d1117 背景、#c9d1d9 テキスト、#58a6ff アクセント）
- モノスペースフォント（SF Mono / Fira Code）
- 外部チャートライブラリ不使用 — SVG で描画
- Vue 3 Composition API `<script setup>` 形式

### 設計ドキュメント

設計ドキュメントは [design/](design/00-index.md) に [templarc](https://github.com/krtw00/templarc-docs) 形式で管理しています。設計変更を伴う場合はドキュメントも更新してください。

| 知りたいこと | 参照先 |
|-------------|--------|
| プロジェクト概要 | [design/01-overview/summary.md](design/01-overview/summary.md) |
| コンポーネント構成 | [design/02-architecture/structure.md](design/02-architecture/structure.md) |
| 技術スタック | [design/02-architecture/tech-stack.md](design/02-architecture/tech-stack.md) |
| データモデル | [design/03-details/data-model.md](design/03-details/data-model.md) |
| 処理フロー | [design/03-details/flows.md](design/03-details/flows.md) |
| 用語集 | [design/99-appendix/glossary.md](design/99-appendix/glossary.md) |

### 環境変数

全一覧は [.env.example](.env.example) を参照。主要な変数:

| 変数 | 必須 | デフォルト | 説明 |
|------|------|-----------|------|
| `PROJECT_ROOT` | No | Git root | 対象リポジトリのパス |
| `DB_PATH` | No | `./devpane.db` | SQLite データベースパス |
| `SLACK_WEBHOOK_URL` | No | — | Slack 通知 Webhook |
| `DISCORD_WEBHOOK_URL` | No | — | Discord 通知 Webhook |
| `ACTIVE_HOURS` | No | — | 稼働時間（例: `00-06`） |
| `DEVPANE_BASE_BRANCH` | No | `main` | PR のベースブランチ |
| `DEVPANE_BRANCH_PREFIX` | No | `devpane` | タスクブランチのプレフィックス |

### テスト

```bash
pnpm test                              # 全テスト
pnpm --filter @devpane/daemon test     # daemon のみ
pnpm --filter @devpane/web test        # web のみ
pnpm build                             # 型チェック + ビルド
```

### ライセンス

コントリビュートされたコードは [MIT License](LICENSE) の下で公開されます。
