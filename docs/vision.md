# DevPane — ビジョンと設計方針

## コンセプト

**寝てる間に勝手に動くAI開発チーム。起きたらDiscordに進捗報告が来ている。**

人間の役割は「方針を決める」と「報告を見て一言返す」だけ。
タスク生成・テスト設計・実装・レビュー・PR管理はすべて自律で回る。

## 設計原理

3つの原理がDevPaneの設計全体を貫く。

### 原理1: LLMは変換器。制御はコード。

LLMに判断や分岐をさせない。LLMは「入力→出力の変換」だけを担い、
フロー制御・状態遷移・Gate判定はすべて決定論的なコードで行う。

```
LLMの役割: 方針 → 構造化仕様、仕様 → テスト、テスト → 実装
コードの役割: 状態遷移、Gate判定、リトライ、停止、スケジューリング
```

OpenClawの教訓: "Don't orchestrate with LLMs. Every time I tried to put
flow control in a prompt...I introduced a failure mode."

### 原理2: Blackboardが真実の単一ソース

SQLiteが共有知識ベース（Blackboard）。エージェントは状態を内部に持たず、
Blackboardに読み書きするだけ。どのエージェントがcrashしてもBlackboardから復元できる。

```
SQLite (Blackboard)
├── tasks        — タスクの状態と結果
├── task_logs    — 型付きイベントログ
├── memories     — feature / decision / lesson
├── metrics      — SPC管理図用の時系列データ
└── improvements — 自己改善の履歴と効果測定
```

### 原理3: 契約（Contract）で境界を守る

エージェント間の入出力はZodスキーマで検証する。型が通らないものはパイプラインに入れない。
Design by Contractの原則: 事前条件・事後条件・不変条件を実行可能コードとして定義する。

```
PMの出力 → Zodスキーマで検証 → 不正ならRecycle
Workerの出力 → Observable Factsで検証 → 不正ならRecycle/Kill
ふりかえりの出力 → 改善スキーマで検証 → 不正なら棄却
```

## 人間のワークフロー

```
朝 or 帰宅後:
  1. DiscordでPR Agent日報を見る
     | # | タスク        | 変更      | テスト | リスク | 判定     |
     |---|--------------|-----------|--------|--------|---------|
     | 1 | チャット機能   | +120/-3   | 全通過 | 低     | ✅推奨  |
     | 2 | DB移行        | +45/-200  | 1失敗  | 高     | ⚠️要確認 |
     | 3 | README更新    | +5/-2     | -      | 無     | ✅推奨  |

  2. 「1,3マージ、2クローズ」と返信 ← これだけ

  3. 方針変更があればCLAUDE.md編集 or チャットで一言
     「テスト周り強化して」→ PMの記憶に入る

  4. 閉じて放置 → またAIが回り始める
```

**人間はdiffを読まない。** PR Agentが安全性を判定して推奨を出す。
人間はパッと見でおかしい箇所があれば番号指定でクローズするだけ。

## 2つのパイプライン

AI間のコミュニケーションと人間向けのドキュメントは目的が異なる。
分離して並行で回す。

### 開発パイプライン（AI→AI、構造化データ）

AI間は**構造化仕様**でやりとりする。自然言語の曖昧さを排除する。

```
PM → 構造化仕様(JSON) → Gate 1
  → テスター: 仕様からテスト自動生成 → Gate 2
  → Worker: テストを通す実装(TDD) → Gate 3
  → PR作成 → 記憶更新
```

PMの出力は人間が読む仕様書ではなく、テスターとWorkerが機械的に処理できる構造化データ：

```json
{
  "task_id": "01KKFG...",
  "title": "チャットメッセージ送信",
  "spec": {
    "functions": [{
      "name": "sendMessage",
      "input": { "content": "string, minLength: 1, maxLength: 1000" },
      "output": { "id": "ulid", "timestamp": "iso8601" },
      "invariants": ["content.trim().length > 0"],
      "side_effects": ["INSERT INTO messages", "broadcast via WebSocket"]
    }],
    "endpoints": [{
      "method": "POST",
      "path": "/api/chat/messages",
      "request_body": { "content": "string" },
      "response": { "id": "string", "timestamp": "string" },
      "status_codes": { "200": "成功", "400": "空文字/超過" }
    }],
    "constraints": [
      "既存のWebSocket接続を再利用する",
      "task_logsテーブルは変更しない"
    ]
  }
}
```

