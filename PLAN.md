# Lani — Build Plan

> Companion to PRD.md. Tracks current state and the v1 build sequence. Update at the end of every session.

## Current state — 2026-05-05

v1 scope locked: **UI in place, auth in place, chat in the UI of Lani.** Ship the screenwriter-specific surface (Fountain editor, preview, direction tree, MCP tools) in v1.5+.

2026-05-24 session note:
- Changed Canvas page switching from a horizontally scrolling tab strip to a compact top-left page picker. The trigger shows the active page and opens a dropdown-style popover listing every page vertically; selecting a page still resets page-local state, and create/rename/delete remain wired to the existing canvas page mutations.
- Verified `git diff --check` and `bun run build` pass. Direct `tsc --noEmit` still reports the existing repo-wide baseline TypeScript errors outside `src/renderer/features/lani/canvas-mode-view.tsx`; no touched-file TypeScript error was reported.
- Fixed Shotlist screenplay Part selection so a single click on a Part now creates a real CodeMirror selection across that Part's `scriptRef` slice, not just the visual active-region wash. Cmd+C now copies the selected Part text after that click; a second click inside an already-selected Part still places the caret for editing/splitting.
- Added a Screenplay header Copy button that copies the active Part text directly and also selects that Part in the editor, so the visible selection, clipboard button, and keyboard copy path all agree.
- Replaced the duplicate root `AGENTS.md` file with a relative symlink to `CLAUDE.md`, keeping both agent instruction entry points identical.
- Verified `git diff --check` and `./node_modules/.bin/electron-vite build` pass. Repo-wide `./node_modules/.bin/tsc --noEmit --pretty false` still fails on existing baseline errors outside the shotlist component.

2026-05-20 session note:
- Added Canvas grouping as the first concrete support for Storyboard preset handoffs. Canvas now has a `group` node kind rendered as a visible dashed container behind normal nodes; selected Canvas nodes can be grouped from the UI, and group deletion clears stale child membership. The `lani-canvas` MCP server gained `canvas_add_group`, `canvas_group_nodes`, and `canvas_ungroup`, plus `groupId`/`groupLabel` support when adding prompt, text, image, and generation nodes. Updated the Lani harness to v1.14 so storyboard work creates a group whose label matches the storyboard thread/task title, e.g. `STORYBOARD ALPHA - SCENE 3 - SHOTS 4-7`.
- Preset handoff decision: the source thread agent should assemble the seed prompt/context first, then call the future app-control tool that asks the user whether to branch into a new thread or continue in place. If the user chooses a new thread, Lani creates/focuses the new tab and sends that already-built seed prompt as the first request.
- Verified `node --check mcp/canvas/index.mjs`, `git diff --check`, touched-path TypeScript filtering for Canvas/harness files, and `./node_modules/.bin/electron-vite build`. Repo-wide `tsc --noEmit` still fails on the existing baseline TypeScript errors outside the Canvas grouping slice.
- Added a built-in Harness MCP server (`lani-harness` / `harness_open_editor`) for review-first harness edits. When the agent is asked to update or inspect the harness, it writes a focus request instead of patching `~/.lani/harness-prompt.md` directly; the renderer polls for that request, switches the center edit area to Settings → Harness, and preloads optional proposed content for the user to save.
- Wired the Harness MCP into both Claude SDK sessions and Codex sessions alongside the Canvas MCP, and renamed the System Prompt settings tab to Harness. Harness v1.13 now instructs agents to use `harness_open_editor` for self-harness changes; Claude `Write`/`Edit` attempts against `~/.lani/harness-prompt.md` are denied with a review-in-editor message.
- Researched current official OpenAI Codex docs for subagents/custom agents against Lani's Claude Agent SDK `@agent` flow. Codex now has native subagent workflows and TOML custom agents, but Lani's default Codex runtime still uses ACP and does not currently register `@agent` mentions as Codex subagents; app-server support is present behind `LANI_CODEX_RUNTIME=app-server` and is the likely migration path.
- Added a Codex custom-agent bridge for Lani `@agent` mentions. Existing agent settings now generate Codex TOML agent configs under `~/.lani/codex-agents/`, Codex app-server receives those agents in session config, Codex ACP receives matching `-c agents.<name>...` overrides, and Codex subagent calls map into the existing Subagent UI. Verified a bridge smoke test, `git diff --check`, and `electron-vite build`; repo-wide `tsc --noEmit` is still blocked by existing baseline errors outside this slice.
- Tightened the Lani harness to v1.12. Screenwriting shots now require concise spatial context anchors: what the camera sees and where it happens in the scene geography, so a shot block still makes sense if read alone.
- Reframed the workdesk order as Screenwriting → Shotlist → Prompts → Skills, with Canvas and Queue as supporting surfaces; the ModeDock now follows that order.
- Updated the Lani harness to v1.11. Screenwriting mode now tells agents to write a director-screenwriter `.fountain` file: visible `SHOT A:` blocks, camera/framing/movement/composition on the page, and required bracketed dialogue emotion tags that describe only what can be seen or heard.
- Added Lani Fountain support for `SHOT ...` headings in the parser, styled source classifier, preview renderer, and CSS, so shot blocks no longer fall through as character cues. Character cues now support natural-case `[visible emotion]` tags while keeping the character name uppercase.
- Updated the director-verifier and shotlist type comments so shotlist coverage understands visible `SHOT ...` blocks inside `scene.fountain`.
- Verified `git diff --check`, `bun run build`, a harness focus request roundtrip, a Harness MCP stdio smoke test, a harness MCP instruction smoke test, and a Bun parser/classifier smoke test for `SHOT A:` plus `MARK [eyes wide, breath held]`.
- Next: do an in-app visual pass on the `SHOT ...` heading treatment and decide whether fresh Shotlist decomposition should default to one Part per visible shot block.
- Ported the image-stitch project's stitching into Canvas mode (auto justified-rows + manual canvas-position composite), plus a new Crop tool. Crop and Stitch now sit in the top-left instruments toolbar next to Prompt / Text / Generate / Image: Crop lights up when one image node is selected and opens a full-screen overlay with a draggable 8-handle crop rect; Stitch lights up at two or more selected image nodes and opens the existing stitch panel. The shared backend helper `persistDerivedCanvasPng` writes both crop and stitch PNGs under `assets/canvas/<kind>/` and drops a plain image node onto the canvas; new tRPC mutations `canvas.crop` and `canvas.stitch` plus an updated `canvas_assets.kind` ("imported" | "generated" | "stitched" | "cropped"). Image nodes themselves were reworked to drop the grey header strip — the filename now sits as a plain label above a full-bleed rounded image card with the output handle on the right edge.
- Drag-and-drop image import onto Canvas mode from two sources: OS/Finder (via the `webUtils.getPathForFile` preload bridge) and the in-app project file tree (image rows are now `draggable`, their project-relative path travels under the shared `application/x-lani-entity-path` MIME). Both paths route through `canvas.importImage` and show a dashed drop affordance.
- Verified `tsc --noEmit` introduces no new errors in touched files (`canvas/service.ts`, `routers/canvas.ts`, `canvas-mode-view.tsx`, `canvas-stitch.ts`, `canvas-crop-modal.tsx`, `project-file-tree.tsx`, `entity-kind.ts`, `asset-protocol.ts`).

