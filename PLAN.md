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

Fixed: restored Codex CLI-backed subscription auth to match the current `21st-dev/1Code` implementation: bundled Codex downloader, `codex login` OAuth, `login status`, logout, and `mcp list --json` discovery are active again. Recorded `21st-dev/1Code` and `pingdotgg/t3code` as the ground-truth Codex/Claude auth references in `AGENTS.md` and `CLAUDE.md`; app-managed Codex API keys remain available as an override and now persist through main-process `safeStorage` with migration from the old renderer localStorage key.

Fixed: Backlot thread creation now supports explicit provider selection. The workdesk thread menu and standard thread selector expose Branch into Claude, Branch into Codex, Start new chat with Claude, and Start new chat with Codex; the create-sub-chat mutation persists that provider and strips stale resume metadata when branching from an existing thread.

Fixed: the assistant input model picker now receives the active thread provider explicitly, so freshly-created Codex threads immediately show Codex models and reasoning controls instead of the Claude model list.

Fixed: freshly-created Codex threads no longer flip back to Claude after the chat query refetches. The sub-chat initializer now preserves existing local placeholder provider metadata, and transport creation falls back to store metadata when the refetched sub-chat row is not available yet.

Shipped: added Canvas v1 as a DB-backed workdesk mode. Canvas state lives in SQLite with prompt, image, image-generation, edge, asset, and run records; image binaries are stored under `assets/canvas/imported/` and `assets/canvas/generated/` in the active worktree. The built-in `backlot-canvas` MCP server is wired into both Claude and Codex sessions so agents can read and mutate the canvas through tools instead of editing storage directly.

Fixed: renamed the persistent conversation model from `chats`/`sub_chats` to `worktrees`/`agent_threads`, including `worktree_id` canvas ownership columns and worktree-scoped canvas MCP/tRPC calls. Compatibility aliases remain in TypeScript while the broader renderer naming is migrated.

Next: run a visual pass in the app once the local browser/debug tooling is available; the repo-wide type check is still blocked by existing baseline TypeScript errors and the missing `tsgo` binary.

## Session note — 2026-05-15

Shipped: added Codex rollover support behind the existing Rollback beta switch. Codex assistant responses now capture Backlot git checkpoints, rollback restores the worktree to the selected response, truncates the local transcript to that point, clears stale Codex session ids, and starts the next Codex turn from a fresh ACP session with local transcript context.

Researched: T3 Code supports this class of feature with git checkpoint capture/restore plus native Codex `thread/rollback` in its app-server runtime. Backlot's current ACP provider wrapper does not expose that native rollback request, so the implementation uses Backlot-level checkpoint restore and transcript state rewind instead.

Verified: `bun run build` passes. `bun run ts:check` is still blocked because the repo script calls a missing `tsgo` binary; fallback `tsc --noEmit` continues to show the existing baseline TypeScript errors noted above.

Shipped: replaced the `.fountain` click-to-edit flow with a CodeMirror 6 styled-source editor. Editing a screenplay no longer swaps the typeset page for a raw textarea — the buffer stays raw Fountain but is decorated to read like a screenplay leaf (centred Courier page, bold scene headings, indented dialogue/character cues, right-aligned transitions). New: `fountain-classify.ts` (per-line classifier), `fountain-decorations.ts` (CodeMirror line decorations), `fountain-source-editor.tsx`. `FountainEditor`/`fountain-editor.tsx` deleted; `FountainPreview` kept as the read-only typeset view behind the Code toggle. `.fountain` files now default into the editable editor.

Also redesigned `DiffSurface` (the pending-changes review view): one continuous unified diff instead of a stack of per-hunk cards — hunks joined into a single table with a thin location rail carrying Approve/Dismiss. Blank-line add/remove rows render slim and faint instead of as tall solid colour bars. Diff lines are now editable in place in the entity editor — click a `+`/context line, type, and the file is rewritten with that line swapped (`commitLineEdit`, wired via `paths`/`entities.write`).

## Session note — 2026-05-16

Shipped: merged the assistant rail thread-tab design pass from `claude/friendly-mclaren-0e13d1` into main. The rail now seeds recent threads as tabs, wraps and resizes the tab strip, shows provider icons, supports per-thread colors, keeps pinned tabs sorted first, and uses the shared `.bl-glass-button` treatment for both the active thread tab and the mode dock thumb.

Fixed: hardened thread rename handling across the mock API bridge and the `renameSubChat` router, including clearer renderer error toasts. New active threads now scroll into view in the wrapped tab strip.

Verified: `./node_modules/.bin/electron-vite build` passes when run with the bundled workspace Node runtime. Plain `bun run build` could not start in this shell because `bun` is not on PATH.

Shipped: merged the screenplay-pane diff dedupe from `claude/romantic-williamson-e265ce`. The screenplay pane now imports the shared `DiffSurface` and shared diff types instead of maintaining its own private near-duplicate diff renderer.