テスターはこのJSONからテストを機械的に生成。Workerはinvariantsを満たすコードを書く。
監査はinvariantsの充足を検証。**曖昧さが構造的に入り込めない。**

### ドキュメントパイプライン（AI→人間、自然言語）

開発パイプラインと独立して並行で回す。

```
入力: 開発パイプラインの成果物（構造化仕様、diff、テスト結果）
出力: 人間が読めるドキュメント
  → README更新
  → 変更履歴（CHANGELOG）
  → アーキテクチャ図の更新
  → 判断の経緯の記録
```

開発を止めずにドキュメントを常に最新に保つ。
人間が「今このプロジェクト何ができるの」を把握するためのもの。

## 開発パイプライン詳細

### 方法論

V字モデル × カンバン × TDD × Stage-Gate のハイブリッド。

- **V字モデル**: 仕様とテストを対応させる。左辺（仕様）と右辺（検証）のペアリング
- **カンバン**: スプリントなしの連続フロー。WIP制限で流量制御
- **TDD**: テスト先行。Workerはテストを通す実装だけをする
- **Stage-Gate**: 各監査ステップに明確なGo/Kill/Recycle判定基準

### パイプラインステップ

#### Step 1: PM — 構造化仕様生成
```
入力: CLAUDE.md + 記憶 + タスク履歴
出力: 構造化仕様JSON（関数定義、invariants、制約条件）
検証: Zodスキーマで構造を検証（原理3: Contract）
許可ツール: Read, Glob, Grep
```

#### Step 2: Gate 1 — 方針チェック
```
入力: 構造化仕様 + 記憶 + 方針
判定: Go / Kill（方針逸脱、既存feature破壊、重複）/ Recycle（仕様修正要）
許可ツール: Read, Glob, Grep
```

Kill時はタスクを却下し理由を記憶に記録。Recycleは仕様修正してStep 1に戻す。

#### Step 3: テスター — テスト生成
```
入力: 構造化仕様JSON
出力: テストファイル（仕様のinvariants/endpoints/constraintsから機械的に生成）
許可ツール: Read, Edit, Write, Glob, Grep
```

#### Step 4: Gate 2 — 仕様-テスト照合
```
入力: 構造化仕様 + テストファイル
判定: Go / Recycle（テスト漏れ、仕様との不整合）
許可ツール: Read, Glob, Grep
```

仕様のinvariantsに対応するテストが存在するか、制約条件が検証されているかを確認。

#### Step 5: Worker — 実装（TDD）
```
入力: テストファイル + 構造化仕様
出力: テストが通る実装コード
許可ツール: Read, Edit, Write, Bash, Glob, Grep
```

worktreeで隔離実行。テスト全通過 = 仕様を満たしている。

#### Step 6: Gate 3 — 成果物判定
```
入力: Observable Facts（exit code, diff, テスト結果, lint結果）
判定: Go(PR作成) / Kill(破棄) / Recycle(Worker差し戻し)
```

ルールベース + 軽量Claude判定のハイブリッド：
- テスト全通過 + diff規模妥当 → Go（ルールベース）
- テスト失敗 or 既存機能破壊 → Recycle or Kill（Claude判定）

#### Step 7: PR作成 + 記憶更新

PR作成後、構造化仕様から記憶を更新：
- 新規関数/エンドポイント → `feature` として記録
- 制約条件 → `decision` として記録

## 自己進化ループ

DevPaneの本質的な差別化。プロセスが自分自身を改善し続ける上方スパイラル。
Toyotaのなぜなぜ分析 × サイバネティクスの制御理論 × ダブルループ学習の統合。

### 3段階の学習

