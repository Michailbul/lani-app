# Backlot — Build Plan

> Companion to PRD.md. Tracks current state and the v1 build sequence. Update at the end of every session.

## Current state — 2026-05-05

v1 scope locked: **UI in place, auth in place, chat in the UI of Backlot.** Ship the screenwriter-specific surface (Fountain editor, preview, direction tree, MCP tools) in v1.5+.

2026-05-09 session note:
- Hardened skill discovery so malformed personal `SKILL.md` YAML frontmatter is recovered with a concise warning instead of dumping a full YAML exception during chat startup.
- Changed Codex chat transport auth/request failures to close the UI stream with an error chunk instead of throwing through the stream controller, which avoids React concurrent-render recovery noise on send.
- Updated model defaults and selectors for current official model aliases: Codex `gpt-5.5`, Claude `claude-sonnet-4-6`, `claude-opus-4-7`, and `claude-haiku-4-5`.
- Verified the malformed `~/.claude/skills/laniameda-hq-update/SKILL.md` shape recovers name, description, and content; `bun run build` passes.

Six commits in:
1. `genesis` — PRD, plan, CLAUDE.md, naming, license attribution
2. `fork` — 1code source imported as Apache-2.0 substrate
3. `rename` — cosmetic 1code/21st → Backlot branding
4. `plan` — Week 1 list refined
5. `strip` — ollama + sandbox-import removed, online-only stubs in place
6. `oauth` — MCP client name flipped to Backlot

`bun install` running. Once green, `bun run dev` is the boot attempt.

## Session note — 2026-05-10

Shipped: tightened Backlot markdown frontmatter rendering in the main editor preview so YAML `---` wrappers no longer draw duplicate horizontal rules, and removed the extra metadata-strip divider under the entity header.

Shipped: hardened Codex chat error handling in the renderer transport. Codex auth/request failures now render as assistant text and finish the UI stream instead of sending AI SDK `error` chunks that throw through React concurrent rendering during send.

Shipped: fixed forked Claude Directions resuming the parent session ID. Fork creation now strips parent Claude resume metadata from copied messages, and the Claude router only resumes from the database `sub_chats.session_id`, preventing stale renderer metadata from crashing Claude in the new worktree. Added inherited local transcript context for fresh fork sessions and a visible Directions section in the project rail for switching original/fork/current branches.

Shipped: added the project skill `.claude/skills/runway-shotlist-submission/SKILL.md` for submitting Backlot shotlist prompts to Runway. It covers precise ZH-to-EN prompt translation, project-specific generation overrides, reuse-settings browser flow, and submission attempt logging.

Shipped: added the first Backlot-native shotlist slice. HTML shotlists can be imported through the project file tree into `shotlist.backlot.json` plus archived `source.html`; the parser preserves shot rows, beat ids, prompt grouping, Chinese prompts, imported English translations, and translation status. Added a shotlist editor surface for searchable rows, ZH/EN/Runway prompt editing, copy actions, and Runway submission attempt marking.

Shipped: added Shotlist as a separate Backlot workdesk mode next to Screenwriting and Prompts. Clicking the masthead mode opens the shotlist surface, and importing or selecting a shotlist file switches the workdesk into that mode automatically.

Shipped: made Shotlist mode auto-load the first project shotlist instead of asking the user to pick a file. Added the Daddy Issues Scene 1 shotlist JSON/source HTML into the Daddy Issues project and active Backlot worktrees from the existing skill-generated HTML export.

Fixed: mode navigation now treats Screenwriting, Prompts, and Shotlist as authoritative top-level workdesk modes. Auto-loading a shotlist no longer pins `activeEntityAtom` to a shotlist and traps the center pane in the Shotlist surface after switching modes.

Fixed: direct Backlot editor saves no longer leave clean files as pending changes in chat worktrees. Entity and shotlist writes now auto-settle Backlot-owned user edits into focused git commits when the file was clean before the save, while preserving pre-existing agent pending changes for review.

