# DevPane — 技術設計書

## 概要

### 目的
一度起動したら放置で自律開発し続ける常駐デーモン。
AIチームのバーチャルオフィスをブラウザの窓から覗き、チャットで介入する。

### スコープ（Phase 1）
- PM + Worker(1) の2層自律ループが回る
- タスクの自動生成・実行・完了判定が人間なしで継続する
- DevPane自身を対象に自己開発する

### 前提条件・制約
- Claude Code CLIがインストール済み（`claude` コマンドが使える）
- `claude login` でMax plan認証済み（OAuth。API key従量課金ではなく定額サブスクで回す）
- 対象リポジトリにCLAUDE.mdが存在する
- ローカルマシン（iguchi個人環境）で動作

## 要件

### 機能要件
- PMがCLAUDE.md + READMEを読み、プロジェクトの現状を把握する
- PMがタスクを生成しSQLiteキューに積む
- Workerがキューからタスクを取り、worktreeで隔離実行する
- 完了判定をObservable Facts（exit code, diff, テスト結果）で行う
- PMが結果を見て次タスクを生成し、ループが継続する
- キューが空になったらPMに問い合わせてタスクを補充する
- daemonが死んだら自動再起動する（heartbeat）

### 非機能要件
- daemon起動後、人間の操作なしで回り続ける
- Workerの並列数は設計上N本（初期実装は1）
- Max planの定額サブスクリプション内で運用（API従量課金なし）
- レート制限に到達した場合は待機して自動再開

## 設計

### アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│ daemon (Hono, port 3001)                        │
│                                                 │
│  ┌──────────┐    ┌────────────┐    ┌─────────┐  │
│  │ PM Agent │───→│ Task Queue │←───│ Worker  │  │
│  │          │    │  (SQLite)  │    │ Agent   │  │
│  │ 何をやるか│    │            │    │ 実行する │  │
│  │ 決める   │←──┐│ pending    │    │         │  │
│  └──────────┘  ││ running    │    └────┬────┘  │
│       ↑        ││ done/failed│         │       │
│       │        │└────────────┘         │       │
│       │        │                       │       │
│       │        └── 結果を見て ──────────┘       │
│       │            次タスク生成                  │
│  ┌────┴─────┐                                   │
│  │ Scheduler│ ループ制御・heartbeat              │
│  └──────────┘                                   │
│                                                 │
│  ┌──────────┐                                   │
│  │ Hono API │ /tasks, /logs, /ws (Web UI用)     │
│  └──────────┘                                   │
└─────────────────────────────────────────────────┘
         ↑ WebSocket
┌────────┴────────┐
│ web (Vue 3)     │  ← Phase 2
│ port 3000       │
└─────────────────┘
```

### コンポーネント

#### Scheduler（ループ制御）
daemon起動時に開始し、以下のループを永続的に回す。

```
while (alive) {
  1. キューに pending タスクがあるか確認
  2. なければ PM に「次何やる？」を問い合わせ → タスク生成
  3. pending タスクを Worker に割り当て（status → running）
  4. Worker の完了を待つ
  5. 結果を記録（status → done/failed, Observable Facts保存）
  6. PM に結果を通知 → 次タスク生成判断
}
```

**待機戦略:**
- タスク実行完了後 → 即座に次タスクを取得（待機なし）
- キュー空でPMに問い合わせ → PM応答後に即実行
- PM問い合わせも「タスクなし」を返した場合 → `IDLE_INTERVAL`（デフォルト60秒）待機後に再問い合わせ

**エラーハンドリング:**
- Worker失敗（exit_code !== 0）→ タスクをfailedにしてPMに報告、次タスクへ進む
- PM呼び出し失敗（CLIエラー）→ `PM_RETRY_INTERVAL`（デフォルト30秒）後にリトライ、3回連続失敗で一時停止（`COOLDOWN_INTERVAL`: 5分）
- レート制限到達 → 指数バックオフ（60s → 120s → 300s → 最大600s）で待機後に自動再開
- 致命的エラー（DB破損、worktree操作不能）→ ループ停止、エラーログ出力、通知（将来）

#### PM Agent
Claude Code CLI headlessモードで実行。プロジェクトの状態を見てタスクを生成する。

```typescript
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const { stdout } = await execFileAsync("claude", [
  "-p", buildPmPrompt(context),
  "--allowedTools", "Read,Glob,Grep",
  "--output-format", "json",
  "--max-turns", String(config.PM_MAX_TURNS),
], { cwd: projectRoot })