2026-05-18 session note:
- Updated the Lani harness to explain the Shotlist Part mental model in plain language (`scriptRef`, `summary`, `plan`, `prompt`, `promptVersions`, `activeVersion`).
- Renamed the shotlist Part generation payload from `text` to `prompt` in the shared schema, Shotlist surface, prompt assembler, harness, and director-verifier copy. `normalizeShotlist()` still migrates legacy `text` fields on read.
- Added a repo memory rule: content schema changes must update `src/main/lib/claude/harness-prompt.ts` in the same change.
- Reworked Skill Workbench review around a git-backed `~/.lani/skills` ledger. The skill explorer now polls and shows changed-file badges/status pills, opening a dirty skill file shows a compact changed-lines strip, and each file can be saved as its own commit, discarded back to HEAD, or rolled back to a previous saved revision.
- Verified `bun run build` and `git diff --check` pass.

2026-05-09 session note:
- Hardened skill discovery so malformed personal `SKILL.md` YAML frontmatter is recovered with a concise warning instead of dumping a full YAML exception during chat startup.
- Changed Codex chat transport auth/request failures to close the UI stream with an error chunk instead of throwing through the stream controller, which avoids React concurrent-render recovery noise on send.
- Updated model defaults and selectors for current official model aliases: Codex `gpt-5.5`, Claude `claude-sonnet-4-6`, `claude-opus-4-7`, and `claude-haiku-4-5`.
- Verified the malformed `~/.claude/skills/laniameda-hq-update/SKILL.md` shape recovers name, description, and content; `bun run build` passes.

Six commits in:
1. `genesis` — PRD, plan, CLAUDE.md, naming, license attribution
2. `fork` — 1code source imported as Apache-2.0 substrate
3. `rename` — cosmetic 1code/21st → Lani branding
4. `plan` — Week 1 list refined
5. `strip` — ollama + sandbox-import removed, online-only stubs in place
6. `oauth` — MCP client name flipped to Lani

`bun install` running. Once green, `bun run dev` is the boot attempt.

## Session note — 2026-05-10

Shipped: tightened Lani markdown frontmatter rendering in the main editor preview so YAML `---` wrappers no longer draw duplicate horizontal rules, and removed the extra metadata-strip divider under the entity header.

Shipped: hardened Codex chat error handling in the renderer transport. Codex auth/request failures now render as assistant text and finish the UI stream instead of sending AI SDK `error` chunks that throw through React concurrent rendering during send.

Shipped: fixed forked Claude Directions resuming the parent session ID. Fork creation now strips parent Claude resume metadata from copied messages, and the Claude router only resumes from the database `sub_chats.session_id`, preventing stale renderer metadata from crashing Claude in the new worktree. Added inherited local transcript context for fresh fork sessions and a visible Directions section in the project rail for switching original/fork/current branches.

Shipped: added the project skill `.claude/skills/runway-shotlist-submission/SKILL.md` for submitting Lani shotlist prompts to Runway. It covers precise ZH-to-EN prompt translation, project-specific generation overrides, reuse-settings browser flow, and submission attempt logging.

Shipped: added the first Lani-native shotlist slice. HTML shotlists can be imported through the project file tree into `shotlist.lani.json` plus archived `source.html`; the parser preserves shot rows, beat ids, prompt grouping, Chinese prompts, imported English translations, and translation status. Added a shotlist editor surface for searchable rows, ZH/EN/Runway prompt editing, copy actions, and Runway submission attempt marking.

Shipped: added Shotlist as a separate Lani workdesk mode next to Screenwriting and Prompts. Clicking the masthead mode opens the shotlist surface, and importing or selecting a shotlist file switches the workdesk into that mode automatically.

Shipped: made Shotlist mode auto-load the first project shotlist instead of asking the user to pick a file. Added the Daddy Issues Scene 1 shotlist JSON/source HTML into the Daddy Issues project and active Lani worktrees from the existing skill-generated HTML export.

Fixed: mode navigation now treats Screenwriting, Prompts, and Shotlist as authoritative top-level workdesk modes. Auto-loading a shotlist no longer pins `activeEntityAtom` to a shotlist and traps the center pane in the Shotlist surface after switching modes.

Fixed: direct Lani editor saves no longer leave clean files as pending changes in chat worktrees. Entity and shotlist writes now auto-settle Lani-owned user edits into focused git commits when the file was clean before the save, while preserving pre-existing agent pending changes for review.

Fixed: project forking now refuses parent-repo git roots and requires an exact Lani project repo root before creating worktrees. Folder open/create paths normalize projects into `~/.lani/projects/<slug>/`, and an explicit project normalizer repairs older rows. Repaired the active Daddy Issues app DB row and chats to point at `/Users/michael/.lani/projects/daddy-issues` instead of the nested `laniameda-hq/AI Creatorship/daddy-issues` source.

Fixed: restored Codex CLI-backed subscription auth to match the current `21st-dev/1Code` implementation: bundled Codex downloader, `codex login` OAuth, `login status`, logout, and `mcp list --json` discovery are active again. Recorded `21st-dev/1Code` and `pingdotgg/t3code` as the ground-truth Codex/Claude auth references in `AGENTS.md` and `CLAUDE.md`; app-managed Codex API keys remain available as an override and now persist through main-process `safeStorage` with migration from the old renderer localStorage key.

Fixed: Lani thread creation now supports explicit provider selection. The workdesk thread menu and standard thread selector expose Branch into Claude, Branch into Codex, Start new chat with Claude, and Start new chat with Codex; the create-sub-chat mutation persists that provider and strips stale resume metadata when branching from an existing thread.

Fixed: the assistant input model picker now receives the active thread provider explicitly, so freshly-created Codex threads immediately show Codex models and reasoning controls instead of the Claude model list.

Fixed: freshly-created Codex threads no longer flip back to Claude after the chat query refetches. The sub-chat initializer now preserves existing local placeholder provider metadata, and transport creation falls back to store metadata when the refetched sub-chat row is not available yet.

Shipped: added Canvas v1 as a DB-backed workdesk mode. Canvas state lives in SQLite with prompt, image, image-generation, edge, asset, and run records; image binaries are stored under `assets/canvas/imported/` and `assets/canvas/generated/` in the active worktree. The built-in `lani-canvas` MCP server is wired into both Claude and Codex sessions so agents can read and mutate the canvas through tools instead of editing storage directly.

Fixed: renamed the persistent conversation model from `chats`/`sub_chats` to `worktrees`/`agent_threads`, including `worktree_id` canvas ownership columns and worktree-scoped canvas MCP/tRPC calls. Compatibility aliases remain in TypeScript while the broader renderer naming is migrated.

Next: run a visual pass in the app once the local browser/debug tooling is available; the repo-wide type check is still blocked by existing baseline TypeScript errors and the missing `tsgo` binary.