Shipped: integrated the Shotlist Split Desk redesign into main. The surface now uses a fixed scene bar, horizontal Parts strip, editable readable-measure Prompt column, read-only Screenplay column, draggable persisted split, version tabs, and a one-click Copy control. Added prompt version fields to `ShotPrompt` and the read-only `shotlists.readScript` query for the screenplay reference column.

Shipped: upgraded the built-in Shotlist MCP path for the split-desk view. The server now discovers scenes without opening screenplay files, writes full ordered Parts in one call, normalizes summaries and prompt versions, migrates reads from the brief nested shotlist path, and keeps `text` aligned with the active prompt-version tab. Updated the Backlot harness so Claude and Codex agents know to use Shotlist MCP tools for chat-driven prompt writing instead of hand-editing JSON or legacy prompt files.

Verified: `git diff --check` passes, and the Electron build passes with the bundled workspace Node runtime.

Shipped: redesigned the Shotlist surface around the screenplay as the index. Dropped the horizontal Parts strip. Each Part owns a contiguous `scriptRef` slice, and the slices joined in order reconstruct the scene screenplay. The Screenplay column is now one continuous editable Fountain leaf — the same styled-source CodeMirror surface as the Screenwriting editor (Courier paper page, scene headings bold, dialogue indented), not a stack of region cards. Dividers are block widgets on the seams between Parts, tracked through edits as a CodeMirror `StateField`; the Part under the cursor gets a faint wash and binds the Prompt column. "Split here" drops a divider at the cursor's line (⌘⇧↵), a divider's hover "merge" removes it, and plain typing streams slices back to the Parts model without disturbing the cursor. New file: `shotlist-screenplay.tsx`. Empty state offers "Import screenplay" (seeds one undivided Part from `scene.fountain`) or an empty Part. `ShotPrompt.scriptRef` re-documented as the owned slice (schema v1 unchanged — legacy shotlists still load).

Shipped: updated the Shotlist MCP tool descriptions and the Backlot harness for the owned-slice model. `shotlist_set_shots` is now framed as the decompose tool — split the screenplay into ordered Parts whose `scriptRef` slices concatenate with no gaps or overlaps. Placing/removing a divider maps to moving text between adjacent Parts' `scriptRef` values.

Adjusted: removed the screenplay text reader from the Shotlist MCP surface. Agents now use scene text already present in chat/UI context for shotlist decomposition, and ask for the needed scene/context instead of calling a file-read tool just to fetch screenplay text.

Verified: `tsc --noEmit` reports no new errors in the shotlist files (the repo's pre-existing baseline errors in unrelated files are unchanged); `node --check` passes on the Shotlist MCP server; `electron-vite build` passes. No live Electron UI run this session — the surface was not exercised in-app.

Shipped: removed the `backlot-shotlist` MCP server entirely. The shotlist is a plain `shotlist.backlot.json` file the agent reads and writes with `Read`/`Write` — the Shotlist surface already polls the file, so an MCP write layer was redundant CRUD that drove no UI change the poll didn't. Deleted `mcp/shotlist/`, dropped the builtin-server wiring from `claude.ts` and `codex.ts`. Normalization moved to the read path: `normalizeShotlist()` in `shared/shotlist-types.ts` fills missing ids/status/schemaVersion (deterministic position-based id fallback so polls don't thrash), called from `shotlists.read`. Rewrote the Backlot harness (v1.3 → v1.4): the "Shotlist conventions" section now teaches what a shotlist is, the JSON schema, and the edit rule — read the file, change only the Part(s) in scope, keep every other Part byte-identical, write the whole valid document back in one `Write`. Dropped the hand-copied shotlist-MCP tool list and the "do not read the screenplay" instruction; the agent now owns `scene.fountain` via `Read`/`Edit`. `electron-vite build` passes; no live UI run this session.

Shipped: redesigned the skill-change diff drawer (`SkillDiffDrawer`) as an editable, boxless surface. The diff body is no longer a read-only GitHub-style patch — it is the proposed SKILL.md as one editable CodeMirror document: no container fill, no card, no +/− gutter. A ViewPlugin re-diffs the live buffer against the on-disk content on every keystroke; changed lines carry a 2px Coral inset margin tick, removed lines render inline as faint struck-through ghost rows on the seam above their replacement (block widgets). The writer edits the document directly and Apply writes exactly what they see. Plumbed the edited buffer end to end: `ProposalResolution` now carries `finalContent`, `skills.resolveProposal` accepts it, and the `propose_skill_change` MCP tool writes the edited content (and tells the agent the user edited it). Apply is disabled when the draft matches the current file. `electron-vite build` passes; no live UI run this session.