const result = JSON.parse(stdout)
```

PMの特徴：
- 読み取り専用ツールのみ許可（コードを変更しない）
- `--output-format json` でJSON応答を取得、パースしてタスクリストを抽出
- Max plan認証で定額内実行

**PMへの入力コンテキスト構築:**

PMの prompt は以下の情報を結合して構築する。

```typescript
function buildPmPrompt(context: PmContext): string {
  return [
    "## プロジェクト定義",
    context.claudeMd,        // CLAUDE.md全文
    context.readme,          // README.md全文（あれば）
    "",
    "## 直近の完了タスク（最新5件）",
    context.recentDone.map(t =>
      `- [done] ${t.title}: ${summarizeFacts(t.result)}`
    ).join("\n"),
    "",
    "## 失敗タスク（未解決）",
    context.failedTasks.map(t =>
      `- [failed] ${t.title}: ${t.result?.exit_code}`
    ).join("\n"),
    "",
    "## 現在のキュー",
    context.pendingTasks.map(t =>
      `- [pending] ${t.title}`
    ).join("\n"),
    "",
    "上記を踏まえ、次に実装すべきタスクを優先度順に生成せよ。",
    "既にpendingのタスクと重複しないこと。",
    "1タスク = 1 Workerが30ターン以内で完了できる粒度にすること。",
    "",
    "以下のJSON形式で回答せよ:",
    '{"tasks": [{"title": "...", "description": "...", "priority": 1}], "reasoning": "..."}',
  ].join("\n")
}
```

**PM出力のパース:**

CLIの `--output-format json` はClaude Code自体のメタ情報を含むJSONを返す。
最終的なテキスト応答からタスクリストJSONを抽出する。

```typescript
type PmOutput = {
  tasks: { title: string; description: string; priority: number }[]
  reasoning: string
}

function parsePmOutput(cliOutput: string): PmOutput {
  const json = JSON.parse(cliOutput)
  // result フィールドからテキストを取得し、JSONブロックを抽出
  const text = json.result
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error("PM output does not contain valid JSON")
  return JSON.parse(match[0])
}
```

#### Worker Agent
Claude Code CLI headlessモードで実行。1タスクを受け取り、worktreeで隔離実行する。

```typescript
import { spawn } from "node:child_process"

function runWorker(task: Task, worktreePath: string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", [
      "-p", task.description,
      "--allowedTools", "Read,Edit,Write,Bash,Glob,Grep",
      "--output-format", "json",
      "--max-turns", String(config.WORKER_MAX_TURNS),
    ], {
      cwd: worktreePath,  // git worktreeで隔離
      timeout: config.WORKER_TIMEOUT_MS,
    })

    let stdout = ""
    proc.stdout.on("data", (chunk) => {
      stdout += chunk
      appendLog(task.id, "worker", chunk.toString())  // リアルタイムログ記録
    })

    proc.on("close", (code) => {
      resolve({ exit_code: code ?? 1, stdout })
    })
    proc.on("error", reject)
  })
}
```

Workerの特徴：
- worktreeで物理隔離（メインブランチを汚さない）
- タスクごとにブランチを切る
- Max plan認証で定額内実行
- spawnで起動し、stdoutをリアルタイムでtask_logsに記録

**セキュリティ制約:**
- `cwd` は必ずworktreeパスを指定（メインリポジトリ直下では実行しない）
- `.worktrees/` ディレクトリは `.gitignore` に追加済み
- Workerが生成したコードのマージはPM判断 or 人間承認を経由（Phase 1は人間承認）
- ネットワークアクセスを伴うBashコマンドは許可（pnpm install等に必要）。ただし将来的にallow/denyリストで制御可能にする
- `--max-turns` + spawnの `timeout` で暴走を二重に防止

#### Task Queue（SQLite）

```sql
CREATE TABLE tasks (
  id         TEXT PRIMARY KEY,  -- ULID
  title      TEXT NOT NULL,
  description TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  priority   INTEGER DEFAULT 0,
  parent_id  TEXT REFERENCES tasks(id),  -- PMが分解した親タスク
  created_by TEXT NOT NULL,     -- 'pm' | 'human'
  assigned_to TEXT,             -- worker id
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  result     TEXT               -- JSON: Observable Facts
);