## Session note — 2026-05-15

Shipped: added Codex rollover support behind the existing Rollback beta switch. Codex assistant responses now capture Lani git checkpoints, rollback restores the worktree to the selected response, truncates the local transcript to that point, clears stale Codex session ids, and starts the next Codex turn from a fresh ACP session with local transcript context.

Researched: T3 Code supports this class of feature with git checkpoint capture/restore plus native Codex `thread/rollback` in its app-server runtime. Lani's current ACP provider wrapper does not expose that native rollback request, so the implementation uses Lani-level checkpoint restore and transcript state rewind instead.

Verified: `bun run build` passes. `bun run ts:check` is still blocked because the repo script calls a missing `tsgo` binary; fallback `tsc --noEmit` continues to show the existing baseline TypeScript errors noted above.

Shipped: replaced the `.fountain` click-to-edit flow with a CodeMirror 6 styled-source editor. Editing a screenplay no longer swaps the typeset page for a raw textarea — the buffer stays raw Fountain but is decorated to read like a screenplay leaf (centred Courier page, bold scene headings, indented dialogue/character cues, right-aligned transitions). New: `fountain-classify.ts` (per-line classifier), `fountain-decorations.ts` (CodeMirror line decorations), `fountain-source-editor.tsx`. `FountainEditor`/`fountain-editor.tsx` deleted; `FountainPreview` kept as the read-only typeset view behind the Code toggle. `.fountain` files now default into the editable editor.

Also redesigned `DiffSurface` (the pending-changes review view): one continuous unified diff instead of a stack of per-hunk cards — hunks joined into a single table with a thin location rail carrying Approve/Dismiss. Blank-line add/remove rows render slim and faint instead of as tall solid colour bars. Diff lines are now editable in place in the entity editor — click a `+`/context line, type, and the file is rewritten with that line swapped (`commitLineEdit`, wired via `paths`/`entities.write`).

## Session note — 2026-05-16

Shipped: merged the assistant rail thread-tab design pass from `claude/friendly-mclaren-0e13d1` into main. The rail now seeds recent threads as tabs, wraps and resizes the tab strip, shows provider icons, supports per-thread colors, keeps pinned tabs sorted first, and uses the shared `.bl-glass-button` treatment for both the active thread tab and the mode dock thumb.

Fixed: hardened thread rename handling across the mock API bridge and the `renameSubChat` router, including clearer renderer error toasts. New active threads now scroll into view in the wrapped tab strip.

Verified: `./node_modules/.bin/electron-vite build` passes when run with the bundled workspace Node runtime. Plain `bun run build` could not start in this shell because `bun` is not on PATH.

Shipped: merged the screenplay-pane diff dedupe from `claude/romantic-williamson-e265ce`. The screenplay pane now imports the shared `DiffSurface` and shared diff types instead of maintaining its own private near-duplicate diff renderer.

Shipped: integrated the Shotlist Split Desk redesign into main. The surface now uses a fixed scene bar, horizontal Parts strip, editable readable-measure Prompt column, read-only Screenplay column, draggable persisted split, version tabs, and a one-click Copy control. Added prompt version fields to `ShotPrompt` and the read-only `shotlists.readScript` query for the screenplay reference column.

Shipped: upgraded the built-in Shotlist MCP path for the split-desk view. The server now discovers scenes without opening screenplay files, writes full ordered Parts in one call, normalizes summaries and prompt versions, migrates reads from the brief nested shotlist path, and keeps `text` aligned with the active prompt-version tab. Updated the Lani harness so Claude and Codex agents know to use Shotlist MCP tools for chat-driven prompt writing instead of hand-editing JSON or legacy prompt files.

Verified: `git diff --check` passes, and the Electron build passes with the bundled workspace Node runtime.

Shipped: redesigned the Shotlist surface around the screenplay as the index. Dropped the horizontal Parts strip. Each Part owns a contiguous `scriptRef` slice, and the slices joined in order reconstruct the scene screenplay. The Screenplay column is now one continuous editable Fountain leaf — the same styled-source CodeMirror surface as the Screenwriting editor (Courier paper page, scene headings bold, dialogue indented), not a stack of region cards. Dividers are block widgets on the seams between Parts, tracked through edits as a CodeMirror `StateField`; the Part under the cursor gets a faint wash and binds the Prompt column. "Split here" drops a divider at the cursor's line (⌘⇧↵), a divider's hover "merge" removes it, and plain typing streams slices back to the Parts model without disturbing the cursor. New file: `shotlist-screenplay.tsx`. Empty state offers "Import screenplay" (seeds one undivided Part from `scene.fountain`) or an empty Part. `ShotPrompt.scriptRef` re-documented as the owned slice (schema v1 unchanged — legacy shotlists still load).

Shipped: updated the Shotlist MCP tool descriptions and the Lani harness for the owned-slice model. `shotlist_set_shots` is now framed as the decompose tool — split the screenplay into ordered Parts whose `scriptRef` slices concatenate with no gaps or overlaps. Placing/removing a divider maps to moving text between adjacent Parts' `scriptRef` values.

Adjusted: removed the screenplay text reader from the Shotlist MCP surface. Agents now use scene text already present in chat/UI context for shotlist decomposition, and ask for the needed scene/context instead of calling a file-read tool just to fetch screenplay text.

Verified: `tsc --noEmit` reports no new errors in the shotlist files (the repo's pre-existing baseline errors in unrelated files are unchanged); `node --check` passes on the Shotlist MCP server; `electron-vite build` passes. No live Electron UI run this session — the surface was not exercised in-app.

Shipped: removed the `lani-shotlist` MCP server entirely. The shotlist is a plain `shotlist.lani.json` file the agent reads and writes with `Read`/`Write` — the Shotlist surface already polls the file, so an MCP write layer was redundant CRUD that drove no UI change the poll didn't. Deleted `mcp/shotlist/`, dropped the builtin-server wiring from `claude.ts` and `codex.ts`. Normalization moved to the read path: `normalizeShotlist()` in `shared/shotlist-types.ts` fills missing ids/status/schemaVersion (deterministic position-based id fallback so polls don't thrash), called from `shotlists.read`. Rewrote the Lani harness (v1.3 → v1.4): the "Shotlist conventions" section now teaches what a shotlist is, the JSON schema, and the edit rule — read the file, change only the Part(s) in scope, keep every other Part byte-identical, write the whole valid document back in one `Write`. Dropped the hand-copied shotlist-MCP tool list and the "do not read the screenplay" instruction; the agent now owns `scene.fountain` via `Read`/`Edit`. `electron-vite build` passes; no live UI run this session.

