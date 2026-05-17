/**
 * Per-scene multishot model.
 *
 * One scene = one multishot file at `<scene folder>/multishot.backlot.json`,
 * sitting next to that scene's `scene.fountain`. A multishot pairs the
 * scene's whole screenplay with a single multi-shot generation prompt — the
 * "MULTI-SHOT, 12s — Shot 1… Shot 2…" form, where one clip covers several
 * shots.
 *
 * `screenplay` is the writer's working copy: seeded from `scene.fountain`,
 * editable on its own, not kept in sync with it. No hashing, no drift
 * detection — same philosophy as a Shotlist Part's `scriptRef`.
 *
 * Distinct from the Shotlist model: a Shotlist cuts the scene into many
 * Parts, each with its own slice and prompt; a Multishot keeps the scene
 * whole and carries exactly one prompt.
 */

import type { ShotStatus } from "./shotlist-types"

export type { ShotStatus }

export interface SceneMultishot {
  schemaVersion: 1
  /** Matches the project scene entity id (the scene folder name). */
  sceneId: string
  /** Scene number — also written into the .fountain. */
  sceneNumber: string
  /** Scene heading, e.g. "INT. CAFE — DAY". */
  heading: string
  /** Project-relative path to the scene's screenplay. */
  scriptPath: string
  /**
   * The writer's working copy of the scene screenplay. Seeded from
   * `scene.fountain` when the multishot is started, then editable on its
   * own.
   */
  screenplay: string
  /** All drafted versions of the multishot prompt — v1 is index 0. */
  promptVersions: string[]
  /** Index of the active version within `promptVersions`. */
  activeVersion: number
  /** Mirror of `promptVersions[activeVersion]` — the chosen draft. */
  text: string
  /** Chinese (ZH) translation of the prompt. Optional. */
  zh?: string
  status: ShotStatus
  updatedAt: string
}

const VALID_SHOT_STATUSES: readonly ShotStatus[] = [
  "draft",
  "ready",
  "submitted",
  "generated",
  "approved",
]

function asString(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}

/**
 * Coerce raw `multishot.backlot.json` into a well-formed `SceneMultishot`.
 *
 * The agent can author this file directly with the Write tool, so a read
 * may hit a near-miss shape — missing `promptVersions`, an unknown status,
 * an absent `schemaVersion`. This is the read-side safety net; it fills the
 * gaps so the Multishot surface always renders. It does not rescue invalid
 * JSON — a syntax error still fails the parse upstream.
 */
export function normalizeMultishot(raw: unknown): SceneMultishot {
  const doc = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >

  const rawVersions = Array.isArray(doc.promptVersions)
    ? (doc.promptVersions as unknown[]).map((v) => asString(v))
    : []
  const versions = rawVersions.length > 0 ? rawVersions : [asString(doc.text)]
  let active = Number.isInteger(doc.activeVersion)
    ? (doc.activeVersion as number)
    : 0
  if (active < 0 || active >= versions.length) active = 0

  const status = doc.status as ShotStatus

  return {
    schemaVersion: 1,
    sceneId: asString(doc.sceneId, "scene"),
    sceneNumber: asString(doc.sceneNumber),
    heading: asString(doc.heading),
    scriptPath: asString(doc.scriptPath),
    screenplay: asString(doc.screenplay),
    promptVersions: versions,
    activeVersion: active,
    text: versions[active] ?? "",
    ...(doc.zh !== undefined ? { zh: asString(doc.zh) } : {}),
    status: VALID_SHOT_STATUSES.includes(status) ? status : "draft",
    updatedAt: asString(doc.updatedAt),
  }
}
