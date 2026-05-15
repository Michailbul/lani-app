/**
 * Backlot-specific renderer atoms.
 *
 * Kept in their own file so multiple Backlot surfaces (workspace,
 * pane, project-tree) can subscribe without cyclic imports.
 */

import { atomWithStorage } from "jotai/utils"

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
      // Generic file — anything in the worktree that doesn't match the
      // canonical schema (brief / world / main-script / character /
      // location / act / scene / shot). The Cursor-style file tree
      // produces these for arbitrary user-created files.
      kind: "file"
      label: string
      path: string
    }
  | null

export const activeEntityAtom = atomWithStorage<ActiveEntity>(
  "backlot:active-entity",
  null,
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
// center; Prompts mode = a different surface (screenplay on the left
// for reference, prompt text-blocks in the center, chat right);
// Shotlist mode = the generation queue / prompt tracking surface. The
// user toggles between them as a workflow shift, not as a layout
// preference.
// ────────────────────────────────────────────────────────────────────────

export type ViewMode = "screenwriting" | "prompts" | "shotlist" | "canvas"

export const viewModeAtom = atomWithStorage<ViewMode>(
  "backlot:view-mode",
  "screenwriting",
)

// ────────────────────────────────────────────────────────────────────────
// Resizable rail / panel sizes — persisted across reloads.
// ────────────────────────────────────────────────────────────────────────

export const projectTreeWidthAtom = atomWithStorage<number>(
  "backlot:project-tree-width",
  260,
)

/** Fraction of the center pane width allocated to the Script panel. */
export const scriptPromptSplitAtom = atomWithStorage<number>(
  "backlot:script-prompt-split",
  0.5,
)

/** Height of the references panel in pixels (when expanded). */
export const refsPanelHeightAtom = atomWithStorage<number>(
  "backlot:refs-panel-height",
  140,
)