Shipped: redesigned the skill-change diff drawer (`SkillDiffDrawer`) as an editable, boxless surface. The diff body is no longer a read-only GitHub-style patch — it is the proposed SKILL.md as one editable CodeMirror document: no container fill, no card, no +/− gutter. A ViewPlugin re-diffs the live buffer against the on-disk content on every keystroke; changed lines carry a 2px Coral inset margin tick, removed lines render inline as faint struck-through ghost rows on the seam above their replacement (block widgets). The writer edits the document directly and Apply writes exactly what they see. Plumbed the edited buffer end to end: `ProposalResolution` now carries `finalContent`, `skills.resolveProposal` accepts it, and the `propose_skill_change` MCP tool writes the edited content (and tells the agent the user edited it). Apply is disabled when the draft matches the current file. `electron-vite build` passes; no live UI run this session.

Shipped: killed the Directions feature. Regular chats already ran in the project's single main checkout (`createChat` sets `worktreePath = project.path`) — only `forkDirection` still spun up worktrees. Removed `forkDirection` and `directionsForProject` from `chats.ts` plus the Direction-only helpers (`DIRECTION_PALETTE`, `pickDirectionColor`, `autoForkName`); kept `stripForkedSessionMetadata` since thread-level message inheritance still uses it. Dropped `baseBranch` / `branchType` / `useWorktree` from the `createChat` input. Renderer: removed the `LineageBreadcrumb` and its render, the dead `ForkActiveButton`, and the dead `DirectionsSection` / `DirectionRow` / `DirectionDot` / `buildDirectionRows` block from `screenplay-workspace.tsx` and `project-tree-rail.tsx`; "No direction" → "Untitled". Deleted the dead `agents-worktrees-tab.tsx` and the unused `AgentsProjectWorktreeTab` re-export. `electron-vite build` passes; no live UI run.

Shipped: fixed skills for the Claude agent with a curated preset. The agent no longer gets the user's whole `~/.claude/skills` library — it gets a **preset**: a factory default list (`LANI_SKILL_REGISTRY`) that the user edits, persisted to `~/.lani/skills-preset.json`. Rewrote `skills/filter.ts` as the preset module — `readSkillPreset` / `writeSkillPreset` / `getFactorySkillNames`, plus `buildSessionSkillsDir()` which rebuilds `<CLAUDE_CONFIG_DIR>/skills/` each session with one symlink per preset skill. `claude.ts` now calls `buildSessionSkillsDir` instead of whole-directory symlinking, drops the dead agents symlink and the `symlinksCreated` cache, and sets `settingSources: ["project", "user"]` — so the SDK discovers the curated skills as the "user" source. `CLAUDE.md` is still never symlinked, so the user's global memory file does not bleed in. `skills.ts` router swapped `registry`/`getFilter`/`setFilter`/`active` for `factory`/`getPreset`/`setPreset`. Rewrote the Skills settings tab around the preset: a searchable list of installed user skills, an Active switch per skill, factory skills marked, a "Reset to factory" control. `electron-vite build` passes; runtime not exercised. Codex still has no skills — separate (no MCP, would need prompt injection).

Shipped: added a **Project Memory** settings tab — a live editor for the active project's `CLAUDE.md`. New `projects.readClaudeMd` / `projects.writeClaudeMd` tRPC procedures (write checkpoints the file as a focused git commit when it was clean, so a settings edit never leaves the project dirty). New tab component `agents-project-memory-tab.tsx`, wired into the settings sidebar (after System Prompt), `SettingsTab` union, `settings-content` switch, and `settings-tabs/index.ts`. The editor seeds once per project so a background refetch never clobbers in-progress edits. `electron-vite build` passes; runtime not exercised.

Fixed: raised dark-theme contrast for inactive ModeDock labels. The dock keeps the same glass/thumb geometry; inactive labels now use the dock ink colour in dark mode instead of the page-muted token.

Fixed: preserved the dark-theme glass texture on the active ModeDock thumb. The lime thumb now opts into a dark-mode accent glass shadow recipe so its bevel/refraction lines remain visible against the dark shell.

Fixed: starting the first assistant thread no longer exposes or creates stale template diffs. Project-mode entity saves now settle into focused git commits when the target file was clean, matching the existing worktree-mode behavior, so edits made before a thread starts do not suddenly appear as agent pending changes. The entity editor is also remounted across project-root/chat-root and file changes, clearing pending autosave/TipTap state before the root switch can flush stale content into the selected path. Verified with `./node_modules/.bin/electron-vite build`.

Shipped: expanded the Settings prompt editing surfaces into wider, boxless, Notion-style editors. System Prompt and `CLAUDE.md` now use the full settings panel instead of the narrow wrapper, with borderless full-height textareas. The Project Memory tab is labeled `CLAUDE.md`. Skill instructions now open directly in a larger borderless editor, with preview still available from the toggle.

Verified: `electron-vite build` passes with the bundled Codex workspace Node runtime (`/Users/michael/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`). Running the same build with the shell's default Node failed before app code on Rollup's native optional package signature.

Fixed: removed the paper-card treatment from `scene.fountain` in both styled-source and preview modes. Fountain now sits on the same open canvas placement as markdown entities: max-width 720px, matching horizontal padding, transparent content background, and no border or shadow.

Verified: `electron-vite build` passes with the bundled Codex workspace Node runtime.

Fixed: hardened Codex chat startup in local dev. Lani now falls back to an installed Codex CLI (`/Applications/Codex.app/...` or `codex` on PATH) when `resources/bin/<platform>/codex` has not been downloaded, builds Codex provider/CLI env from the login shell while restoring `CODEX_API_KEY` / `OPENAI_API_KEY`, chooses ACP key auth when those credentials exist, and avoids resuming stale Codex sessions for key-auth runs. Codex MCP env/header resolution now uses that same Codex env. Also removed the old 21st sub-chat-name API call so a Codex send no longer triggers Claude token refresh / 21st 404 noise before the agent turn.

Verified: upgraded `@zed-industries/codex-acp` to `0.14.0`; direct ACP probe through `streamText` returns `ok`; installed Codex CLI `mcp list --json` returns MCP server JSON; `git diff --check` passes; `bun run build` / `electron-vite build` passes. `bun run ts:check` is still blocked because the script calls missing `tsgo`; fallback `tsc --noEmit` remains blocked by the existing repo-wide baseline TypeScript errors.

Fixed: removed the Lani logo/name wordmark from the left sidebar chrome while keeping the collapse control and spacing intact.

Fixed: aligned the collapsed file-tree rail with the projects sidebar chrome so the macOS traffic lights keep the same visual relationship when the projects panel is hidden. The file rail now uses the same shell inset/radius cadence as the projects panel, and the previously typed `setTrafficLightPosition` API is now wired through preload/main with a shared default/reset position.

Fixed: aligned the file-tree `Files` header to the same 40px macOS chrome row as the project path and top-bar buttons. Removed the file rail's extra top padding and made the root header an `h-10` row with centered label text.

Fixed: clicking or creating `.shotlist` files now classifies them as Shotlist entities, switches into Shotlist mode, and keeps the center pane on `ShotlistSurface` instead of falling back to the screenplay pane. The surface also resolves the selected shotlist back to its owning scene so non-canonical shotlist filenames open the matching scene context.

Verified: `git diff --check` passes and `./node_modules/.bin/electron-vite build` passes. A dev Electron launch built main/preload/renderer and started the app, then the process exited cleanly before an interactive screenshot pass.

