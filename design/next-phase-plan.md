# DevPane 次フェーズ計画

## 概要

- **目的**: Phase 2（Web UI仕上げ）・Phase 3（VPS常駐）を完了し、他プロジェクトへ移植可能なレベルに汎用化する
- **スコープ**: Web UI改善、VPSデプロイ基盤、プロジェクト名のパラメータ化
- **前提条件**: Phase 1（自律ループ）は完了済み。Web UIも基本画面は実装済み

## 現状整理

### Web UI（Phase 2）— 8割完成

| 画面 | 状態 | 残作業 |
|------|------|--------|
| Dashboard | 実装済み | SPC管理図の追加、改善履歴表示 |
| TasksView | 実装済み | メモリ管理のUX改善 |
| TaskDetail | 実装済み | diff表示、Gate判定詳細 |

### VPS常駐（Phase 3）— 未着手

| 項目 | 状態 |
|------|------|
| Dockerfile | なし |
| systemd unit | なし |
| リバースプロキシ設定 | なし |
| 認証 | なし |

### 汎用化 — 半分完了

| 項目 | 状態 |
|------|------|
| config環境変数化 | 済（BRANCH_PREFIX, BUILD_CMD, TEST_CMD等） |
| プロジェクト名ハードコード | 残（index.html, console.log, package.json） |
| テンプレートリポジトリ化 | 未着手 |

## 要件

### Phase 2: Web UI仕上げ

- SPC管理図をダッシュボードに表示する（コスト推移、Gate通過率）
- 改善履歴（improvements テーブル）の閲覧UI
- タスク詳細にdiffビュー追加（git diff の表示）
- Viteのプロダクションビルドをdaemonから静的配信する（開発時はproxy、本番は同一ポート）

### Phase 3: VPS常駐

- docker compose で daemon + web を1コマンド起動
- Tailscale経由のアクセス制限（公開しない）
- systemd user unit で自動再起動
- SQLiteバックアップ戦略（日次rsync or litestream）

### 汎用化

- プロジェクト名のパラメータ化（`DEVPANE_APP_NAME` 環境変数）
- `npx create-devpane` or テンプレートリポジトリで新規プロジェクトに導入可能にする
- CLAUDE.md テンプレートの自動生成
- README に「別プロジェクトで使う手順」を追加

## 設計

### Web UIのプロダクション配信

```
開発時:
  web (port 3000, Vite dev) → proxy → daemon (port 3001)

本番時:
  daemon (port 3001)
    ├── /api/* → Hono API
    ├── /ws → WebSocket
    └── /* → packages/web/dist/ (静的配信)
```

daemonのindex.tsにHonoのserveStatic middlewareを追加し、ビルド済みのweb assetsを配信する。

### VPSデプロイ構成

```
apps-vps (133.18.124.16)
├── /opt/devpane/
│   ├── docker-compose.yml
│   ├── .env (DISCORD_WEBHOOK_URL, ACTIVE_HOURS等)
│   └── data/devpane.db (volume mount)
├── systemd: devpane.service (docker compose up)
└── Tailscale: アクセス制限 (100.x.x.x のみ)
```

### 汎用化のアプローチ

ハードコードを環境変数化するだけ。テンプレートリポジトリやCLIツールは後回し。

| ハードコード箇所 | 対応 |
|-----------------|------|
| `<title>DevPane</title>` | Vite define で `__APP_NAME__` を注入 |
| `[devpane]` ログプレフィックス | `config.APP_NAME` を参照 |
| `@devpane/*` パッケージ名 | そのまま（npm publish しないので問題なし） |

## タスク分解

### Phase 2: Web UI仕上げ（自走タスク向き）

- [ ] **2-1. SPC管理図コンポーネント** — ダッシュボードにコスト推移・Gate通過率のチャートを追加
- [ ] **2-2. 改善履歴UI** — improvementsテーブルの閲覧・フィルタリング画面
- [ ] **2-3. diff表示** — TaskDetailにgit diffのシンタックスハイライト表示
- [ ] **2-4. 静的配信** — daemonからweb/dist/を配信するserveStatic middleware

### Phase 3: VPS常駐（手動作業あり）

- [ ] **3-1. Dockerfile** — マルチステージビルド（build → runtime）
- [ ] **3-2. docker-compose.yml** — daemon + volume mount + .env
- [ ] **3-3. systemd unit** — devpane.service（docker compose up -d）
- [ ] **3-4. デプロイスクリプト** — `./deploy.sh`（ssh + docker compose pull + up）
- [ ] **3-5. VPSセットアップ** — apps-vpsにdocker, tailscaleインストール、Claude CLI認証

### 汎用化

- [ ] **G-1. APP_NAME環境変数** — config.tsにAPP_NAME追加、ログプレフィックス・HTMLタイトルに反映
- [ ] **G-2. セットアップガイド** — READMEに「別プロジェクトで使う」セクション追加
- [ ] **G-3. .env.example** — 必要な環境変数の一覧と説明

## リスク・懸念事項

| リスク | 影響 | 対策 |
|--------|------|------|
| VPSでClaude CLI認証が切れる | daemon停止 | systemd restart + 認証チェックをheartbeatに追加 |
| SQLiteの同時アクセス | WALモードでも書き込み競合の可能性 | 現状WORKER_CONCURRENCY=1で問題なし。並列化時に再検討 |
| Tailscale接続が不安定 | Web UIにアクセスできない | VPS側はインターネット直結なのでdaemon自体は動く。通知で確認 |

## 未決事項

- SPC管理図のチャートライブラリ選定（Chart.js? uPlot? SVG直書き?）
- VPSのClaude CLI認証方法（OAuth tokenの永続化）
- docker imageのレジストリ（GHCR? なし（ビルドオンリー）?）
- litestream導入の優先度（日次rsyncで十分か？）