```
シングルループ: タスク失敗 → 修正 → リトライ
  「テストが落ちた → コード直した」
  → パイプラインの通常動作

ダブルループ: 同じ失敗パターン → プロセスを変える
  「テストが落ち続ける → PMの仕様が曖昧だった → 仕様テンプレートを変更」
  → なぜなぜ分析による改善

トリプルループ: 改善プロセス自体を見直す
  「仕様テンプレート変えても改善しない → 分析の粒度が粗い → 分析方法を変更」
  → 自己進化
```

### 失敗の構造化記録

自由テキストではなく、根本原因を構造化して記録する。

```json
{
  "task_id": "01KKFG...",
  "stage": "worker",
  "root_cause": "spec_ambiguity",
  "why_chain": [
    "テストが失敗した",
    "未定義のAPIを呼んでいた",
    "仕様にAPI一覧がなかった",
    "PMテンプレートにAPI列挙の項目がない"
  ],
  "gates_passed": ["gate1", "gate2"],
  "severity": "process_gap"
}
```

root_causeの分類体系:
| 分類 | 意味 | 例 |
|------|------|-----|
| `spec_ambiguity` | 仕様の曖昧さ | invariantsが不足、制約条件の漏れ |
| `test_gap` | テストの漏れ | エッジケース未検証、統合テスト不足 |
| `scope_creep` | 範囲逸脱 | 仕様外のファイルを変更 |
| `api_misuse` | 既存API誤用 | 存在しないメソッド呼び出し |
| `env_issue` | 環境問題 | rate limit、タイムアウト、依存 |
| `regression` | 既存機能の破壊 | 他のテストが壊れた |

### なぜなぜ分析Agent（ダブルループ）

N件（デフォルト10件）のタスク完了ごとに自動実行。

```
入力:
  - 直近N件の構造化失敗記録
  - 現在のGateチェック項目
  - 現在のPMテンプレート
  - 現在の改善履歴

処理:
  1. 失敗パターンの集計（root_causeごとの頻度）
  2. 最頻パターンに対してなぜなぜ5回
  3. 「どのGateをすり抜けたか」の分析
  4. 対策を構造化出力

出力（Zodスキーマで検証）:
  {
    "analysis": {
      "top_failure": "spec_ambiguity",
      "frequency": "4/10",
      "why_chain": ["...", "...", "...", "...", "..."]
    },
    "improvements": [
      {
        "target": "gate1",
        "action": "add_check",
        "description": "API存在確認チェックを追加",
        "check_code": "spec.functions.every(f => existsInCodebase(f.name))"
      },
      {
        "target": "pm_template",
        "action": "add_field",
        "field": "required_apis",
        "description": "使用する既存APIの明示列挙を必須化"
      }
    ]
  }
```

### 効果測定Agent（トリプルループ）

改善適用後M件（デフォルト10件）で自動実行。

```
入力:
  - 改善前N件の失敗率・パターン分布
  - 改善後M件の失敗率・パターン分布
  - 適用した改善内容

判定:
  改善（失敗率低下） → lesson記録、改善を恒久化
  不変（失敗率横ばい） → 改善を撤回、分析粒度を上げて再分析
  悪化（失敗率上昇） → 改善を即時撤回 + アラート

出力:
  {
    "improvement_id": "...",
    "before_failure_rate": 0.4,
    "after_failure_rate": 0.1,
    "verdict": "effective",
    "action": "permanent"
  }
```

悪化のケースが重要: **改善が改悪になっていないかをデータで検証する。**
これがトリプルループの核心で、改善プロセス自体の品質を担保する。

### 改善の適用先

なぜなぜ分析Agentが書き換えられる対象を限定する（安全装置）。

| 対象 | 書き換え可能な範囲 | 例 |
|------|-------------------|-----|
| Gate チェック項目 | チェックの追加・閾値の変更 | diff行数上限を500→300に |
| PM テンプレート | フィールドの追加・指示の補強 | required_apisフィールドを追加 |
| Worker 指示 | 制約条件の追加 | 「500行以上は分割せよ」 |
| SPC 閾値 | UCL/LCLの調整 | コスト上限を$0.50→$0.30に |

**書き換えられない対象**: パイプラインの構造自体、DB スキーマ、セキュリティ設定。
これらを変える場合は人間の承認が必要。

### Toyotaのなぜなぜ分析との対応