Verified: `git diff --check` passes for the shotlist routing files, and `electron-vite build` passes with the bundled Codex workspace Node runtime. Full `tsc --noEmit` remains blocked by existing repo-wide baseline errors.

## Session note — 2026-05-17

Fixed: Shotlist and Multishot surfaces now use the same root selection as the file tree and entity editor. With an active chat they read/write that chat root; on the project home page they read/write the selected project root, so opening `shotlist.lani.json` no longer shows "No scene context" just because no assistant thread is open. Also widened `entities.list` to resolve project roots as well as chat roots.

Fixed: removed the legacy `ScreenplayPane` fallback from Screenwriting mode when no file is selected. The center now stays on the regular entity editor placeholder instead of mounting the old `screenplay.fountain` surface with Editor / Preview / Split / History controls.

Verified: `git diff --check` passes, and `electron-vite build` passes with the bundled Codex workspace Node runtime. The default shell Node still fails before app code on Rollup's native optional package signature, matching the existing local build caveat.

Next: vestigial cleanup still pending — the worktree-setup-command section inside `agents-project-worktree-tab.tsx`, the `create-branch-dialog` branch picker in `new-chat-form.tsx`, the now-unused `src/main/lib/git/worktree*.ts`, and the `directionName` prop name. Also still open: prune the stale `~/.lani/worktrees/daddy-issues/*` directories, the Codex skills story, rip out Ollama.

## Session note — 2026-05-17

Shipped: real thread archive + permanent delete on the assistant rail. Closing a thread tab used to only drop it from the open-tab list (localStorage) — the thread stayed in the DB and the launch-time tab seed re-opened it, so "closed" threads reappeared on every relaunch. Now every removal path (tab X button, middle-click, context menu, ⌘W, bulk ⌘W) archives the thread: a new `agent_threads.archived_at` column (migration `0013_thread_archive`), set via `chats.archiveSubChat`. `chats.get` filters archived threads out, so they no longer tab, seed, or show in history. Archived threads are recoverable — they appear in the history ("Search chats") popover under an "Archived" badge and restore on select via `chats.unarchiveSubChat`; Cmd+Z within 10s also un-archives. The context menu also gained a destructive "Delete permanently" item wired to the existing hard-delete `chats.deleteSubChat`. New procedures: `archiveSubChat`, `unarchiveSubChat`, `listArchivedSubChats`.

Verified: `bun run ts:check` clean. Not click-tested — needs an in-app `bun run dev` pass (archive a tab, relaunch, restore from history, delete permanently).

Shipped: added Skill Workbench as a fifth workdesk mode next to Screenwriting, Prompts, Shotlist, and Canvas. It pairs the assistant rail with a multi-tab editor over the skills Lani surfaces in Settings (`LANI_SKILL_REGISTRY`). In this mode the left rail swaps the project file tree for a skill explorer: registry skills grouped by category, each an expandable folder so reference files shipped alongside `SKILL.md` are reachable. The center editor supports an optional side-by-side split — any tab can move to a second pane via its tab handle. Editing is direct + autosave; the agent's own skill edits still route through the existing `propose_skill_change` diff modal.

New: `skill-workbench` tRPC router (`list` registry skills + folders, `tree` a skill directory, `readFile`/`writeFile` with path containment, `focusEvents` subscription); `src/main/lib/skills/workbench-focus.ts` focus event bus; renderer `skill-workbench-view.tsx` (multi-tab split editor + `useOpenSkillFile`), `skill-explorer.tsx` (left-rail skill browser), `skill-workbench-focus-host.tsx` (subscription host). Added `viewModeAtom` `"skill"` member and three workbench atoms.

Shipped: new MCP tool `open_skill_workbench` on the in-process `lani-skills` server. When the user says "let's modify/adapt the X skill", the agent calls it first to bring the skill on screen — it flips the app into Skill Workbench mode and opens the file via the focus bus. Fire-and-forget (no user verdict), live-only (never replayed on relaunch). Claude-only, like `propose_skill_change`.

Verified: `bun run build` passes. Not yet click-tested in-app.

Shipped: skill-system rework — the agent now draws skills from one directory, `~/.lani/skills/`, loaded into the Claude Agent SDK as a local plugin (`~/.lani/.claude-plugin/plugin.json`) via the `plugins` option. This decouples skill discovery from `settingSources`, so `"user"` is dropped entirely — closing the `~/.claude/CLAUDE.md` leak (the `"user"` setting source reads `~/.claude/`, ignoring `CLAUDE_CONFIG_DIR`). `settingSources` is now `["project"]` or `[]`, gated by a new "Load project CLAUDE.md" preference. The SDK `skills` option filters to the active set; on/off is a disabled-set (`~/.lani/skills-disabled.json`).

New: `src/main/lib/skills/library.ts` — the `~/.lani/skills/` library: first-launch factory seeding from the bundle (with a content-hash manifest so app updates refresh only user-untouched skills), plugin manifest, disabled-set, preferences, import (symlink from `~/.claude/skills` + `~/.agents/skills`), remove, and publish-created-skill-to-`~/.claude/skills`. 22 curated factory skills + a Lani-adapted `skill-creator` are bundled in `resources/skills/` (shipped via `extraResources`). Removed `registry.ts` (`LANI_SKILL_REGISTRY`) and `filter.ts` (the old preset model).

Rewrote: `skills` router (library list, toggle, importable, import, importAll, remove, preferences, create); `skill-workbench` router + `skill-explorer` repointed to `~/.lani/skills/` as a flat list; `propose_skill_change` repointed and extended to handle skill *creation* (full-file review) plus publish-on-create; `agents-skills-tab.tsx` rebuilt as the library manager (active list + import panel + the two preference toggles); harness `Skills` section + `open_skill_workbench` point at `~/.lani/skills/`. `ensureLaniPlugin()` runs at app startup.

Verified: `bun run build` passes (1m10s). Not click-tested — the Settings tab, Skill Workbench, and a real agent session loading skills via the plugin need an in-app `bun run dev` pass. Watch the first-run console for the namespaced `skills` filter (`lani:<slug>`) behaving when a skill is disabled.

Shipped: Canvas mode UI redesign onto the Lani design system. Dropped the opaque hardcoded board fill (`#f7f3ee`/`#111315`) — the canvas root is now transparent so the workspace master surface and the ambient lime halo show through edge-to-edge, matching the editor page. The dot grid is a faint `--foreground`-token texture over that shared surface. Toolbars are `.bl-liquid-glass` islands with the `#bl-glass-displace` displacement filter (same liquid glass as the mode dock); nodes use `.bl-island`; edges, handles, and the prompt-node accent moved from blue/zinc to the Lime `--primary` token. Removed `useTheme`/`boardVars` — CSS tokens self-theme. Pending-connection pill repositioned above the mode dock.