Shipped: killed the Directions feature. Regular chats already ran in the project's single main checkout (`createChat` sets `worktreePath = project.path`) — only `forkDirection` still spun up worktrees. Removed `forkDirection` and `directionsForProject` from `chats.ts` plus the Direction-only helpers (`DIRECTION_PALETTE`, `pickDirectionColor`, `autoForkName`); kept `stripForkedSessionMetadata` since thread-level message inheritance still uses it. Dropped `baseBranch` / `branchType` / `useWorktree` from the `createChat` input. Renderer: removed the `LineageBreadcrumb` and its render, the dead `ForkActiveButton`, and the dead `DirectionsSection` / `DirectionRow` / `DirectionDot` / `buildDirectionRows` block from `screenplay-workspace.tsx` and `project-tree-rail.tsx`; "No direction" → "Untitled". Deleted the dead `agents-worktrees-tab.tsx` and the unused `AgentsProjectWorktreeTab` re-export. `electron-vite build` passes; no live UI run.

Shipped: fixed skills for the Claude agent with a curated preset. The agent no longer gets the user's whole `~/.claude/skills` library — it gets a **preset**: a factory default list (`BACKLOT_SKILL_REGISTRY`) that the user edits, persisted to `~/.backlot/skills-preset.json`. Rewrote `skills/filter.ts` as the preset module — `readSkillPreset` / `writeSkillPreset` / `getFactorySkillNames`, plus `buildSessionSkillsDir()` which rebuilds `<CLAUDE_CONFIG_DIR>/skills/` each session with one symlink per preset skill. `claude.ts` now calls `buildSessionSkillsDir` instead of whole-directory symlinking, drops the dead agents symlink and the `symlinksCreated` cache, and sets `settingSources: ["project", "user"]` — so the SDK discovers the curated skills as the "user" source. `CLAUDE.md` is still never symlinked, so the user's global memory file does not bleed in. `skills.ts` router swapped `registry`/`getFilter`/`setFilter`/`active` for `factory`/`getPreset`/`setPreset`. Rewrote the Skills settings tab around the preset: a searchable list of installed user skills, an Active switch per skill, factory skills marked, a "Reset to factory" control. `electron-vite build` passes; runtime not exercised. Codex still has no skills — separate (no MCP, would need prompt injection).

Shipped: added a **Project Memory** settings tab — a live editor for the active project's `CLAUDE.md`. New `projects.readClaudeMd` / `projects.writeClaudeMd` tRPC procedures (write checkpoints the file as a focused git commit when it was clean, so a settings edit never leaves the project dirty). New tab component `agents-project-memory-tab.tsx`, wired into the settings sidebar (after System Prompt), `SettingsTab` union, `settings-content` switch, and `settings-tabs/index.ts`. The editor seeds once per project so a background refetch never clobbers in-progress edits. `electron-vite build` passes; runtime not exercised.

Fixed: raised dark-theme contrast for inactive ModeDock labels. The dock keeps the same glass/thumb geometry; inactive labels now use the dock ink colour in dark mode instead of the page-muted token.

Fixed: preserved the dark-theme glass texture on the active ModeDock thumb. The lime thumb now opts into a dark-mode accent glass shadow recipe so its bevel/refraction lines remain visible against the dark shell.

Fixed: starting the first assistant thread no longer exposes or creates stale template diffs. Project-mode entity saves now settle into focused git commits when the target file was clean, matching the existing worktree-mode behavior, so edits made before a thread starts do not suddenly appear as agent pending changes. The entity editor is also remounted across project-root/chat-root and file changes, clearing pending autosave/TipTap state before the root switch can flush stale content into the selected path. Verified with `./node_modules/.bin/electron-vite build`.

Shipped: expanded the Settings prompt editing surfaces into wider, boxless, Notion-style editors. System Prompt and `CLAUDE.md` now use the full settings panel instead of the narrow wrapper, with borderless full-height textareas. The Project Memory tab is labeled `CLAUDE.md`. Skill instructions now open directly in a larger borderless editor, with preview still available from the toggle.

Verified: `electron-vite build` passes with the bundled Codex workspace Node runtime (`/Users/michael/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`). Running the same build with the shell's default Node failed before app code on Rollup's native optional package signature.

Fixed: removed the paper-card treatment from `scene.fountain` in both styled-source and preview modes. Fountain now sits on the same open canvas placement as markdown entities: max-width 720px, matching horizontal padding, transparent content background, and no border or shadow.

Verified: `electron-vite build` passes with the bundled Codex workspace Node runtime.

Fixed: hardened Codex chat startup in local dev. Backlot now falls back to an installed Codex CLI (`/Applications/Codex.app/...` or `codex` on PATH) when `resources/bin/<platform>/codex` has not been downloaded, builds Codex provider/CLI env from the login shell while restoring `CODEX_API_KEY` / `OPENAI_API_KEY`, chooses ACP key auth when those credentials exist, and avoids resuming stale Codex sessions for key-auth runs. Codex MCP env/header resolution now uses that same Codex env. Also removed the old 21st sub-chat-name API call so a Codex send no longer triggers Claude token refresh / 21st 404 noise before the agent turn.

