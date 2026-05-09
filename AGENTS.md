# CLAUDE.md — Backlot

> Project-specific instructions for Claude Code agents working in this repo. Read first.

## What this repo is

A local desktop app for screenwriters and AI filmmakers. Electron + Vite + React on the front, Claude Agent SDK on the back, git worktrees as the branching primitive for narrative directions.

Read **PRD.md** for the spec, **PLAN.md** for the build sequence and current state, **NAMING.md** for the name rationale.

## Origin

Forked from [1code](https://github.com/1code-app/1code) (Apache 2.0). Preserve `LICENSE` and `NOTICE`. Most of the engineering substrate (worktree management, tRPC streaming, schema, Electron scaffold, OAuth) comes from 1code. The screenwriter-specific work (editor pane, preview pane, direction tree, MCP tools) is net-new under Backlot.

When working in this repo, do not re-implement what 1code already provides. The relevant pieces are inventoried in PRD §3.

## Stack

- Electron 39 + electron-vite (main + preload + renderer)
- React 19 + Tailwind + Radix UI
- tRPC + trpc-electron + observable streaming for IPC
- Drizzle ORM + better-sqlite3 (or libsql), auto-migrating on launch
- simple-git for worktrees, `@git-diff-view/react` for diffs
- `@anthropic-ai/claude-agent-sdk` for the agent (v1)
- CodeMirror 6 + Fountain mode (planned, week 2)
- `afterwriting-labs` or hand-rolled Fountain renderer (planned)

## Conventions

- **Source layout** mirrors 1code: `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`. Don't reorganize without an explicit task.
- **Routers** live at `src/main/lib/trpc/routers/<name>.ts`, registered in `routers/index.ts`.
- **Database schema** at `src/main/lib/db/schema/index.ts`. Drizzle migrations go in `drizzle/`. Migrations apply on launch.
- **Worktrees** under `~/.backlot/worktrees/<projectSlug>/<folderName>` (renamed from 1code's `~/.21st/`). Project slug is sanitized project name.
- **MCP tools** under `mcp/<tool-name>/` as separate Node stdio packages. Each has its own `package.json` and `index.ts`.
- **Screenplay artifacts** default to `.fountain` extension. Markdown is allowed for treatments, character bibles, beat sheets.
- **Commits**: focused, one concern per commit, imperative mood. Group renames and find/replace into one commit. Keep `LICENSE` + `NOTICE` intact.

## Working rules for agents

- **Read before writing.** PRD.md, PLAN.md, and the relevant 1code source file first.
- **Don't fork-as-rewrite.** When adapting a 1code module, keep its shape. The streaming observable pattern, the worktree manager, the schema — these are working code. Mutate surgically.
- **One concern per commit.** A "rename pass" commit only renames. A "schema delta" commit only changes schema. Don't mix.
- **Follow the studio copy standards** (see `~/.claude/CLAUDE.md`) for any user-facing copy: no AI-speak, no negative parallelisms, no inflation words. App copy is product copy.
- **Update PLAN.md** at the end of every session — what shipped, what's next.
- **No new docs unless asked.** Edit PRD.md, PLAN.md, CLAUDE.md as the canonical set. New top-level docs require a reason.

## Out of scope (do not build without re-scoping)

- Codex CLI backend (v1.5)
- Multi-window
- Windows / Linux packaging
- Cloud sync, multi-user, sharing
- Voice input, plugin marketplace
- Anything in PRD §10

## Useful upstream references

- 1code source (forked): `~/work/1code/` (read-only reference; do not modify)
- Studio brand ground truth: `~/work/laniameda/laniameda-hq/studio/brand/`
- Skills registry: `~/work/laniameda/laniameda-hq/laniameda-skills/`

## How to run (will be filled in once Week 1 is green)

```bash
# placeholder — fill in after first successful boot
bun install
bun run dev
```

Document the actual commands here once they work, not before.