Fixed: in-canvas controls were dead. The board root's pan handler ran on every press, including on toolbar/zoom/empty-state buttons, and `setPointerCapture` on the root redirected the click off the button so its `onClick` never fired. `onBoardPointerDown` now bails for `[data-canvas-ui]` chrome (as it already did for `[data-canvas-node]`); toolbars, zoom controls, the pending pill, and the Open Canvas button carry that attribute.

Shipped: prompt nodes are now editable. The static text div is a `PromptNodeBody` textarea — pointer-down stopped so a click places the caret instead of dragging the node, draft committed on blur via `updateNode` `data:{text}`, external (agent) edits flow back in while unfocused.

Shipped: Canvas interaction pass — four upgrades. (1) Box-select: a left-drag on empty canvas draws a marquee, nodes inside it select; Delete/Backspace or a contextual liquid-glass "Delete" pill removes them, Escape clears. (2) Trackpad navigation: a non-passive wheel listener pans on two-finger scroll and zooms on pinch/⌘-wheel toward the cursor — no modifier key needed; middle-drag still pans for mouse users. (3) Nodes gained a header strip as an explicit drag handle (icon + label); the node body is no longer the grab target, so clicking a prompt's textarea types instead of dragging. (4) Drag snap-back fixed — the local drag offset is held until the refetched node reports the new coordinates, instead of being cleared on pointer-up before the write round-trips.

Verified: `bun run ts:check` passes. Not yet click-tested in-app (Electron UI).

Fixed: the app load crash after the Skill Workbench merge. A bad persisted `lani:skill-workbench-tabs` localStorage value (`undefined::undefined`) made `SkillTab` call `.split()` on an undefined `relPath`, tearing down the React root after the page loaded. Skill Workbench tabs are now normalized on read/write so malformed persisted tabs are ignored. Also fixed the macOS traffic-light IPC handler to call Electron's `setWindowButtonPosition()` API instead of the nonexistent `setTrafficLightPosition()`.

Verified: captured the renderer error with `ELECTRON_ENABLE_LOGGING=1 bun run dev`, restarted the dev app after the fix, and confirmed it reaches the workspace without the `SkillTab` crash or traffic-light IPC exception. `bun run build` passes.

Shipped: image + video asset preview in screenwriting mode. Clicking a media file (`.png/.jpg/.webp/.gif/.svg/.avif` · `.mp4/.mov/.webm/.m4v/.ogv`) in the project tree opens a new `AssetPreviewPane` — the media floats on the ambient canvas inside a soft frame, with a liquid-glass toolbar (`.bl-liquid-glass` + the `#bl-glass-displace` displacement filter) carrying the kind chip, filename, dimensions/duration, and Expand / Open / Reveal-in-Finder actions. Clicking the media (or Expand) blows it up to a full-window lightbox (Esc closes). Media streams off disk over a new privileged `lani-asset://` protocol (`net.fetch` of a `file://` URL, Range header forwarded) — no base64, no size cap, video scrubs smoothly. New plumbing: `registerAssetScheme`/`registerAssetProtocolHandler` in `src/main/lib/asset-protocol.ts`, `lani-asset:` added to the renderer CSP `img-src`/`media-src`, `image`/`video` kinds on `ActiveEntity` + `isImagePath`/`isVideoPath` in `entity-kind.ts`, an `entities.resolvePath` tRPC query, and an `external.openPath` mutation.

Verified: `bun run build` passes; `tsc --noEmit` clean for all touched files. Not yet click-tested in-app (Electron UI).

Fixed: video asset preview requests now resolve in the app window's `persist:main` session. The privileged `lani-asset://` scheme was declared correctly, but the handler was attached to the default protocol object while every Lani window runs in a persistent partition. The handler now registers against `session.fromPartition("persist:main").protocol`, so `<video>` can load local clips through the same session that renders the UI.

Verified: `bun run build` passes. A dev-app restart opened the active Daddy Issues video selection and logged repeated `lani-asset://` requests for `references/cafe-scene-seedance.mp4` being served from disk, with no renderer video-load error.

Shipped: Finder drag-and-drop import for media in the Lani file tree. Dropping image/video files onto the Files header or any folder row copies them into that project/worktree folder, highlights the drop target, suffixes duplicate filenames instead of overwriting, refreshes the tree, and opens the last imported asset in the media preview. Unsupported dropped files are skipped with a toast.

Verified: `bun run build` and `git diff --check` pass. `bun run ts:check` is still blocked because the script calls missing `tsgo`; fallback `tsc --noEmit` remains blocked by existing repo-wide baseline TypeScript errors.

Shipped: image stitching on Canvas mode, ported from the laniameda image-stitch project. The disabled "Image" toolbar button now opens a native picker (`canvas.pickImages`) and drops the chosen files onto the board as image nodes; image nodes render an actual `<img>` preview over `lani-asset://` instead of showing a file path. Selecting two or more image nodes reveals a "Stitch" action — a floating `StitchPanel` with two modes: auto (justified-rows layout that packs the images into even rows) and manual (composites the images exactly where they sit on the canvas), plus row-height/spacing controls and a background fill (none/white/carbon). Compositing runs in the renderer with a `<canvas>` (`canvas-stitch.ts`), and the resulting PNG is persisted by `canvas.stitch` → `saveStitchedImage`, which writes the file under `assets/canvas/stitched/`, records a `stitched` asset, and drops the result as a plain image node below the selection. New plumbing: `Access-Control-Allow-Origin` on the `lani-asset://` responses so the canvas reads pixels back untainted, and `worktreePath` added to the canvas read snapshot so the renderer can build asset URLs.

Verified: `tsc --noEmit` clean for all touched files (`canvas-mode-view.tsx`, `canvas-stitch.ts`, `canvas/service.ts`, `routers/canvas.ts`, `asset-protocol.ts`); repo-wide baseline errors are unchanged. Not yet click-tested in-app.

Shipped: drag-and-drop image import onto Canvas mode, from two sources. (1) OS/Finder — dropping image files onto the canvas reads their paths via the `webUtils.getPathForFile` preload bridge, filters to images, and fans them out as image nodes at the drop point. (2) In-app — image rows in the project file tree are now `draggable`; the row puts its project-relative path on the drag payload under a shared `application/x-lani-entity-path` MIME (`CANVAS_DROP_MIME` in `entity-kind.ts`), and the canvas drop handler imports it via `canvas.importImage`. Both paths route through the existing `importCanvasImage` service. The canvas shows a dashed drop affordance while an image drag hovers; non-image drops are rejected with a toast.

Verified: `tsc --noEmit` introduces no new errors in touched files (`canvas-mode-view.tsx`, `project-file-tree.tsx`, `entity-kind.ts`) — confirmed against a stashed baseline. Not yet click-tested in-app.

## Session note — 2026-05-22

Merged: Canvas performance pass carried onto the newer multi-page / crop / stitch canvas. The final implementation keeps the richer main-worktree Canvas behavior while adding rAF-throttled viewport and connection-preview updates, viewport-based node/edge culling, memoized node/edge render components, and a transform hint on the board layer for smoother pan/zoom under larger boards.

