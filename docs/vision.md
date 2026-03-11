# DevPane — ビジョンと設計方針

## コンセプト

**寝てる間に勝手に動くAI開発チーム。起きたらDiscordに進捗報告が来ている。**

人間の役割は「方針を決める」と「報告を見て一言返す」だけ。
タスク生成・テスト設計・実装・レビュー・PR管理はすべて自律で回る。

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

### ふりかえり（PDCA Act）

N件（デフォルト10件）のタスク完了ごとに自動実行。

```
入力: 直近N件のタスク結果（成功/失敗/Kill/Recycle統計）
出力: 記憶更新（lesson追加、decision修正）
```

- 失敗パターンの蓄積 → 次のPM仕様生成に反映
- Gate通過率の推移 → プロンプトチューニングの指標
- gptmeのlessonsシステムと同じ発想

### フロー制御

| 制御 | 由来 | 実装 |
|------|------|------|
| WIP制限 | カンバン | 未マージPR ≥ 5 → スケジューラ停止 |
| ジドウカ | TPS | 連続失敗3回 → 停止 + Discord通知 |
| プル型 | TPS/JIT | キュー空の時だけPM起動 |
| ボトルネック計測 | TOC | 各ステージの所要時間をDB記録 → 最遅ステージに集中改善 |

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
  └─ 方針→構造化仕様、記憶管理

監査（品質ゲート）= 仕組み
  └─ Gate 1: 方針チェック（Go/Kill/Recycle）
  └─ Gate 2: 仕様-テスト照合
  └─ Gate 3: Observable Facts判定

テスター（QA）
  └─ 構造化仕様→テストコード自動生成

Worker（実装者）
  └─ テストを通す実装

ドキュメントチーム
  └─ 成果物→人間向けドキュメント生成（並行稼働）

PR Agent（報告役）
  └─ 日次PR要約、マージ/クローズ実行、記憶フィードバック
```

## 安全装置

| 層 | 仕組み | 目的 |
|----|--------|------|
| 構造化仕様 | AI間は自然言語を使わない | 曖昧さの排除 |
| worktree隔離 | mainを直接触らない | コードの安全性 |
| 3段Gate | 方針/テスト/成果物で3回検証 | 品質の段階的担保 |
| TDD | テスト先行で実装 | 仕様充足の保証 |
| PR出力 | 自動マージしない | 成果物の追跡性 |
| PR Agent判定 | リスク評価付き日報 | 人間の判断コスト削減 |
| 記憶層 | SQLiteにfeature/decision/lesson | 「作って壊す」防止 |
| ふりかえり | N件ごとに自動実行 | 継続的プロセス改善 |
| WIP制限 | 未マージPR上限 | 生産過剰の防止 |
| ジドウカ | 連続失敗で自動停止 | 暴走防止 |

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
| ふりかえり | lesson/decision | PDCA Actステップ |

## 実装の役割マッピング

全役割が同じClaude CLI呼び出しの引数違い。常駐エージェントはゼロ。

| 役割 | 実体 | 許可ツール | コスト |
|------|------|-----------|--------|
| PM | `claude -p` | Read,Glob,Grep | 軽量 |
| Gate 1/2/3 | `claude -p` | Read,Glob,Grep | 軽量 |
| テスター | `claude -p` (worktree内) | Read,Edit,Write,Glob,Grep | 中量 |
| Worker | `claude -p` (worktree内) | Read,Edit,Write,Bash,Glob,Grep | 重量 |
| ドキュメント | `claude -p` | Read,Write,Glob,Grep | 軽量 |
| PR Agent | `claude -p` + `gh` | Read,Glob,Grep | 軽量（日次） |
| ふりかえり | `claude -p` | Read,Glob,Grep | 軽量（N件ごと） |

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
├── daemon — 24/7稼働（開発パイプライン + ドキュメントパイプライン）
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
| メトリクス | サイクルタイム、Gate通過率、失敗率 | プロセスの健全性 |

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
```

## 原則

1. **人間は経営者。AIがチーム。** 方針を決めて日報を見る。タスク分解もレビューもAIがやる。
2. **24時間止まらない。** 人間の応答を待たない。
3. **AI間は構造化データ。** 自然言語の曖昧さを排除。人間向けドキュメントは別パイプラインで生成。
4. **品質はパイプラインで担保。** 3段Gate + TDD。単一エージェントに全権限を持たせない。
5. **記憶は事実ベース。** トリガーとルールで管理。LLMの気分に依存しない。
6. **仕組みで役割を作る。** 同じCLIの呼び出しパターンで役割を分ける。エージェントは増やさない。
7. **判断リソースを最小化。** 日報のテーブルを見て番号を返すだけ。diffは読まない。