CREATE TABLE task_logs (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id),
  agent      TEXT NOT NULL,     -- 'pm' | 'worker-0' | 'worker-1'
  message    TEXT NOT NULL,     -- CLIのstdout
  timestamp  TEXT NOT NULL
);
```

#### Observable Facts（完了判定）
AIの自己申告に依存せず、客観的な事実で判定する。

```typescript
type ObservableFacts = {
  exit_code: number           // Claude Code CLIの終了コード
  files_changed: string[]     // git diff --name-only
  diff_stats: { additions: number; deletions: number }
  test_result?: {
    passed: number
    failed: number
    exit_code: number
  }
  lint_result?: {
    errors: number
    exit_code: number
  }
  branch: string              // 作業ブランチ名
  commit_hash?: string        // 作成されたコミット
}
```

Workerの実行完了後、daemonが以下を自動収集：
1. worktreeで `git diff --stat` を実行
2. `pnpm test` を実行（あれば）
3. `pnpm lint` を実行（あれば）
4. 結果をtasks.resultにJSON保存

### 設定管理

daemon起動時に読み込む設定。環境変数 → config.ts のデフォルト値の順でフォールバック。

```typescript
type Config = {
  // 対象リポジトリ
  PROJECT_ROOT: string          // default: process.cwd()

  // エージェント制限
  WORKER_MAX_TURNS: number      // default: 30
  WORKER_TIMEOUT_MS: number     // default: 600000（10分）
  PM_MAX_TURNS: number          // default: 5

  // ループ制御
  IDLE_INTERVAL_SEC: number     // default: 60（キュー空時の待機秒数）
  PM_RETRY_INTERVAL_SEC: number // default: 30
  COOLDOWN_INTERVAL_SEC: number // default: 300（連続失敗時）
  WORKER_CONCURRENCY: number   // default: 1（並列Worker数）

  // DB
  DB_PATH: string               // default: ./devpane.db

  // daemon
  API_PORT: number              // default: 3001
}
```

設定ファイルは作らない。環境変数と `src/config.ts` のデフォルト値で管理する。
複雑な設定UIはPhase 2以降。

### 技術選定

| 領域 | 選定 | 理由 |
|------|------|------|
| エージェント実行 | Claude Code CLI headless (`claude -p`) | Max plan定額で回せる、CLIツール群がそのまま使える |
| daemon | Hono + Node.js | 軽量、TypeScript native |
| DB | better-sqlite3 | 同期API、daemon内完結、ファイル1つ |
| タスクID | ULID | 時系列ソート可能、衝突なし |
| worktree | git worktree | 標準gitコマンド、追加依存なし |
| プロセス管理 | systemd user unit | ArchLinux標準、自動再起動 |

### 自律ループのフロー

```
人間: pnpm start (最初で最後の操作)
  │
  ▼
Scheduler: 起動
  │
  ▼
PM: CLAUDE.md + README を読む
  │
  ├─→ タスクA を生成 → Queue
  ├─→ タスクB を生成 → Queue
  └─→ タスクC を生成 → Queue
  │
  ▼
Worker: タスクA を取得
  │
  ├─→ worktree作成 (devpane-task-A ブランチ)
  ├─→ Claude Code CLI headless で実行
  ├─→ Observable Facts 収集
  └─→ status → done, facts保存
  │
  ▼
Scheduler: PM に結果を通知
  │
  ▼
PM: 結果を見る
  ├─→ 成功 → 次タスク生成 or マージ判断
  └─→ 失敗 → リトライタスク生成 or スキップ
  │
  ▼
Worker: 次タスクを取得 → ...（無限ループ）
```

### worktree隔離の流れ

```bash
# タスク開始時
git worktree add .worktrees/task-{id} -b devpane/task-{id}

# Worker実行（cwdをworktreeに指定）
# → ファイル変更はworktree内に閉じる

# タスク完了時（成功の場合）
cd .worktrees/task-{id}
git add -A && git commit -m "task-{id}: {title}"

# マージ判断後（PM or 人間が承認）
git checkout main && git merge devpane/task-{id}
git worktree remove .worktrees/task-{id}
git branch -d devpane/task-{id}
```

## モノレポ構成

```
devpane/
├── packages/
│   ├── daemon/
│   │   ├── src/
│   │   │   ├── index.ts          # エントリポイント（Hono起動 + Scheduler開始）
│   │   │   ├── scheduler.ts      # ループ制御・heartbeat
│   │   │   ├── pm.ts             # PM Agent
│   │   │   ├── worker.ts         # Worker Agent
│   │   │   ├── db.ts             # SQLite接続・マイグレーション
│   │   │   ├── facts.ts          # Observable Facts収集
│   │   │   ├── worktree.ts       # git worktree操作
│   │   │   └── api/
│   │   │       ├── tasks.ts      # GET /tasks, POST /tasks
│   │   │       └── logs.ts       # GET /logs, WebSocket /ws
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── web/                       # Phase 2
│   │   └── ...
│   └── shared/
│       ├── src/
│       │   └── types.ts          # Task, ObservableFacts等の型定義
│       ├── package.json
│       └── tsconfig.json
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## タスク分解（Phase 1: 自律ループを回す）

