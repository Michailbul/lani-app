# Shotlist — PRD

> Product requirements for the shotlist — the core feature of Lani. This
> document defines what to build. It supersedes the earlier functional-spec
> draft of the same file.

## 1. Summary

A screenwriter has a scene. To make it as AI video, the scene has to become
a **shot breakdown** — an ordered list of shots, each with a generation
prompt. Today that work has no home: it happens ad hoc in chat or in
throwaway HTML.

The shotlist gives it one. For each scene, the agent builds a structured
shot breakdown; the writer refines it in a dedicated tab; the result is a
versioned file that stays tied to the screenplay.

## 2. Goals

- Turn a scene's screenplay into an ordered shot breakdown, one generation
  prompt per shot.
- The agent builds it; the writer refines it in place.
- Keep every shot tied to the screenplay by a shared shot number.
- Treat the shotlist as a first-class creative artifact — versioned, and
  carried along when a Direction is forked.

## 3. Non-goals (this version)

- Template-driven or agent-authored schemas and layouts.
- Reference-image attachments on shots.
- Running video generation inside Lani — prompts are handed off to an
  external generator.
- A multi-scene aggregate view — the tab works one scene at a time.

These are recorded in §12 and may be picked up later.

## 4. Users

- **The writer/director** — builds shotlists with the agent, edits prompts,
  switches between scenes, hands finished prompts to a generator.
- **The agent** — reads the screenplay, breaks the scene into shots, writes
  the shotlist through structured tools.

## 5. User stories

- As a writer, I ask the agent to break my scene into shots and watch the
  shotlist fill in live.
- As a writer, I read and edit a shot's prompt in place, and it saves.
- As a writer, I send one shot to the agent and ask it to revise that
  shot's prompt.
- As a writer, I switch between my scenes' shotlists from one tab.
- As the agent, I build a scene's shotlist through structured tools, and I
  keep it cross-referenced with the screenplay.

## 6. Functional requirements

### Storage and data model

- **FR-1** — One shotlist per scene, stored at
  `scenes/<id>/shotlist.lani.json` as plain JSON. No database.
- **FR-2** — The file holds scene metadata (`sceneId`, `sceneNumber`,
  `heading`, `scriptPath`) and an ordered list of shots.
- **FR-3** — Each shot has: `number`, `plan`, `camera`, `action`,
  `scriptRef`, prompt `text`, `tag`, `status`.
- **FR-4** — `status` is one of: draft, ready, submitted, generated,
  approved.
- **FR-5** — The file lives in the worktree, so it is git-versioned and is
  carried along when a Direction is forked.

### MCP — how the agent writes the shotlist

- **FR-6** — A built-in `lani-shotlist` MCP server is injected into
  every agent session, scoped to the worktree.
- **FR-7** — Tools: `shotlist_read`, `shotlist_init`, `shotlist_add_shot`,
  `shotlist_update_shot`, `shotlist_remove_shot`. A shotlist is addressed
  by the scene's `scriptPath`; the server derives the file path from it.
- **FR-8** — Each tool call is an atomic read-modify-write of the file.

### The agent workflow

- **FR-9** — Before writing, the agent gathers the scene's context:
  `scene.fountain` and `location.md` (scene-local), plus the `characters`
  named in the scene and `world.md` (project-wide).
- **FR-10** — The agent breaks the scene into shots and writes a prompt for
  each.
- **FR-11** — The agent mirrors each shot number into `scene.fountain` as a
  plain-text marker (`[Shot N]`).

### The Shotlist tab

- **FR-12** — A scene dropdown selects which scene's shotlist is shown.
- **FR-13** — Shots render as a list; every field is editable in place.
- **FR-14** — Edits autosave; each settled edit is a git checkpoint.
- **FR-15** — The tab live-updates while the agent is writing, so shots
  appear as they are created.
- **FR-16** — Each shot has an "add to context" action that sends the
  shot — number, action, prompt — into the agent chat as context.

### The Script ↔ Shotlist connection

- **FR-17** — The shot `number` is the link between the screenplay and the
  shotlist. It appears in both files. It is a convention — Lani does not
  hash or otherwise track it.

## 7. UX requirements

- **UX-1** — The prompt is the surface the writer reads. It renders as a
  block of text on the page — borderless, no card, line length capped for
  a readable measure, height growing with the content.
- **UX-2** — No cards, no nested boxes. Rows are separated by hairline
  dividers only.
- **UX-3** — Hovering a shot does not change its background.
- **UX-4** — Hierarchy comes from typography, not containers: technical
  fields in mono, the action as the headline, the prompt as body text.
- **UX-5** — Coral is the only accent color; one source of brand tokens, no
  raw hex.

## 8. Non-functional requirements

- **NFR-1** — Writes are atomic (temp file + rename); a crash mid-write
  never corrupts the shotlist.
- **NFR-2** — Agent writes surface in the tab within ~1.5s.
- **NFR-3** — The feature works inside a Direction worktree and survives a
  fork.

## 9. Dependencies — what else has to be wired

- `harness-prompt.ts` — encode the project layout, the context-gathering
  recipe, and the shot-numbering convention, so the agent builds correctly.
- `entities.ts` / `entity-kind.ts` — recognize `scenes/<id>/location.md`.
- `shotlist-builder` skill — rewrite so it calls the MCP instead of
  emitting HTML.
- A per-turn git commit of agent shotlist writes (so agent work checkpoints
  the same way writer edits do).

## 10. Success criteria

- A writer can ask the agent to build a scene's shotlist and watch it
  appear in the tab.
- The writer can edit any field, and switch between scenes.
- The agent reliably knows the project layout and keeps shot numbers
  consistent between the screenplay and the shotlist.
- The shotlist survives a Direction fork with its links intact.

## 11. Current state

Built and smoke-tested:

- Per-scene `shotlist.lani.json` and the data model (§6, FR-1–FR-5).
- The `lani-shotlist` MCP server (FR-6–FR-8), registered as a built-in.
- The Shotlist tab — scene dropdown, in-place editing, the borderless
  readable prompt, add-to-context, live polling (FR-12–FR-16, §7).

Not yet wired — the §9 dependencies, and a browser pass over the tab.

## 12. Deferred

Explored, designed, and parked — not in this version:

- **Template-driven schema** — per-project templates so the shot fields are
  data, not fixed.
- **Agent-authored layouts** — the agent composing custom shotlist layouts
  from a brand-styled component kit.
- **Reference-image attachments** — attaching reference images to shots.
