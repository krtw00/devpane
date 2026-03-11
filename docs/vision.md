# DevPane — ビジョンと設計方針

## コンセプト

**寝てる間に勝手に動くAI開発チーム。起きたらPRと進捗報告が来ている。**

人間の役割は「方針を決める」と「成果物を承認する」だけ。
タスク生成・実行・テスト・PR作成はすべて自律で回る。

## 人間のワークフロー

```
朝 or 帰宅後:
  1. Discordの進捗報告を読む
  2. GitHubのPR一覧を見る
  3. 良さそうならマージ、不要ならclose
  4. 方針変更があればCLAUDE.mdを編集
  5. 閉じて放置 → またAIが回り始める
```

判断リソースの最小化が重要。人間が確認すべきは：
- PRのdiffが妥当か（壊してないか）
- 開発方向が合っているか（CLAUDE.mdに書いた方針通りか）

それ以外（タスク分解、実装、テスト、ブランチ管理）はAIが勝手にやる。

## 判断リソースの削減

判断が増えすぎると人間がボトルネックになる。以下で抑制する。

### PRの粒度制御
- 1タスク = 1PR = 1つの機能追加 or 修正
- 大きすぎるPRは生成しない（Worker max-turns 30、タスク粒度をPMが制御）

### 進捗報告の簡潔さ
Discord通知はノイズを減らす：
- **成功**: タスク名 + PRリンク + diff stats（1行）
- **失敗**: タスク名 + エラー要約（1行）
- **異常**: レート制限連続、daemon停止等の重大イベントのみ

正常系は「PRが出てる」で十分。失敗もPMが自律リトライするので、連続失敗しない限り通知しない。

### 方針はCLAUDE.mdに集約
PMはCLAUDE.mdを毎サイクル読む。人間が方針を変えたいときは：
1. CLAUDE.mdを編集（「コスト機能は不要」「テストカバレッジを優先」等）
2. push
3. 次のPMサイクルで反映される

チャットでの細かい指示は不要。ドキュメント駆動。

## アーキテクチャ

### 自律ループ

```
Scheduler（永続ループ）
  │
  ├─ PM Agent: CLAUDE.md + 記憶 + タスク履歴 → タスク生成
  │
  ├─ Worker Agent: worktreeで隔離実行 → コミット
  │
  ├─ Observable Facts: exit code, diff, テスト結果を客観収集
  │
  ├─ PR作成: gh pr create でブランチをpush
  │
  ├─ 記憶更新: 新規ファイル→feature記録、削除→forget
  │
  └─ Discord通知: 進捗報告を送信
```

### 安全装置

| 層 | 仕組み | 目的 |
|----|--------|------|
| worktree隔離 | mainを直接触らない | コードの安全性 |
| PR出力 | 自動マージしない | 人間の承認ゲート |
| 記憶層 | SQLiteにfeature/decision/lesson記録 | 「作って壊す」防止 |
| Observable Facts | AI自己申告でなく客観指標で判定 | 完了判定の信頼性 |
| レートリミットbackoff | 指数バックオフで自動待機 | API制限への対応 |
| orphanリカバリ | 起動時にrunning→pendingに戻す | daemon再起動耐性 |

### 記憶層

PMは毎サイクル記憶喪失で起動する。記憶層がないと「作った機能を次のサイクルで消す」が起きる。

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

書き込みルール（機械的、LLM判断なし）：
- タスク成功時、新規ファイル作成 → `feature` として記録
- ファイル削除 → 該当featureを `forget`
- PMプロンプトに全記憶を注入 → 「実装済み機能を壊すな」指示付き

将来拡張：
- `decision`: アーキテクチャ判断の記録（PMが書く）
- `lesson`: 失敗から学んだ教訓（PMが書く）
- sqlite-vecによるセマンティック検索

## 運用構成

### Phase 1（現在）: ローカル動作確認
```
ローカルマシン
├── daemon (port 3001) — 自律ループ
├── web (port 3000) — 監視UI
└── claude CLI (Max plan)
```

### Phase 2: VPS常駐
```
apps-vps (133.18.124.16)
├── daemon — 24/7稼働
├── web — Tailscale経由でアクセス
├── claude CLI — Max plan認証
├── Discord Webhook — 進捗通知
└── systemd — プロセス管理・自動再起動
```

人間はスマホでDiscord通知を見て、必要ならGitHubでPRをマージ。

## 通知設計（Discord Webhook）

### 通知レベル

| レベル | トリガー | 頻度 | 内容 |
|--------|---------|------|------|
| 成功 | タスク完了+PR作成 | タスクごと | `✅ {title} — PR: {url} (+{add}/-{del})` |
| 失敗 | タスク失敗 | タスクごと | `❌ {title} — {error_summary}` |
| 警告 | レート制限3回連続 | 稀 | `⚠️ レート制限連続、{backoff}s待機中` |
| 異常 | daemon停止/DB破損 | 極稀 | `🔴 daemon停止: {reason}` |

### バッチ通知（将来）
タスクが大量に完了する場合、個別通知ではなく日次サマリーに切り替え：
```
📊 DevPane日報
  完了: 5件 / 失敗: 1件 / PR: 4件
  コスト: $2.34
  PR一覧: #12, #13, #14, #15
```

## 原則

1. **人間は方針を決める。AIは実行する。** タスクの具体的な指示は書かない。CLAUDE.mdにゴールを書けばPMが分解する。
2. **正常系で人間を挟まない。** PRが出てくるまで人間は何もしない。異常時だけ通知。
3. **記憶は機械的に管理する。** LLMの気分で記憶が変わらないよう、ルールベースで書き込む。
4. **破壊的変更は人間が承認する。** 自動マージしない。PRで差分を確認してからマージ。
5. **判断リソースを最小化する。** 通知は簡潔に、PRは小さく、方針変更はCLAUDE.md一箇所。