Fixed: the first performance merge made Canvas pan/scroll feel stepped because React state, viewport culling, and edge filtering still ran on every wheel/drag frame. The hot viewport path now applies the board transform imperatively inside `requestAnimationFrame` and commits React viewport state after the gesture settles, so panning/zooming stays continuous while culling catches up cheaply.

Shipped: Canvas toolbar swap — dropped the **Prompt** add button (it duplicated **Text**; both already produce `textBlock` nodes under the hood) and replaced it with **Description**, a new node type. Description nodes are chrome-free editorial text blocks: no card border, no input or output handles (they never wire into image generation), resizable from the corner, with a floating mini formatting bar above the node when selected — font-size steppers (12–96), bold, italic, and a six-swatch colour palette (default, primary, muted, teal, linen, ember, all from brand tokens). Stored fields on the node: `text`, `fontSize`, `color` (id), `bold`, `italic`. Legacy `prompt` rows still in any DB render through the existing text-box visual unchanged.

New: `description` node type plumbed through `CanvasNodeType` in `src/main/lib/canvas/service.ts`, the `canvasNodeTypeSchema` enum in `routers/canvas.ts`, the type guard in `mcp/canvas/index.mjs`, and a `canvas_add_description` MCP tool (with `color` enum and `bold`/`italic` flags) so the agent can drop description blocks too. `defaultNodeSize` returns 360×160 for the new type. Harness prompt's Canvas section now teaches the agent when to reach for a description node vs a text node (editorial labels and contextual descriptions vs prompt-feeding text).

