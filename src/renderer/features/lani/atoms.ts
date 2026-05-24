/**
 * Lani-specific renderer atoms.
 *
 * Kept in their own file so multiple Lani surfaces (workspace,
 * pane, project-tree) can subscribe without cyclic imports.
 */

import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { selectedProjectAtom } from "../agents/atoms"
import { activeEntityFromPath, labelFromFilename } from "./entity-kind"

// ────────────────────────────────────────────────────────────────────────
// Active entity — what the user has selected in the project tree.
//
// Used by:
//   - ScreenplayPane    → swaps content surface based on `kind`
//   - artifacts router  → resolves `entityPath` for read/write/diff
//   - claude.ts         → injects per-entity system-prompt block
//
// `null` = no entity selected; surfaces fall back to the legacy
// `screenplay.fountain` artifact for backwards compatibility with
// projects that pre-date the hierarchy.
// ────────────────────────────────────────────────────────────────────────

export type ActiveEntity =
  | {
      kind: "master-script"
      /** Legacy single-artifact path (screenplay.fountain). Kept for back-compat. */
      path: string
    }
  | {
      kind: "brief"
      path: string
    }
  | {
      kind: "world"
      path: string
    }
  | {
      kind: "main-script"
      path: string
    }
  | {
      kind: "character"
      id: string
      label: string
      path: string
    }
  | {
      kind: "location"
      id: string
      label: string
      path: string
    }
  | {
      kind: "act"
      id: string
      label: string
      /** Path to act.md notes file (may not exist on disk yet). */
      path: string
    }
  | {
      kind: "scene"
      id: string
      label: string
      /** Parent act id when the scene lives under acts/<actId>/scenes/...; null when flat. */
      actId?: string | null
      path: string
    }
  | {
      kind: "shot"
      sceneId: string
      id: string
      label: string
      path: string
    }
  | {
      kind: "shotlist"
      label: string
      path: string
    }
  | {
      kind: "multishot"
      label: string
      path: string
    }
  | {
      // The project's submission queue (queue.lani.json). Opens in
      // the Queue workdesk surface, not a text editor.
      kind: "queue"
      label: string
      path: string
    }
  | {
      // Image asset (png / jpg / webp / gif / svg …). Opens in the
      // AssetPreviewPane instead of a text editor.
      kind: "image"
      label: string
      path: string
    }
  | {
      // Video asset (mp4 / mov / webm …). Opens in the AssetPreviewPane.
      kind: "video"
      label: string
      path: string
    }
  | {
      // Generic file — anything in the worktree that doesn't match the
      // canonical schema (brief / world / main-script / character /
      // location / act / scene / shot). The Cursor-style file tree
      // produces these for arbitrary user-created files.
      kind: "file"
      label: string
      path: string
    }
  | null

// Remembered per project, so switching projects and back restores the
// surface the writer had open. Keyed by project id.
const activeEntityByProjectAtom = atomWithStorage<Record<string, ActiveEntity>>(
  "lani:active-entity-by-project",
  {},
)

export const activeEntityAtom = atom(
  (get) => {
    const projectId = get(selectedProjectAtom)?.id
    if (!projectId) return null
    const stored = get(activeEntityByProjectAtom)[projectId] ?? null
    if (!stored) return null
    if (typeof stored.path !== "string" || !stored.path) return null
    // A persisted entity freezes whatever `kind` the path heuristic
    // produced when it was first opened. Once the recognition rules
    // grow — e.g. multishot.lani.json gaining its own surface — an
    // entity saved earlier as a generic "file" would stay "file" and
    // open as raw JSON until re-clicked. Re-derive `kind` from the
    // stored path so classification is always current; the legacy
    // master-script artifact keeps its kind (its path would otherwise
    // re-derive to main-script).
    if (stored.kind === "master-script") {
      return { kind: "master-script" as const, path: stored.path }
    }
    const label =
      "label" in stored && typeof stored.label === "string"
        ? stored.label
        : labelFromFilename(stored.path.split("/").pop() ?? stored.path)
    return activeEntityFromPath(stored.path, label)
  },
  (get, set, entity: ActiveEntity) => {
    const projectId = get(selectedProjectAtom)?.id
    if (!projectId) return
    set(activeEntityByProjectAtom, {
      ...get(activeEntityByProjectAtom),
      [projectId]: entity,
    })
  },
)

// ────────────────────────────────────────────────────────────────────────
// Project tree rail — open/close state.
// ────────────────────────────────────────────────────────────────────────

export const projectTreeOpenAtom = atomWithStorage<boolean>(
  "lani:project-tree-open",
  true,
)

