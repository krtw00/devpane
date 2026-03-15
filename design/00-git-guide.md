---
depends_on:
  - ./00-writing-guide.md
tags: [governance, git, workflow]
ai_summary: "コミットメッセージ・ブランチ命名・変更履歴管理のGitワークフロー規範"
---

# Git規範

> Status: Active
> 最終更新: 2026-03-15

Gitワークフローに関するルールを定義する。コミットメッセージ、ブランチ命名、変更履歴管理を対象とする。

---

## コミットメッセージ規範

[Conventional Commits](https://www.conventionalcommits.org/) に準拠する。

### フォーマット

```
<type>(<scope>): <subject>

<body>

<footer>
```

| 要素 | 必須 | 内容 |
|------|------|------|
| `type` | 必須 | 変更の種類 |
| `scope` | 任意 | 変更対象のモジュール・ディレクトリ |
| `subject` | 必須 | 変更内容の要約（50文字以内） |
| `body` | 任意 | 変更の詳細・背景（72文字で折り返し） |
| `footer` | 任意 | Breaking Change、Issue参照 |

### type一覧

| type | 用途 | CHANGELOG対象 |
|------|------|:---:|
| `feat` | 新機能の追加 | Yes |
| `fix` | バグ修正 | Yes |
| `docs` | ドキュメントのみの変更 | No |
| `style` | フォーマット変更（動作に影響しない） | No |
| `refactor` | リファクタリング（機能追加・バグ修正なし） | No |
| `perf` | パフォーマンス改善 | Yes |
| `test` | テストの追加・修正 | No |
| `ci` | CI/CD設定の変更 | No |
| `chore` | ビルド・補助ツール・依存関係の変更 | No |

### subject（要約行）のルール

- 命令形で書く（「追加した」ではなく「追加」）
- 末尾にピリオドをつけない
- 50文字以内に収める
- 「何を変えたか」ではなく「何のために変えたか」を優先する

### コミット粒度

- 1コミット = 1つの論理的変更
- 複数の無関係な変更を1コミットにまとめない
- 動作する状態でコミットする（ビルドが壊れた状態でコミットしない）

---

## ブランチ命名規則

### フォーマット

```
<type>/<short-description>
```

コミットメッセージのtypeと同じプレフィックスを使用する。説明部分はケバブケースで記述する。

### 例

| ブランチ名 | 用途 |
|-----------|------|
| `feat/oauth-login` | OAuth認証機能の追加 |
| `fix/cart-zero-quantity` | カート数量0バグの修正 |
| `docs/api-rate-limit` | API仕様にレート制限を追加 |
| `refactor/repository-pattern` | リポジトリパターンへの移行 |

### ルール

- 英語のケバブケースを使用する
- 短く具体的に命名する（目安: 3-5単語）
- メインブランチ（`main`）への直接コミットは原則禁止

---

## 変更履歴の管理

### 基本方針

- 通常の変更 → Git履歴で管理
- 重要な変更 → `CHANGELOG.md` に記録

### CHANGELOGに記録する変更

- 破壊的変更（`BREAKING CHANGE` を含むコミット）
- 新機能の追加（`feat` typeのコミット）
- 重要なバグ修正（`fix` typeのうち影響範囲の大きいもの）
- パフォーマンス改善（`perf` typeのコミット）

### CHANGELOGの形式

[Keep a Changelog](https://keepachangelog.com/) に準拠する。

---

## 関連ドキュメント

- [記載規範](./00-writing-guide.md) - 文章の書き方ルール
- [フォーマット規範](./00-format-guide.md) - 文書構造・メタ情報・図・命名規則
- [ドキュメントインデックス](./00-index.md) - ドキュメント全体のナビゲーション