### Step 1: 基盤（依存なし）
- [ ] **1-1. pnpmモノレポ初期化**
  - pnpm-workspace.yaml, ルートpackage.json, tsconfig.json
  - packages/daemon, packages/shared のpackage.json + tsconfig.json
  - 完了条件: `pnpm install` が通る
- [ ] **1-2. shared型定義**
  - Task, ObservableFacts, Config の型をpackages/shared/src/types.tsに定義
  - 完了条件: daemonからimportできる

### Step 2: データ層（← Step 1）
- [ ] **2-1. SQLiteセットアップ**
  - better-sqlite3でDB接続、tasks + task_logsテーブル作成
  - CRUD関数: createTask, getNextPending, updateStatus, appendLog
  - 完了条件: テストでCRUDが動く
- [ ] **2-2. worktree操作モジュール**
  - createWorktree(taskId), removeWorktree(taskId), listWorktrees()
  - child_process.execSyncでgit worktreeコマンドを実行
  - 完了条件: worktreeの作成・削除が動く

### Step 3: エージェント層（← Step 2）
- [ ] **3-1. Worker Agent**
  - `claude -p` をspawnしてworktree内で実行
  - stdoutをリアルタイムでtask_logsに記録
  - 完了条件: 手動で1タスク（例: "READMEにバッジを追加"）を実行して完了する
- [ ] **3-2. Observable Facts収集**
  - Worker完了後にgit diff, pnpm test, pnpm lintを実行
  - 結果をObservableFacts型に整形してtasks.resultに保存
  - 完了条件: 3-1の結果からfactsが収集・保存される
- [ ] **3-3. PM Agent**
  - buildPmPrompt()でコンテキスト構築
  - JSON出力をパースしてタスクリストを抽出
  - 返されたタスクをSQLiteに投入
  - 完了条件: PMがDevPaneのコードを読んでタスクを3個以上生成する

### Step 4: 統合（← Step 3）
- [ ] **4-1. Scheduler**
  - PM → Queue → Worker → Facts → PM のループ制御
  - エラーハンドリング、待機戦略、レート制限対応
  - 完了条件: `pnpm start` でループが3周以上回る
- [ ] **4-2. Hono APIエンドポイント**
  - GET /tasks（一覧）, GET /tasks/:id（詳細）, GET /logs/:taskId
  - 完了条件: curlで叩いてJSON応答が返る

### Step 5: 運用（← Step 4）
- [ ] **5-1. systemd user unit**
  - devpane.service作成、自動再起動設定
  - 完了条件: `systemctl --user start devpane` で起動、kill後に自動復帰
- [ ] **5-2. 自己開発テストラン**
  - DevPane自身を対象にdaemonを起動し、放置で回す
  - 完了条件: 人間が介入せずにタスクが3個以上完了する

## リスク・懸念事項

| リスク | 影響 | 対策 |
|--------|------|------|
| PMのタスク生成が的外れ | 無駄なコード変更が増える | maxTurns/maxBudget制限、最初は保守的なsystemPromptで |
| Max planレート制限 | ループが頻繁に待機状態になる | ループ間隔の調整、レート制限到達時の指数バックオフ |
| worktreeのコンフリクト | マージ失敗 | 小さなタスク粒度を維持、PM側で依存関係を考慮 |
| Worker hang（無限ループ） | リソース占有 | maxTurns上限、タイムアウト設定 |
| 自己開発で壊れる | daemon自体が動かなくなる | worktree隔離で本体を直接変更しない、マージは人間承認（初期） |

## 未決事項

- PMのsystem promptの具体的な内容（プロジェクト分析の深さ、タスク粒度の指針）
- マージの自動化タイミング（Phase 1は人間承認？PMに任せる？）
- Max planのティア選択（$100/月 vs $200/月、レート制限の差異）
- Worker並列化の実装時期（Phase 1後？）
- Web UI（Phase 2）の開始タイミング
- GitHub Issues同期の優先度
- 通知（Slack/Discord）の実装時期