Verified: `tsc --noEmit` clean for `canvas-mode-view.tsx`, `canvas/service.ts`, `routers/canvas.ts`, and `schema/index.ts`; repo-wide baseline errors are unchanged. Not click-tested in-app — the canvas only runs inside the Electron window (preview-MCP can't drive Electron), so needs a `bun run dev` pass to confirm: click Description in the build toolbar, type into the placeholder, drag the corner to resize, select the node and step the font size, toggle bold/italic, pick a colour, deselect, re-select, drag-move, delete with ⌫. Also verify no input/output handle appears (description nodes are non-connectable).

## Session note — 2026-05-21

Fixed: the "Add to context ⌘L" popover no longer floats over the canvas. The popover was triggering on any selection inside a canvas text block via the `center-pane` source fallback (canvas mode tags its wrapper with `data-center-pane-mode="canvas"`), so a stale or partial selection inside a node left an orphan popover anchored to a now-irrelevant rect. The popover now skips when the source's mode starts with `canvas`; the canvas owns its own interactions (selection, drag-to-connect) and shouldn't double-broadcast through the chat popover. Edit landed in `src/renderer/features/agents/ui/text-selection-popover.tsx`.

Shipped: unified prompt-box and text-box on Canvas. Both are now one visual — a lightly bordered `bg-card/40` card with a right-side text-output handle that can wire into an `imageGeneration` node. New canvas nodes added by the agent via `canvas_add_prompt` now create `textBlock` rows (same node type as `canvas_add_text`), with the prompt-flavored default of 520×320 retained for long shot prompts. Legacy `prompt` rows still in the database render through the same text-box branch, so the canvas reads consistently regardless of when a node was added.

New: the MCP server validates `(textBlock | prompt).text → imageGeneration.prompt` (both source types are valid prompts now), and `generationInputs` reads `data.text` from either. Tool descriptions in `mcp/canvas/index.mjs` and the canvas section of `harness-prompt.ts` updated to describe one text-box type. Dropped the now-unused `PromptNodeBody` (the tap-to-edit `TextBlockNodeBody` is the single body component) and the dead `prompt` branches in the `Icon`/`label` computation.

Verified: `tsc --noEmit` clean for `canvas-mode-view.tsx`, `text-selection-popover.tsx`, `mcp/canvas/index.mjs`, and `harness-prompt.ts`; repo-wide baseline errors are unchanged. Not yet click-tested in-app — the unified renderer needs an Electron `bun run dev` pass to confirm tap-to-edit, drag-to-move, the right-edge connector starting a connection, and selection ring layering on top of the new border.

Fixed: the build toolbar (top-left) and the "1 selected" panel (top-center) collided on a narrow canvas — Crop and Stitch sat hidden behind the selection pill. Moved the selection panel to bottom-center (`bottom-6 left-1/2 -translate-x-1/2`), the standard Figma/Excalidraw slot. The pending-connection pill stays at `bottom-20`, so if both are visible they stack rather than overlap.

Shipped: Cmd+Z / Cmd+Shift+Z (Ctrl on Linux/Windows) undo and redo on Canvas, covering every action — add prompt/text/image-gen, image picker, in-app and Finder drop, delete, group, connect, stitch, crop, and node drag/resize/text-edit commits. Implemented as a session-local snapshot stack: before each mutating call, the renderer captures the full nodes+edges graph from `canvas.read` and pushes it; Cmd+Z pops, restores the previous via a new `canvas.applySnapshot` mutation, and the current state moves to a redo stack (any fresh action clears redo). Stack capped at 50. Crop and stitch work because the prior image asset stays on disk — restoring the node's data simply repoints it at the original `projectRelativePath`.

New: `applyCanvasSnapshot(worktreeId, snapshot)` in `src/main/lib/canvas/service.ts` — a transactional drop-and-reinsert of nodes and edges with the snapshot's original ids, so existing selection/drag references still resolve after the swap. Exposed via `canvas.applySnapshot` tRPC mutation in `routers/canvas.ts`. Renderer additions in `canvas-mode-view.tsx`: `CanvasSnapshot` type, `undoStackRef` / `redoStackRef`, `pushUndo` helper, `updateNodeWithUndo` wrapper passed into each `CanvasNodeShell`, and a Cmd/Ctrl+Z keydown branch that fires even from inside a textarea so typing in a prompt node doesn't strand the canvas at a stale state.

Verified: `tsc --noEmit` clean for `canvas-mode-view.tsx`, `mcp/canvas/index.mjs`, `routers/canvas.ts`, and `canvas/service.ts`; repo-wide baseline (~104 errors) unchanged. Not yet click-tested in-app — needs `bun run dev` to confirm Cmd+Z reverts each action type cleanly, the redo stack clears on a fresh action, and crop/stitch undo restores the pre-action node data without losing the file on disk.

Shipped: freeform drag-out crop + a much wider zoom ceiling. (1) Crop overlay no longer pre-fills with the full image — pressing inside an image node in crop mode now starts a drag-out rectangle from the press point, growing to the cursor and freezing on release. The drawn rect can still be moved by its body and resized from the 8 handles, and pressing anywhere outside the rect starts a fresh drag-out. Tap-without-drag clears the rect so the next press is also a fresh start. A discreet "Drag to select a crop area" hint shows over a faint dim while no rect exists yet. (2) Canvas `MAX_ZOOM` bumped from `1.8` to `6` (and `MIN_ZOOM` eased from `0.35` to `0.25`) so the writer can actually zoom in for pixel-level crop work; this also makes the zoom-in / zoom-out buttons and trackpad pinch usable across a much wider range. Touched: `src/renderer/features/lani/canvas-crop-overlay.tsx`, `src/renderer/features/lani/canvas-mode-view.tsx`.

Shipped: Cut-out crop mode + transparency-aware stitch. The crop pill now carries a Keep / Cut out toggle. **Keep** is the existing behavior — trim the image to the selection rect and shrink the node to that aspect. **Cut out** keeps the image at its original dimensions and punches the selection out as a transparent hole; the node's manual width/height survives intact so a writer can drop a replacement image over the void and merge the two with Stitch. The cut-out PNG is written under `assets/canvas/cutout/` (separate from `assets/canvas/cropped/`), the node carries a `cutout: true` flag, and the image card renders a transparency checker behind the picture so the hole reads as a real void instead of a confusing dark patch; a small `Cut-out` chip sits next to the filename in the node header. Manual stitch now sorts cut-out sources to the end of the draw order, so they paint last (on top) and let any replacement positioned over the hole show through. The whole crop/cut-out/stitch loop is undoable — the prior asset stays on disk, so Cmd+Z just repoints the node back at the original.

New: `mode?: "crop" | "cutout"` on `replaceImageOnNode` (`src/main/lib/canvas/service.ts`) and on the `canvas.replaceImage` tRPC input (`src/main/lib/trpc/routers/canvas.ts`). Cutout skips `computeImageNodeSize` so the node geometry survives. Renderer additions in `canvas-mode-view.tsx`: `cropMode` state, segmented Keep/Cut-out toggle in the crop pill, a `globalCompositeOperation = "destination-out"` branch in `applyCrop`, the checker-pattern backing for image nodes flagged `cutout: true`, and `isCutout` threaded into stitch sources. `canvas-stitch.ts` adds `isCutout?: boolean` to `StitchSource` and the manual-mode lift-to-top sort.

Verified: `tsc --noEmit` clean for `canvas-mode-view.tsx`, `canvas-crop-overlay.tsx`, `canvas-stitch.ts`, `canvas/service.ts`, and `routers/canvas.ts`; repo-wide baseline still 104 errors. Not click-tested in-app — needs `bun run dev` to confirm: cut out a region, drop a smaller image over the hole, select both, click Stitch (manual), verify the output is a clean composite with the cut-out on top.

Shipped: multiple canvas pages per worktree. The `canvas_documents` table already supported many named documents per worktree but the renderer + service hard-coded `name = "main"`. Now every page-scoped service call takes a `name`, the renderer holds an `activePage` per worktree (persisted to localStorage), and id-keyed ops (update/delete node, disconnect edge, connect, generate) derive their canvas from the node/edge row instead of resolving via the worktree+name pair — so they keep working regardless of which page hosts the entity. New service functions `listCanvasPages`, `createCanvasPage`, `deleteCanvasPage`, `renameCanvasPage` exposed via `canvas.listPages` / `createPage` / `deletePage` / `renamePage` tRPC procedures. `read`, `ensure`, `createNode`, `groupNodes`, `applySnapshot`, `importImage`, `pickImages`, `stitch` all carry a `page` field.

New UI: a bottom-left liquid-glass page selector — each existing page renders as a tab (active highlighted with `bg-primary/15`), click to switch, double-click to rename inline, hover-click `×` to delete (with a `confirm()` since deletion isn't in the per-page undo stack). A `+ New page` button at the end auto-names (`Page 2`, `Page 3`, …) skipping existing labels, and creates + switches in one trip. Page switches reset session state that doesn't carry across pages: undo/redo stacks, selection, pending connection, crop mode, stitch panel. A guard falls activePage back to `main` (or the first available page) if localStorage points at a page that was renamed or deleted elsewhere. Touched: `src/main/lib/canvas/service.ts`, `src/main/lib/trpc/routers/canvas.ts`, `src/renderer/features/lani/canvas-mode-view.tsx`.

Verified: `tsc --noEmit` clean for `canvas-mode-view.tsx`, `canvas/service.ts`, and `routers/canvas.ts`; repo-wide baseline still 104 errors. Not click-tested in-app — needs `bun run dev` to confirm: create a page, switch between pages (nodes from page A don't leak to page B), rename inline, delete a page (confirms, gives the remaining-pages fallback), and verify undo/redo resets on switch.

Shipped: agent-side canvas pages. The Canvas MCP server now mirrors the renderer's multi-page model — every existing tool gained an optional `page` field that defaults to `"main"`, and four new tools manage pages directly: `canvas_list_pages`, `canvas_create_page` (errors on collision), `canvas_rename_page` (errors on collision), `canvas_delete_page` (refuses to delete the only remaining page; FK cascade clears nodes + edges). Id-keyed tools (`canvas_update_node`, `canvas_delete_node`, `canvas_connect`, `canvas_disconnect`, `canvas_generate_image`) were refactored to derive their `canvas_id` from the node/edge row instead of resolving via worktree+name, so the agent can act on entities from any page without naming it. `canvas_read` now also returns the full `pages` list alongside the requested page's graph, so the agent can survey the worktree in one call. Harness prompt updated under "Canvas" to teach the agent the page model, the new tools, and the rule of threading `page` on every follow-up tool call after creating a new page.

Verified: `node --check` clean on `mcp/canvas/index.mjs`; `tsc --noEmit` clean for `harness-prompt.ts`; repo-wide baseline still 104 errors. Not click-tested with a real agent run — needs a `bun run dev` session where the agent creates a page ("make a new canvas page called 'Scene 3 boards'") and writes prompts into it (verifying via `canvas_list_pages` + by switching tabs in the renderer that the nodes only appear on that page).

## Week 1 — v1 backbone (UI + auth + chat)

- [x] `git init`, write PRD/PLAN/CLAUDE.md/README/NAMING
- [x] Fork 1code source into the repo
- [x] Cosmetic rename pass (1code/21st → Lani, paths, package metadata)
- [x] Strip ollama + sandbox-import routers, lib, callers (per scope: keep voice, agents, skills, plugins)
- [x] Flip OAuth `CLIENT_NAME` for MCP servers to `'Lani'` with `'Claude Code'` fallback
- [ ] `bun install` — running
- [ ] `bun run dev` — boot the app, confirm it renders the Lani identity
- [ ] OAuth into Anthropic via the existing flow (still routes through 21st.dev backend; acceptable for v1 boot, strip after baseline)
- [ ] Create a project, a chat (worktree), send a Claude message, see it stream
- [ ] First green-path screenshot saved to `docs/screenshots/v1-week1.png`

## v1 hardening (after first boot is green)

- [ ] Strip the 21st.dev backend coupling — `getBaseUrl`/`getAppUrl`, `auth-manager.ts` proxy auth, analytics phone-home, remote-trpc / remote-api
- [ ] Decide remote-agents UI fate (`features/agents/`): leave dead, hide behind a feature flag, or rewrite for native Anthropic auth
- [ ] Tighten `index.html` CSP `connect-src` once 21st.dev is gone
- [ ] Replace logo SVG with a Lani mark (placeholder OK for v1, brand pass refines)
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
