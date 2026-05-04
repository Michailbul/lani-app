# Backlot — Build Plan

> Companion to PRD.md. Tracks current state and the v1 build sequence. Update at the end of every session.

## Current state — 2026-05-05

- Repo created at `~/work/laniameda/backlot/`
- Genesis docs in place (README, PRD, PLAN, CLAUDE.md, NAMING)
- 1code source forked in (next commit)
- No app builds yet, no schema migrations yet, no UI changes yet

## Week 1 — Backbone fork

- [x] `git init`, write PRD/PLAN/CLAUDE.md/README/NAMING
- [ ] Fork 1code source into the repo (commit "fork: import 1code")
- [ ] Rename pass: `1code` → `backlot`, `~/.21st` → `~/.backlot`, package.json name + productName, electron-builder appId/productName, app window title
- [ ] Strip non-essential routers: `ollama`, `voice`, `plugins`, `sandbox-import`, `agents` (Claude-agent registry), `claude-code` if redundant
- [ ] Strip 21st.dev desktop-auth coupling; keep raw Anthropic OAuth
- [ ] Apply schema delta migration (artifacts table, kind/canonical, agent_backend, sandboxMode, approvalPolicy, artifactPath; remove plan/agent mode field)
- [ ] `bun install`, `bun run dev` — confirm app boots, can OAuth into Anthropic, can create a chat in a worktree, can stream a Claude reply
- [ ] First green-path screenshot saved to `docs/screenshots/v1-week1.png`

## Week 2 — Screenplay editor + preview

- [ ] Spike CodeMirror 6 Fountain mode (1 day)
- [ ] Implement Fountain syntax mode, scene navigator, page breaks
- [ ] Implement preview pane with `afterwriting-labs` (or hand-rolled Fountain renderer)
- [ ] Build `artifacts` router + table population
- [ ] File watcher → live preview update on agent file_change
- [ ] Primary-artifact selection UI (one artifact = the screenplay being edited)
- [ ] Center pane swaps from 1code's code editor to the screenplay editor + preview split

## Week 3 — Direction tree + accept/reject

- [ ] Direction tree component (left rail) — list, fork-from, rename, archive, discard
- [ ] Accept/Revert toolbar over the diff view
- [ ] Auto-commit-on-Accept policy
- [ ] Merge-direction-into-canonical UI flow with conflict surfacing
- [ ] Confirm parallel directions = parallel Claude sessions, no cross-talk

## Week 4 — Studio integration + polish

- [ ] Ship the 5 v1 MCP tools (`gallery-save`, `lock-read`, `lock-write`, `fountain-render`, `screenplay-stats`)
- [ ] Settings UI: model picker, sandbox mode, approval policy, default artifact format
- [ ] Onboarding: first-run picks a project folder, optionally inits a git repo + first `.fountain`
- [ ] Brand pass — apply `studio/brand/tokens.css`, fonts, colors
- [ ] Pack & sign macOS build (electron-builder + Apple notarization)
- [ ] Dogfood on the Forest Race screenplay

## Backlog (post-v1)

- Codex CLI backend (v1.5) — see PRD §2
- Multi-window
- Windows / Linux builds
- Cloud sync (Convex?)
- Plugin marketplace for third-party MCP tools
- Voice input (1code already has the router; un-strip when re-adding)
- Beat sheet view (cards / outline mode alongside the script)
- Character bible auto-extraction
- Storyboard mode that bridges to image-gen MCP servers
