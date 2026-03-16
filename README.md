# DevPane

[日本語](README.ja.md) | English

Autonomous AI development daemon — PM, Worker, and Gate agents orchestrate TDD pipelines while you sleep.

寝る前にデーモンを起動し、朝にDiscord日報を確認。ブラウザからチャットで介入できるAI自律開発環境。

## How It Works

```
You (browser chat) → PM Agent → Gate 1 → Tester → Gate 2 → Worker → Gate 3 → PR
                         ↑                                                    |
                         └──── Kaizen (self-improvement) ←────────────────────┘
```

1. **PM Agent** generates structured specs from CLAUDE.md and project context
2. **Gate 1** validates the spec against project goals
3. **Tester** auto-generates tests (TDD: red first)
4. **Gate 2** verifies test-spec alignment
5. **Worker** implements in an isolated Git worktree
6. **Gate 3** checks observable facts (exit code, diff, test results)
7. **Kaizen** analyzes failures and applies improvements

## Features

- **Autonomous pipeline** — Tasks flow through PM → Test → Implement → Review without human intervention
- **Git worktree isolation** — Each task runs in its own worktree, no interference
- **Observable Facts** — Completion judged by exit codes, diffs, and test results, not LLM opinion
- **3-stage Gate system** — Go / Kill / Recycle decisions at each stage
- **Self-improvement** — Root cause analysis on failures, automatic process improvements
- **Browser UI** — Vue 3 dashboard to monitor tasks, chat with agents, view SPC charts
- **Discord reports** — Daily PR summaries posted to Discord

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Daemon | Hono, TypeScript, Node.js |
| Web UI | Vue 3, Vite, Vue Router |
| Database | SQLite (better-sqlite3) |
| Shared | Zod schemas, TypeScript |
| Build | pnpm workspace, esbuild |

## Quick Start

```bash
git clone https://github.com/krtw00/devpane.git
cd devpane
cp .env.example .env
# Edit .env: set PROJECT_ROOT to your target repository
pnpm install && pnpm build
pnpm dev
```

Open `http://localhost:3000` to access the dashboard.

## Usage with Your Project

1. Set `PROJECT_ROOT` in `.env` to your repository path
2. Ensure your repo has a `CLAUDE.md` with project context
3. Start devpane — the daemon will autonomously pick up tasks and execute them
4. Monitor progress from the browser or check Discord for daily reports

## Commands

```bash
pnpm dev          # Start daemon + web UI
pnpm build        # Build all packages
pnpm test         # Run all tests
pnpm start        # Start daemon (production)
```

## Architecture

```
packages/
├── daemon/   # Hono API (port 3001) — agent orchestration
├── web/      # Vue 3 SPA (port 3000) — monitoring dashboard
└── shared/   # Zod schemas & shared types
```

See [design docs](design/00-index.md) for detailed architecture.

## Design Principles

- **LLM as transformer** — LLMs handle input→output conversion only; flow control and gate decisions are in code
- **Blackboard as truth** — SQLite is the single source of truth for all agent state
- **Contracts at boundaries** — Zod schemas validate all inputs/outputs

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, branch strategy, and PR guidelines.

## License

MIT
