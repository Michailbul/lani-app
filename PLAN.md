# Backlot — Build Plan

> Companion to PRD.md. Tracks current state and the v1 build sequence. Update at the end of every session.

## Current state — 2026-05-05

Three commits in:
1. `genesis` — PRD, plan, CLAUDE.md, naming, license attribution
2. `fork` — 1code source imported as Apache-2.0 substrate
3. `rename` — cosmetic 1code/21st → Backlot branding pass

App has not been built or run yet. Next concrete step is `bun install && bun run dev` and seeing it boot under the Backlot identity.

Open work for Week 1: strip the 21st.dev integrations (separate commit), strip the routers we don't need, apply the schema delta. Then boot.

## Week 1 — Backbone fork

- [x] `git init`, write PRD/PLAN/CLAUDE.md/README/NAMING
- [x] Fork 1code source into the repo (commit "fork: import 1code")
- [x] Cosmetic rename pass: `1code` → `backlot`, `~/.21st` → `~/.backlot`, package.json/productName/appId, app window title, About panel, CLI install dialogs
- [ ] **Strip 21st.dev integrations** — `getBaseUrl`/`getAppUrl` phone-home, `auth-manager.ts` desktop-auth coupling, `analytics.ts` PostHog under 1code project, `remote-trpc.ts`/`remote-api.ts`, `features/agents/*` (whole feature)
- [ ] Strip non-essential routers: `ollama`, `voice`, `plugins`, `sandbox-import`, `agents`
- [ ] Strip the 21st-only mentions in CSP `connect-src` of `index.html`
- [ ] Update OAuth `CLIENT_NAME` story — register Backlot's own OAuth client with Anthropic, or document the keep-`1code`-for-now decision
- [ ] Apply schema delta migration (artifacts table, kind/canonical, agent_backend, sandboxMode, approvalPolicy, artifactPath; remove plan/agent mode field)
- [ ] Replace logo SVG with a Backlot mark (placeholder OK for v1, brand pass refines)
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