```
Toyota:                          DevPane:
現場で不良発生                    → タスクfailed
なぜ？ → 部品が規格外             → root_cause分類
なぜ？ → 検査で見逃した           → どのGateをすり抜けた？
なぜ？ → 検査項目になかった        → Gateのチェック項目の欠落
なぜ？ → 新素材を想定してなかった   → PMの仕様に前提条件の漏れ
対策: 検査項目追加 + 素材変更時     → Gate更新 + PMテンプレート更新
      のチェックリスト追加
効果確認: 不良率の推移を管理図で   → 効果測定Agentが自動判定
```

## 恒常性維持（24時間狂わない仕組み）

サイバネティクスの制御理論を応用。設定値からの逸脱を検知し、自動修正する。

### SPC管理図

プロセスの健全性を時系列で監視。ドリフトを故障前に検出する。

```
監視指標:
  - タスクあたりのcost_usd（移動平均 + UCL/LCL）
  - タスクあたりの実行時間
  - diff規模（additions + deletions）
  - Gate通過率
  - 連続失敗数

異常検出ルール（Western Electric Rules準拠）:
  - 1点がUCL/LCL外 → 即時アラート
  - 連続7点が平均の同じ側 → トレンド検出
  - 連続3点中2点が2σ超 → 早期警告
```

### フロー制御

| 制御 | 由来 | 実装 |
|------|------|------|
| WIP制限 | カンバン | 未マージPR ≥ 5 → スケジューラ停止 |
| ジドウカ | TPS | 連続失敗3回 → 停止 + Discord通知 |
| プル型 | TPS/JIT | キュー空の時だけPM起動 |
| Circuit Breaker | 分散システム | rate limit → open → backoff → half-open → 1件試行 |
| ボトルネック計測 | TOC | 各ステージの所要時間をDB記録 → 最遅ステージに集中改善 |

### ポカヨケ（構造的にミスを不可能にする）

| 対象 | ポカヨケ | 効果 |
|------|---------|------|
| PM出力 | Zodスキーマでバリデーション | 構造不正な仕様は入らない |
| Worker | worktree隔離 | mainを壊せない |
| diff規模 | additions > 500 → 自動fail | 巨大PRの防止 |
| 自己改善 | パイプライン構造の書き換え禁止 | 暴走の防止 |

## PR Agent（日次バッチ、ループ外）

開発パイプラインとは独立して日次で実行。

```
入力: 未マージPR一覧 + 各PRのdiff + テスト結果 + 構造化仕様
出力: Discordへの日報テーブル
```

1. 各PRの安全性を評価（diff規模、テスト結果、既存機能への影響）
2. マージ推奨 / 要確認 / 非推奨を判定
3. Discordにテーブル形式で投稿
4. 人間の返信を受けてマージ/クローズ実行
5. 結果を記憶にフィードバック
   - マージ → `remember('decision', ...)`
   - クローズ → `remember('lesson', ...)`

## 人間とAIの役割分担

```
人間（経営者）
  └─ 方針を投げる。日報を見て番号返す。たまにWeb UIで覗く。

PM（プロジェクトマネージャー）
  └─ 方針→構造化仕様。記憶の読み取り。LLMとして変換だけ行う。

Gate（品質ゲート）= コード
  └─ Gate 1: 方針チェック（Go/Kill/Recycle）
  └─ Gate 2: 仕様-テスト照合
  └─ Gate 3: Observable Facts判定
  └─ 判定ロジックはコード。LLMには変換だけ委託。

テスター（QA）
  └─ 構造化仕様→テストコード。LLMとして変換だけ行う。

Worker（実装者）
  └─ テストを通す実装。LLMとして変換だけ行う。

なぜなぜ分析Agent
  └─ 失敗パターン→改善提案。LLMとして分析だけ行う。
  └─ 適用はコードが行う。

効果測定Agent
  └─ 改善前後の比較→判定。データ駆動。

ドキュメントチーム
  └─ 成果物→人間向けドキュメント生成（並行稼働）

PR Agent（報告役）
  └─ 日次PR要約、マージ/クローズ実行、記憶フィードバック
```

