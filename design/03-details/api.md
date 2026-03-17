---
depends_on:
  - ../02-architecture/structure.md
  - ./data-model.md
tags: [details, api, endpoints, rest]
ai_summary: "DevPaneのHono APIエンドポイント一覧（タスク・チャット・イベント・記憶・スケジューラ・統計）"
---

# API設計

> Status: Active
> 最終更新: 2026-03-17

本ドキュメントは、daemon（port 3001）のHono REST APIを定義する。

---

## API概要

| 項目 | 内容 |
|------|------|
| ベースURL | `http://localhost:3001/api` |
| 認証方式 | Bearer Token（`Authorization: Bearer <token>`、`API_TOKEN`未設定時は不要） |
| レスポンス形式 | JSON |

---

## エンドポイント一覧

### タスク管理

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/tasks` | タスク一覧取得 |
| GET | `/api/tasks/:id` | タスク詳細取得 |
| POST | `/api/tasks` | タスク手動作成 |
| PATCH | `/api/tasks/:id` | タスク更新（`status` / `priority`） |

### チャット

| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/chat` | 互換エンドポイント（`POST /api/chat/messages` と同一処理） |
| POST | `/api/chat/messages` | チャットメッセージ送信 |
| GET | `/api/chat/messages` | メッセージ履歴取得 |

### イベント・ログ

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/events` | イベントストリーム（SSE） |
| WebSocket | `/ws` | リアルタイムイベント配信 |

### 記憶管理

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/memories` | 記憶一覧取得 |
| POST | `/api/memories` | 記憶追加 |
| DELETE | `/api/memories/:id` | 記憶削除 |

### スケジューラ

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/scheduler/status` | スケジューラ状態取得 |
| POST | `/api/scheduler/pause` | 一時停止 |
| POST | `/api/scheduler/resume` | 再開 |

### 統計・メトリクス

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/system/health` | 外部連携ヘルスチェック |
| GET | `/api/backups` | バックアップ一覧取得 |
| POST | `/api/backups` | バックアップ作成 |
| GET | `/api/stats` | 統計情報取得 |

### PR Agent

| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/pr-agent/run` | PR Agent手動実行 |
| GET | `/api/pr-agent/reports` | レポート履歴取得 |

---

## 共通仕様

### エラーレスポンス

| フィールド | 型 | 説明 |
|------------|-----|------|
| error | string | エラーメッセージ |

### 認証

- APIは `API_TOKEN` が設定されている場合、`Authorization: Bearer <token>` が必須。
- `API_TOKEN` 未設定時はローカル開発モードとして認証を要求しない。
- `GET /health` は常に認証不要（プロセス生存確認用）。

---

## 関連ドキュメント

- [データモデル](./data-model.md) - SQLiteスキーマとエンティティ定義
- [主要フロー](./flows.md) - パイプラインフローのシーケンス図