// ────────────────────────────────────────────────────────────────────────
// View mode — the user's pipeline stage. Distinct surfaces, NOT a split.
//
//   Screenwriting → the screenplay editor takes the whole center.
//   Shotlist      → a scene broken into shots. Holds two submodes (see
//                   shotlistSubmodeAtom): the Shotlist itself (many Parts)
//                   and the Multishot (one multi-shot prompt).
//   Skill         → the skill workbench.
//   Canvas        → the visual board.
//   Queue         → the submission tracker — prompts drafted in
//                   Shotlist/Multishot land here for execution.
//   Library       → the project's bookshelf of reusable workflows,
//                   character-sheet templates and saved prompts.
//
// The user toggles between them as a workflow shift, not a layout pref.
// ────────────────────────────────────────────────────────────────────────

export type ViewMode =
  | "screenwriting"
  | "shotlist"
  | "skill"
  | "canvas"
  | "queue"
  | "library"

// Remembered per project — each project keeps its own pipeline stage.
const viewModeByProjectAtom = atomWithStorage<Record<string, ViewMode>>(
  "lani:view-mode-by-project",
  {},
)

export const viewModeAtom = atom(
  (get) => {
    const projectId = get(selectedProjectAtom)?.id
    if (!projectId) return "screenwriting" as ViewMode
    const stored = get(viewModeByProjectAtom)[projectId]
    // Legacy: the standalone "multishot" mode is now a submode of
    // Shotlist — migrate any persisted value forward.
    if ((stored as string) === "multishot") return "shotlist"
    // Legacy: the project-wide "prompts" surface was removed; prompts
    // flow straight from Shotlist/Multishot into the Queue.
    if ((stored as string) === "prompts") return "queue"
    return stored ?? "screenwriting"
  },
  (get, set, mode: ViewMode) => {
    const projectId = get(selectedProjectAtom)?.id
    if (!projectId) return
    set(viewModeByProjectAtom, {
      ...get(viewModeByProjectAtom),
      [projectId]: mode,
    })
  },
)

// ────────────────────────────────────────────────────────────────────────
// Shotlist submode — the Shotlist mode holds two surfaces the user
// toggles between: the Shotlist (a scene cut into many Parts, each with
// its own prompt) and the Multishot (the scene kept whole, one multi-shot
// prompt). They are distinct workflows; the toggle just lives under one
// dock button. Remembered per project.
// ────────────────────────────────────────────────────────────────────────

export type ShotlistSubmode = "shotlist" | "multishot"

const shotlistSubmodeByProjectAtom = atomWithStorage<
  Record<string, ShotlistSubmode>
>("lani:shotlist-submode-by-project", {})

export const shotlistSubmodeAtom = atom(
  (get) => {
    const projectId = get(selectedProjectAtom)?.id
    if (!projectId) return "shotlist" as ShotlistSubmode
    return get(shotlistSubmodeByProjectAtom)[projectId] ?? "shotlist"
  },
  (get, set, submode: ShotlistSubmode) => {
    const projectId = get(selectedProjectAtom)?.id
    if (!projectId) return
    set(shotlistSubmodeByProjectAtom, {
      ...get(shotlistSubmodeByProjectAtom),
      [projectId]: submode,
    })
  },
)

// ────────────────────────────────────────────────────────────────────────
// Selected scene — shared by the Shotlist and Multishot surfaces so that
// toggling between the two submodes (or leaving and re-entering the mode)
// keeps the writer on the same scene. Remembered per project; `null` =
// no scene chosen yet, which lands the surface on its scene picker.
// ────────────────────────────────────────────────────────────────────────

const selectedSceneByProjectAtom = atomWithStorage<Record<string, string>>(
  "lani:selected-scene-by-project",
  {},
)

export const selectedSceneIdAtom = atom(
  (get) => {
    const projectId = get(selectedProjectAtom)?.id
    if (!projectId) return null
    return get(selectedSceneByProjectAtom)[projectId] ?? null
  },
  (get, set, sceneId: string | null) => {
    const projectId = get(selectedProjectAtom)?.id
    if (!projectId) return
    const next = { ...get(selectedSceneByProjectAtom) }
    if (sceneId) next[projectId] = sceneId
    else delete next[projectId]
    set(selectedSceneByProjectAtom, next)
  },
)

// ────────────────────────────────────────────────────────────────────────
// Skill Workbench — the mode for inspecting and editing the Agent SDK
// skills Lani has access to. The left rail becomes a skill explorer
// (registry skills, each a folder that may hold more than SKILL.md), the
// center is a multi-tab editor with an optional side-by-side split, and
// the assistant rail stays put so the user can ask the agent to adapt
// the skill in view.
//
// A tab is one file inside one skill folder. `skillDir` is stored
// absolute so a reload re-opens the same file without re-resolving the
// registry. `pane` decides which side of the split a file sits on; when
// no tab is on the right, the editor renders as a single full pane.
// ────────────────────────────────────────────────────────────────────────

export interface SkillWorkbenchTab {
  /** Stable id — `${skillName}::${relPath}`. */
  id: string
  skillName: string
  /** Absolute path of the skill's directory. */
  skillDir: string
  /** File path relative to `skillDir` (e.g. "SKILL.md"). */
  relPath: string
  pane: "left" | "right"
}