Verified: upgraded `@zed-industries/codex-acp` to `0.14.0`; direct ACP probe through `streamText` returns `ok`; installed Codex CLI `mcp list --json` returns MCP server JSON; `git diff --check` passes; `bun run build` / `electron-vite build` passes. `bun run ts:check` is still blocked because the script calls missing `tsgo`; fallback `tsc --noEmit` remains blocked by the existing repo-wide baseline TypeScript errors.

Fixed: removed the Backlot logo/name wordmark from the left sidebar chrome while keeping the collapse control and spacing intact.

Fixed: aligned the collapsed file-tree rail with the projects sidebar chrome so the macOS traffic lights keep the same visual relationship when the projects panel is hidden. The file rail now uses the same shell inset/radius cadence as the projects panel, and the previously typed `setTrafficLightPosition` API is now wired through preload/main with a shared default/reset position.

Fixed: aligned the file-tree `Files` header to the same 40px macOS chrome row as the project path and top-bar buttons. Removed the file rail's extra top padding and made the root header an `h-10` row with centered label text.

Fixed: clicking or creating `.shotlist` files now classifies them as Shotlist entities, switches into Shotlist mode, and keeps the center pane on `ShotlistSurface` instead of falling back to the screenplay pane. The surface also resolves the selected shotlist back to its owning scene so non-canonical shotlist filenames open the matching scene context.

Verified: `git diff --check` passes and `./node_modules/.bin/electron-vite build` passes. A dev Electron launch built main/preload/renderer and started the app, then the process exited cleanly before an interactive screenshot pass.

Verified: `git diff --check` passes for the shotlist routing files, and `electron-vite build` passes with the bundled Codex workspace Node runtime. Full `tsc --noEmit` remains blocked by existing repo-wide baseline errors.

## Session note — 2026-05-17

Fixed: Shotlist and Multishot surfaces now use the same root selection as the file tree and entity editor. With an active chat they read/write that chat root; on the project home page they read/write the selected project root, so opening `shotlist.backlot.json` no longer shows "No scene context" just because no assistant thread is open. Also widened `entities.list` to resolve project roots as well as chat roots.

Fixed: removed the legacy `ScreenplayPane` fallback from Screenwriting mode when no file is selected. The center now stays on the regular entity editor placeholder instead of mounting the old `screenplay.fountain` surface with Editor / Preview / Split / History controls.

Verified: `git diff --check` passes, and `electron-vite build` passes with the bundled Codex workspace Node runtime. The default shell Node still fails before app code on Rollup's native optional package signature, matching the existing local build caveat.

Next: vestigial cleanup still pending — the worktree-setup-command section inside `agents-project-worktree-tab.tsx`, the `create-branch-dialog` branch picker in `new-chat-form.tsx`, the now-unused `src/main/lib/git/worktree*.ts`, and the `directionName` prop name. Also still open: prune the stale `~/.backlot/worktrees/daddy-issues/*` directories, the Codex skills story, rip out Ollama.

## Session note — 2026-05-17

Shipped: added Skill Workbench as a fifth workdesk mode next to Screenwriting, Prompts, Shotlist, and Canvas. It pairs the assistant rail with a multi-tab editor over the skills Backlot surfaces in Settings (`BACKLOT_SKILL_REGISTRY`). In this mode the left rail swaps the project file tree for a skill explorer: registry skills grouped by category, each an expandable folder so reference files shipped alongside `SKILL.md` are reachable. The center editor supports an optional side-by-side split — any tab can move to a second pane via its tab handle. Editing is direct + autosave; the agent's own skill edits still route through the existing `propose_skill_change` diff modal.

New: `skill-workbench` tRPC router (`list` registry skills + folders, `tree` a skill directory, `readFile`/`writeFile` with path containment, `focusEvents` subscription); `src/main/lib/skills/workbench-focus.ts` focus event bus; renderer `skill-workbench-view.tsx` (multi-tab split editor + `useOpenSkillFile`), `skill-explorer.tsx` (left-rail skill browser), `skill-workbench-focus-host.tsx` (subscription host). Added `viewModeAtom` `"skill"` member and three workbench atoms.

Shipped: new MCP tool `open_skill_workbench` on the in-process `backlot-skills` server. When the user says "let's modify/adapt the X skill", the agent calls it first to bring the skill on screen — it flips the app into Skill Workbench mode and opens the file via the focus bus. Fire-and-forget (no user verdict), live-only (never replayed on relaunch). Claude-only, like `propose_skill_change`.

Verified: `bun run build` passes. Not yet click-tested in-app.

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
