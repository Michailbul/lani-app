# CLAUDE.md — Backlot

> Project-specific instructions for Claude Code agents working in this repo. Read first.

## What this repo is

A local desktop app for **screenwriters and AI filmmakers** — a writer's IDE, not a code editor. The product surfaces are designed for people writing screenplays, scene prompts, character bibles, world-building docs, treatments, and shot briefs. Their primary content is creative work in `.fountain` and `.md`, not source code. The agent in the right rail is there to help them write, not to ship software.

Tech under the hood: Electron + Vite + React on the front, Claude Agent SDK on the back, git as the underlying versioning primitive for *creative* exploration paths ("Directions").

Read **PRD.md** for the spec, **PLAN.md** for the build sequence and current state, **NAMING.md** for the name rationale.

## Two layers — code vs. creative artifacts

Backlot has **two distinct populations of files**, and they carry different rules. Confusing them is the most common way an engineering-trained agent ships the wrong feature.

| Layer | What it is | Who edits it | Rules |
|---|---|---|---|
| **Backlot codebase** (this repo) | The Electron/React/tRPC app | Engineering agents (you, when working in `src/`) | Normal software hygiene: typecheck, focused commits, code review, no half-finished work, follow upstream patterns from 1code. |
| **User content** (writer's project worktree) | `.fountain` screenplays, `.md` briefs/characters/locations/scenes/shots, prompt drafts | The writer + their in-app agent | Creative versioning. Auto-commits are cheap and encouraged. Forks ("Directions") are alternate creative paths, not engineering branches. Per-hunk Approve/Dismiss is a writer's revision tool, not a code-review gate. |

**Practical implications when designing features:**

- **Don't transplant code-IDE patterns into the writer flow.** Avoid PR-style language, CI gates, "merge conflicts", "code review" framing. The user is editing prose, not shipping software.
- **Auto-commits to the live worktree are a feature, not a risk.** Every Accept (file-level or per-hunk) is a creative checkpoint that feeds the History view and enables time-travel through drafts. Don't add friction or warnings around them.
- **Forking a Direction is cheap.** It's how a writer says "let me try a different version of this scene." Treat fork operations as low-stakes and frequent — like Notion duplicating a page, not like git branching off main.
- **Optimize the writer's surfaces for creative legibility.** Clear history, easy diff review, easy time-travel between drafts. Hide engineering scaffolding (commit hashes, branch names, technical git output) unless the user explicitly asks for it.
- **User-facing copy is product copy, not commit copy.** "Accept changes", "Restore this version", "Try another way" — never "merge", "rebase", "stash", "revert HEAD~1".
- **The screenplay artifact and per-entity files (brief, characters, locations, scenes, shots, acts) are first-class.** When the user says "edit this file" they usually mean a content artifact in their worktree, not Backlot source code.

When you're working in this repo improving the *app itself*, you are doing software engineering — code-layer rules apply. When you are designing how the *writer's surfaces* behave, content-layer rules apply.

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
- **Design for the writer first.** Before shipping any user-facing surface, ask: does this feel like a manuscript editor or a code editor? If it leaks engineering jargon, branch names, commit shorthand, or PR-style review language, fix the framing before the feature ships. The audience is screenwriters, not engineers.
- **Auto-commits in the user's worktree are normal.** Don't add caveats, warnings, or "are you sure" gates around them — they're how the writer's history and Direction forks work. Friction here is anti-feature.
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