type SkillWorkbenchTabsUpdate =
  | SkillWorkbenchTab[]
  | ((current: SkillWorkbenchTab[]) => SkillWorkbenchTab[])

const rawSkillWorkbenchTabsAtom = atomWithStorage<unknown[]>(
  "lani:skill-workbench-tabs",
  [],
)

function normalizeSkillWorkbenchTabs(value: unknown): SkillWorkbenchTab[] {
  if (!Array.isArray(value)) return []

  const tabs: SkillWorkbenchTab[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const candidate = item as Partial<SkillWorkbenchTab>
    if (
      typeof candidate.skillName !== "string" ||
      typeof candidate.skillDir !== "string" ||
      typeof candidate.relPath !== "string"
    ) {
      continue
    }

    const skillName = candidate.skillName.trim()
    const skillDir = candidate.skillDir.trim()
    const relPath = candidate.relPath.trim()
    if (!skillName || !skillDir || !relPath) continue

    const id =
      typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id
        : `${skillName}::${relPath}`
    if (seen.has(id)) continue
    seen.add(id)

    tabs.push({
      id,
      skillName,
      skillDir,
      relPath,
      pane: candidate.pane === "right" ? "right" : "left",
    })
  }

  return tabs
}

export const skillWorkbenchTabsAtom = atom(
  (get) => normalizeSkillWorkbenchTabs(get(rawSkillWorkbenchTabsAtom)),
  (get, set, update: SkillWorkbenchTabsUpdate) => {
    const current = normalizeSkillWorkbenchTabs(get(rawSkillWorkbenchTabsAtom))
    const tabs = typeof update === "function" ? update(current) : update
    set(rawSkillWorkbenchTabsAtom, normalizeSkillWorkbenchTabs(tabs))
  },
)

/** Active tab id per pane. `null` = that pane has no active tab. */
export const skillWorkbenchActiveAtom = atomWithStorage<{
  left: string | null
  right: string | null
}>("lani:skill-workbench-active", { left: null, right: null })

/** Fraction of the editor width given to the left pane when split. */
export const skillWorkbenchSplitAtom = atomWithStorage<number>(
  "lani:skill-workbench-split",
  0.5,
)

// ────────────────────────────────────────────────────────────────────────
// Resizable rail / panel sizes — persisted across reloads.
// ────────────────────────────────────────────────────────────────────────

export const projectTreeWidthAtom = atomWithStorage<number>(
  "lani:project-tree-width",
  260,
)

/**
 * Assistant rail — user-set base width in pixels. Drag the handle on the
 * rail's left edge to resize; persisted across reloads. The rendered rail
 * grows beyond this when the chat's inline Details panel opens (the extra
 * width is added on top in the workspace, leaving this base untouched).
 */
export const assistantRailWidthAtom = atomWithStorage<number>(
  "lani:assistant-rail-width",
  420,
)

/** Assistant rail — open/closed. The toggle lives in the AppTopBar. */
export const assistantRailOpenAtom = atomWithStorage<boolean>(
  "lani:assistant-rail-open",
  true,
)

// ────────────────────────────────────────────────────────────────────────
// Thread colours — a per-thread (sub-chat) accent the user picks from the
// tab's right-click menu. Renderer-only: keyed by sub-chat id, persisted
// to localStorage. Drives the tab's mode-icon tint and its selected-state
// ring so threads stay visually distinct at a glance.
// ────────────────────────────────────────────────────────────────────────

export const threadColorsAtom = atomWithStorage<Record<string, string>>(
  "lani:thread-colors",
  {},
)

/**
 * Thread tab strip — user-resizable height in pixels. Drag the handle
 * below the strip to grow it and see more thread rows at once.
 */
export const threadStripHeightAtom = atomWithStorage<number>(
  "lani:thread-strip-height",
  60,
)

/**
 * Library mode — width of the detail panel that slides in from the
 * right when a workflow card is opened. Resizable via the panel's
 * left edge; min/max clamps live in the surface so the gallery
 * always has a sensible amount of room beside it.
 */
export const libraryPanelWidthAtom = atomWithStorage<number>(
  "lani:library-panel-width",
  520,
)

/**
 * Library mode — height of the detail panel's hero image strip.
 *
 * `0` is a sentinel that means "use the native 16:9 aspect of the
 * panel's current width" — the hero defaults to a cinematic frame
 * and adapts as the panel is resized. Once the user grabs the handle
 * to deviate from 16:9, the explicit pixel height is stored and
 * persisted. Clamped in the surface so the body always has room.
 */
export const libraryHeroHeightAtom = atomWithStorage<number>(
  "lani:library-hero-height",
  0,
)

/**
 * Transient — how many pixels at the right edge of the workspace
 * are currently occupied by an open overlay panel (e.g. the Library
 * detail panel). The floating ModeDock reads this and shifts left
 * by the same amount so it always centres over the *visible*
 * canvas, never under an open panel. Not persisted; resets to 0 on
 * navigation away.
 */
export const workspaceRightInsetAtom = atom<number>(0)