## 安全装置

| 層 | 仕組み | 目的 |
|----|--------|------|
| 構造化仕様 | AI間は自然言語を使わない | 曖昧さの排除 |
| Contract | Zodスキーマで入出力を検証 | 不正データの排除 |
| worktree隔離 | mainを直接触らない | コードの安全性 |
| 3段Gate | 方針/テスト/成果物で3回検証 | 品質の段階的担保 |
| TDD | テスト先行で実装 | 仕様充足の保証 |
| PR出力 | 自動マージしない | 成果物の追跡性 |
| PR Agent判定 | リスク評価付き日報 | 人間の判断コスト削減 |
| 記憶層 | SQLiteにfeature/decision/lesson | 「作って壊す」防止 |
| SPC管理図 | 移動平均+UCL/LCLで異常検出 | ドリフトの早期発見 |
| なぜなぜ分析 | 失敗パターン→プロセス改善 | 上方スパイラル |
| 効果測定 | 改善の効果をデータで検証 | 改善が改悪にならない保証 |
| 改善範囲制限 | パイプライン構造は書き換え不可 | 自己改善の暴走防止 |
| WIP制限 | 未マージPR上限 | 生産過剰の防止 |
| ジドウカ | 連続失敗で自動停止 | 暴走防止 |
| Circuit Breaker | rate limit検出→遮断→試行再開 | カスケード障害の防止 |

## 記憶層

### テーブル

```sql
CREATE TABLE memories (
  id             TEXT PRIMARY KEY,
  category       TEXT NOT NULL,  -- 'feature' | 'decision' | 'lesson'
  content        TEXT NOT NULL,
  source_task_id TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- 自己改善の履歴
CREATE TABLE improvements (
  id              TEXT PRIMARY KEY,
  trigger_analysis TEXT NOT NULL,   -- なぜなぜ分析の結果JSON
  target          TEXT NOT NULL,    -- 'gate1' | 'gate2' | 'gate3' | 'pm_template' | ...
  action          TEXT NOT NULL,    -- 適用した変更内容
  applied_at      TEXT NOT NULL,
  status          TEXT NOT NULL,    -- 'active' | 'reverted' | 'permanent'
  before_metrics  TEXT,             -- 適用前の指標JSON
  after_metrics   TEXT,             -- 適用後の指標JSON
  verdict         TEXT              -- 'effective' | 'ineffective' | 'harmful'
);
```

### 書き込みルール

| トリガー | category | 書き込み元 |
|---------|----------|-----------|
| タスク成功、新規ファイル | feature | ルールベース（機械的） |
| ファイル削除 | - | forget（機械的） |
| 構造化仕様のconstraints | decision | Gate 3通過時 |
| PRマージ | decision | PR Agent |
| PRクローズ | lesson | PR Agent |
| 人間のチャット指示 | decision/lesson | Web UI → 記憶API |
| 監査のKill/Recycle理由 | lesson | Gate 1/2/3 |
| なぜなぜ分析の結果 | lesson | なぜなぜ分析Agent |
| 効果測定で有効と判定 | decision | 効果測定Agent |

## 実装の役割マッピング

全役割が同じClaude CLI呼び出しの引数違い。常駐エージェントはゼロ。

| 役割 | 実体 | 許可ツール | コスト |
|------|------|-----------|--------|
| PM | `claude -p` | Read,Glob,Grep | 軽量 |
| Gate 1/2/3 | コード + `claude -p`(必要時) | Read,Glob,Grep | 軽量 |
| テスター | `claude -p` (worktree内) | Read,Edit,Write,Glob,Grep | 中量 |
| Worker | `claude -p` (worktree内) | Read,Edit,Write,Bash,Glob,Grep | 重量 |
| なぜなぜ分析 | `claude -p` | Read,Glob,Grep | 軽量（N件ごと） |
| 効果測定 | コード（LLM不要） | - | 極軽量 |
| ドキュメント | `claude -p` | Read,Write,Glob,Grep | 軽量 |
| PR Agent | `claude -p` + `gh` | Read,Glob,Grep | 軽量（日次） |

## 型付きイベントログ

