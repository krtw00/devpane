# Contributing / コントリビューションガイド

Contributions are welcome! / コントリビューションを歓迎します。

## Development Environment / 開発環境

| Required / 必須 | Version / バージョン |
|-----------------|---------------------|
| Node.js | >= 22 |
| pnpm | >= 10 |
| Git | Latest recommended / 最新推奨 |

```bash
git clone https://github.com/krtw00/devpane.git
cd devpane
pnpm install
pnpm build
pnpm test
```

## Branch Strategy / ブランチ戦略

```
main (stable release / 安定版、no direct push / 直接pushしない)
├── develop (human development / 人間の開発用)
└── ai-develop (AI autonomous / AI自走用、runs on VPS / VPSで自動稼働)
```

| Branch | Purpose / 用途 | Merge target / マージ先 |
|--------|---------------|------------------------|
| `main` | Stable release / 安定リリース | - |
| `develop` | Human development / 人間の開発 | → main (PR) |
| `ai-develop` | AI autonomous dev / AI自走 | → main (PR) |
| `feat/*`, `fix/*` etc. | Feature branches / 作業ブランチ | → develop (PR) |

### Human Workflow / 人間のワークフロー

1. Branch off from `develop` / `develop` から作業ブランチを切る
2. Make changes and commit / 変更を加えてコミット
3. Open a PR to `develop` / `develop` へ PR を出す
4. Merge after review / レビュー後にマージ
5. Periodically merge `develop` → `main` via PR / まとまったら `main` へ PR

```bash
git checkout develop
git pull origin develop
git checkout -b feat/my-feature
# work...
git push origin feat/my-feature
# Open PR to develop on GitHub
```

### About `ai-develop` / AI自走ブランチについて

`ai-develop` is used by the AI daemon for autonomous development. Humans should not commit directly to this branch. AI-generated PRs are merged into `ai-develop`, then reviewed and promoted to `main`.

`ai-develop` は AI デーモンが自律開発に使用するブランチです。人間はこのブランチに直接コミットしないでください。

## Commit Messages / コミットメッセージ

Follow [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<scope>): <subject>
```

| type | Purpose / 用途 |
|------|---------------|
| `feat` | New feature / 新機能 |
| `fix` | Bug fix / バグ修正 |
| `docs` | Documentation / ドキュメント |
| `refactor` | Refactoring / リファクタリング |
| `test` | Tests / テスト |
| `ci` | CI/CD |
| `chore` | Maintenance / その他 |

Examples / 例:
```
feat(web): add SPC chart to dashboard
fix(gate): fix unreachable timeout classification
docs(design): restructure design docs with templarc
```

See [design/00-git-guide.md](design/00-git-guide.md) for details / 詳細はGit規範を参照。

## Monorepo Structure / モノレポ構成

```
packages/
├── daemon/   # Hono API (port 3001) — agent orchestration / エージェントオーケストレーション
├── web/      # Vue 3 + Vite (port 3000) — monitoring UI / 監視UI
└── shared/   # Shared types & Zod schemas / 共通型定義・Zodスキーマ
```

### Common Commands / よく使うコマンド

```bash
pnpm dev                          # Start daemon + web / 同時起動
pnpm build                        # Build all / 全パッケージビルド
pnpm test                         # Run all tests / 全テスト実行
pnpm --filter @devpane/daemon dev # Daemon only
pnpm --filter @devpane/web dev    # Web only
```

## Pull Requests / PR の出し方

1. Ensure build and tests pass / ビルドとテスト通過を確認: `pnpm build && pnpm test`
2. PR title follows Conventional Commits format / タイトルは Conventional Commits 形式
3. Describe the purpose and scope of changes in the PR body / 変更の目的と影響範囲を記載
4. Add tests for new features / 新機能はテストを追加

## Design Documents / 設計ドキュメント

Design docs are maintained in [design/](design/00-index.md) using templarc format. Update them when making design changes.

設計方針は templarc 形式で管理しています。設計変更を伴う場合はドキュメントも更新してください。

| What you want to know / 知りたいこと | Reference / 参照先 |
|--------------------------------------|-------------------|
| Project overview / 概要 | [summary.md](design/01-overview/summary.md) |
| Components / コンポーネント構成 | [structure.md](design/02-architecture/structure.md) |
| Tech stack / 技術スタック | [tech-stack.md](design/02-architecture/tech-stack.md) |
| Data model / データモデル | [data-model.md](design/03-details/data-model.md) |
| Flows / 処理フロー | [flows.md](design/03-details/flows.md) |
| Glossary / 用語集 | [glossary.md](design/99-appendix/glossary.md) |

## Code Style / コードスタイル

- TypeScript strict mode
- Tests with Vitest
- Avoid over-engineering and unnecessary comments / 過剰なコメント・エンジニアリングは避ける

## Questions / 質問・相談

Open an Issue or comment on a PR. / Issue を立てるか、PR 上でコメントしてください。
