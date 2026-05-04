# Backlot

> A local desktop app for screenwriters and AI filmmakers who write with AI but refuse to hand the keyboard over.

The center pane is your screenplay. The right rail is the assistant. The left rail is a tree of **directions** — each direction is a git worktree, so exploring an alternate Act II is forking, and approving it is merging.

The CLI is yours, the UI is yours, the data is local.

## Status

Pre-alpha. Forked from [1code](https://github.com/1code-app/1code) (Apache 2.0) as the engineering substrate. Net-new work is the screenplay editor, live preview, and direction tree.

See **PRD.md** for the spec, **PLAN.md** for the build sequence, **NAMING.md** for the name rationale, **CLAUDE.md** for agent instructions.

## Stack

- Electron + Vite (main / preload / renderer split)
- React 19 + Tailwind + Radix UI
- tRPC for type-safe IPC, observable streaming for agent output
- Drizzle ORM + SQLite for local persistence
- simple-git for worktree management
- `@anthropic-ai/claude-agent-sdk` for the agent (v1)
- CodeMirror 6 with a Fountain mode for the editor (v1)

## Why fork 1code

1code already provides the production-grade pieces that take months to get right:

- One git worktree per chat (the foundation of "directions")
- Streaming agent output over IPC
- safeStorage-encrypted credential storage with multi-account OAuth
- Auto-migrating SQLite schema, theme system, auto-updater, window manager

The screenwriter delta is the editor pane, the preview pane, the direction tree, and a handful of MCP tools. Building those on a working desktop shell beats greenfield by ~6 weeks.

## Roadmap (high level)

- **v1** — Claude CLI only. Single-window, multi-project, macOS first. Fountain editor + live preview. Direction tree. Accept/Revert UX. OAuth auth. 5 MCP tools.
- **v1.5** — Codex CLI as a second backend. Settings switch.
- **v2** — Multi-window, Windows + Linux, plugin system for custom MCP tools.

## Attribution

Forked from 1code (Apache 2.0). See `NOTICE` for full attribution.

## License

TBD. Apache 2.0 is inherited from 1code; preserve the upstream `LICENSE` and `NOTICE`. Final license decision before public release.
