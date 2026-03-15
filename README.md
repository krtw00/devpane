# DevPane

AIチームのバーチャルオフィスをブラウザの窓から覗く。
階層型マルチエージェント（PM→リード→メンバー）が常駐で自律開発し、人間はブラウザからチャットで介入する。

## セットアップ

```bash
pnpm install
pnpm build
pnpm dev
```

## 別プロジェクトで使う

1. このリポジトリをクローンする
2. `.env.example` を `.env` にコピーし、`PROJECT_ROOT` を対象リポジトリのパスに設定する
3. 対象リポジトリに `CLAUDE.md` を作成する
4. 必要に応じて環境変数を設定する（ブランチプレフィックス、ビルド/テストコマンド等）

```bash
git clone https://github.com/krtw00/devpane.git
cd devpane
cp .env.example .env
# .env を編集: PROJECT_ROOT=/path/to/your/repo
pnpm install && pnpm build
pnpm dev
```

詳細は `.env.example` と [設計ドキュメント](design/00-index.md) を参照。
