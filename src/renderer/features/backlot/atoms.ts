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
      /** Always "screenplay.fountain" — the legacy single-artifact path. */
      path: string
    }
  | {
      kind: "world"
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
      kind: "scene"
      id: string
      label: string
      path: string
    }
  | {
      kind: "shot"
      sceneId: string
      id: string
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