現在の自由テキストログを型付きイベントに移行。Event Sourcing liteとして
Blackboardの監査証跡と自己改善の入力データを兼ねる。

```typescript
type AgentEvent =
  | { type: "task.created"; taskId: string; by: "pm" | "human" }
  | { type: "task.started"; taskId: string; workerId: string }
  | { type: "task.completed"; taskId: string; facts: ObservableFacts }
  | { type: "task.failed"; taskId: string; error: StructuredFailure }
  | { type: "gate.passed"; taskId: string; gate: "gate1" | "gate2" | "gate3" }
  | { type: "gate.rejected"; taskId: string; gate: string; verdict: "kill" | "recycle"; reason: string }
  | { type: "worker.rate_limited"; backoffSec: number }
  | { type: "pm.invoked"; reason: "queue_empty" | "scheduled" }
  | { type: "improvement.applied"; improvementId: string; target: string }
  | { type: "improvement.reverted"; improvementId: string; reason: string }
  | { type: "pr.created"; taskId: string; url: string }
  | { type: "spc.alert"; metric: string; value: number; ucl: number }
```

## 運用構成

### Phase 1（現在）: ローカル動作確認
```
ローカルマシン
├── daemon (port 3001) — 開発パイプライン
├── web (port 3000) — 監視UI
└── claude CLI (Max plan)
```

### Phase 2: VPS常駐 + Discord連携
```
apps-vps (133.18.124.16)
├── daemon — 24/7稼働（開発パイプライン + 自己改善ループ）
├── PR Agent — cron日次実行
├── web — Tailscale経由でアクセス
├── claude CLI — Max plan認証
├── Discord Bot — 日報 + マージ指示受付
└── systemd — プロセス管理・自動再起動
```

## Web UI — 監視と介入

Web UIは「オフィスの窓」。チームが働いてるのを覗いて、おかしかったら介入する。

### 監視（見る）

| 画面 | 見えるもの | 判断材料 |
|------|-----------|---------|
| ダッシュボード | タスク一覧、ステータス、コスト | 全体の健康状態 |
| パイプライン | 各ステップの進行状況、Gate判定結果 | どこで詰まっているか |
| タスク詳細 | 構造化仕様、テスト、Workerログ、diff | 個別タスクの状態 |
| 記憶一覧 | feature/decision/lesson | PMの認識がズレてないか |
| メトリクス | SPC管理図、Gate通過率、コスト推移 | プロセスの健全性 |
| 自己改善履歴 | 適用した改善、効果測定結果 | 改善ループの健全性 |

### 介入レベル

```
レベル0: 放置（正常系）
  → Discordの日報だけ見る。番号でマージ指示。

レベル1: 方針調整
  → チャットで一言 or CLAUDE.md編集。次サイクルで反映。

レベル2: タスク介入
  → Web UIから不要タスクをキャンセル、手動タスクを追加。

レベル3: 緊急停止
  → スケジューラ一時停止。状況を確認して再開。

レベル4: 記憶修正
  → PMの記憶を直接編集。「Xは実装済み」「Yは不要」を明示。

レベル5: 改善介入
  → 自己改善の結果を手動で撤回。改善の方向性を指示。
```

## 原則

1. **LLMは変換器。制御はコード。** LLMに分岐や判断をさせない。入力→出力の変換だけ。
2. **Blackboardが真実。** SQLiteが唯一のソース。エージェントは内部状態を持たない。
3. **契約で境界を守る。** Zodスキーマで入出力を検証。型が通らないものは棄却。
4. **プロセスが自分を改善する。** なぜなぜ分析→改善→効果測定の上方スパイラル。
5. **改善を検証する。** 改善が改悪でないことをデータで証明する。改善の暴走も防ぐ。
6. **人間は経営者。** 方針を決めて日報を見る。タスク分解もレビューもAIがやる。
7. **24時間止まらない。** 人間の応答を待たない。SPC管理図で恒常性を維持する。
8. **仕組みで役割を作る。** 同じCLIの呼び出しパターンで役割を分ける。
9. **判断リソースを最小化。** 日報のテーブルを見て番号を返すだけ。diffは読まない。