Fixed: project forking now refuses parent-repo git roots and requires an exact Backlot project repo root before creating worktrees. Folder open/create paths normalize projects into `~/.backlot/projects/<slug>/`, and an explicit project normalizer repairs older rows. Repaired the active Daddy Issues app DB row and chats to point at `/Users/michael/.backlot/projects/daddy-issues` instead of the nested `laniameda-hq/AI Creatorship/daddy-issues` source.

Fixed: removed the local OpenAI Codex CLI downloader/execution path after macOS Gatekeeper blocked the downloaded `codex` binary. The checked local 1code app has Codex disabled and does not bundle or execute that CLI; Backlot now refuses CLI-backed Codex login/MCP management and keeps Codex chat on the app-managed API-key ACP path.

Fixed: Backlot thread creation now supports explicit provider selection. The workdesk thread menu and standard thread selector expose Branch into Claude, Branch into Codex, Start new chat with Claude, and Start new chat with Codex; the create-sub-chat mutation persists that provider and strips stale resume metadata when branching from an existing thread.

Fixed: the assistant input model picker now receives the active thread provider explicitly, so freshly-created Codex threads immediately show Codex models and reasoning controls instead of the Claude model list.

Fixed: freshly-created Codex threads no longer flip back to Claude after the chat query refetches. The sub-chat initializer now preserves existing local placeholder provider metadata, and transport creation falls back to store metadata when the refetched sub-chat row is not available yet.

Shipped: added Canvas v1 as a DB-backed workdesk mode. Canvas state lives in SQLite with prompt, image, image-generation, edge, asset, and run records; image binaries are stored under `assets/canvas/imported/` and `assets/canvas/generated/` in the active worktree. The built-in `backlot-canvas` MCP server is wired into both Claude and Codex sessions so agents can read and mutate the canvas through tools instead of editing storage directly.

Fixed: renamed the persistent conversation model from `chats`/`sub_chats` to `worktrees`/`agent_threads`, including `worktree_id` canvas ownership columns and worktree-scoped canvas MCP/tRPC calls. Compatibility aliases remain in TypeScript while the broader renderer naming is migrated.

Next: run a visual pass in the app once the local browser/debug tooling is available; the repo-wide type check is still blocked by existing baseline TypeScript errors and the missing `tsgo` binary.

## Week 1 — v1 backbone (UI + auth + chat)

- [x] `git init`, write PRD/PLAN/CLAUDE.md/README/NAMING
- [x] Fork 1code source into the repo
- [x] Cosmetic rename pass (1code/21st → Backlot, paths, package metadata)
- [x] Strip ollama + sandbox-import routers, lib, callers (per scope: keep voice, agents, skills, plugins)
- [x] Flip OAuth `CLIENT_NAME` for MCP servers to `'Backlot'` with `'Claude Code'` fallback
- [ ] `bun install` — running
- [ ] `bun run dev` — boot the app, confirm it renders the Backlot identity
- [ ] OAuth into Anthropic via the existing flow (still routes through 21st.dev backend; acceptable for v1 boot, strip after baseline)
- [ ] Create a project, a chat (worktree), send a Claude message, see it stream
- [ ] First green-path screenshot saved to `docs/screenshots/v1-week1.png`

## v1 hardening (after first boot is green)

- [ ] Strip the 21st.dev backend coupling — `getBaseUrl`/`getAppUrl`, `auth-manager.ts` proxy auth, analytics phone-home, remote-trpc / remote-api
- [ ] Decide remote-agents UI fate (`features/agents/`): leave dead, hide behind a feature flag, or rewrite for native Anthropic auth
- [ ] Tighten `index.html` CSP `connect-src` once 21st.dev is gone
- [ ] Replace logo SVG with a Backlot mark (placeholder OK for v1, brand pass refines)
- [ ] Apply schema delta migration (artifacts table, kind/canonical, agent_backend, sandboxMode, approvalPolicy, artifactPath; remove plan/agent mode field) — preparation for the screenwriter UI on top

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
