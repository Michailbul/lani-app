# Backlot — Build Plan

> Companion to PRD.md. Tracks current state and the v1 build sequence. Update at the end of every session.

## Current state — 2026-05-05

v1 scope locked: **UI in place, auth in place, chat in the UI of Backlot.** Ship the screenwriter-specific surface (Fountain editor, preview, direction tree, MCP tools) in v1.5+.

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
