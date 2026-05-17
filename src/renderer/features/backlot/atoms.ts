/**
 * Backlot-specific renderer atoms.
 *
 * Kept in their own file so multiple Backlot surfaces (workspace,
 * pane, project-tree) can subscribe without cyclic imports.
 */

import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { selectedProjectAtom } from "../agents/atoms"

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
  "backlot:active-entity-by-project",
  {},
)

export const activeEntityAtom = atom(
  (get) => {
    const projectId = get(selectedProjectAtom)?.id
    if (!projectId) return null
    return get(activeEntityByProjectAtom)[projectId] ?? null
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
  "backlot:project-tree-open",
  true,
)

// ────────────────────────────────────────────────────────────────────────
// View mode — the user's pipeline stage. Distinct surfaces, NOT a
// split. Screenwriting mode = the screenplay editor takes the whole
// center; Multishot mode = the scene's screenplay paired with one
// multi-shot generation prompt; Shotlist mode = the scene cut into Parts
// with per-Part prompts; Canvas mode = the visual board. The user toggles
// between them as a workflow shift, not as a layout preference.
// ────────────────────────────────────────────────────────────────────────

export type ViewMode =
  | "screenwriting"
  | "multishot"
  | "shotlist"
  | "canvas"
  | "skill"

// Remembered per project — each project keeps its own pipeline stage.
const viewModeByProjectAtom = atomWithStorage<Record<string, ViewMode>>(
  "backlot:view-mode-by-project",
  {},
)

export const viewModeAtom = atom(
  (get) => {
    const projectId = get(selectedProjectAtom)?.id
    if (!projectId) return "screenwriting" as ViewMode
    return get(viewModeByProjectAtom)[projectId] ?? "screenwriting"
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
// Skill Workbench — the mode for inspecting and editing the Agent SDK
// skills Backlot has access to. The left rail becomes a skill explorer
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

export const skillWorkbenchTabsAtom = atomWithStorage<SkillWorkbenchTab[]>(
  "backlot:skill-workbench-tabs",
  [],
)

/** Active tab id per pane. `null` = that pane has no active tab. */
export const skillWorkbenchActiveAtom = atomWithStorage<{
  left: string | null
  right: string | null
}>("backlot:skill-workbench-active", { left: null, right: null })

/** Fraction of the editor width given to the left pane when split. */
export const skillWorkbenchSplitAtom = atomWithStorage<number>(
  "backlot:skill-workbench-split",
  0.5,
)

// ────────────────────────────────────────────────────────────────────────
// Resizable rail / panel sizes — persisted across reloads.
// ────────────────────────────────────────────────────────────────────────

export const projectTreeWidthAtom = atomWithStorage<number>(
  "backlot:project-tree-width",
  260,
)

/**
 * Assistant rail — user-set base width in pixels. Drag the handle on the
 * rail's left edge to resize; persisted across reloads. The rendered rail
 * grows beyond this when the chat's inline Details panel opens (the extra
 * width is added on top in the workspace, leaving this base untouched).
 */
export const assistantRailWidthAtom = atomWithStorage<number>(
  "backlot:assistant-rail-width",
  420,
)

/** Assistant rail — open/closed. The toggle lives in the AppTopBar. */
export const assistantRailOpenAtom = atomWithStorage<boolean>(
  "backlot:assistant-rail-open",
  true,
)

// ────────────────────────────────────────────────────────────────────────
// Thread colours — a per-thread (sub-chat) accent the user picks from the
// tab's right-click menu. Renderer-only: keyed by sub-chat id, persisted
// to localStorage. Drives the tab's mode-icon tint and its selected-state
// ring so threads stay visually distinct at a glance.
// ────────────────────────────────────────────────────────────────────────

export const threadColorsAtom = atomWithStorage<Record<string, string>>(
  "backlot:thread-colors",
  {},
)

/**
 * Thread tab strip — user-resizable height in pixels. Drag the handle
 * below the strip to grow it and see more thread rows at once.
 */
export const threadStripHeightAtom = atomWithStorage<number>(
  "backlot:thread-strip-height",
  60,
)
