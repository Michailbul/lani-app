/**
 * Per-scene multishot model.
 *
 * One scene = one multishot file at `<scene folder>/multishot.backlot.json`,
 * sitting next to that scene's `scene.fountain`. A multishot pairs the
 * scene's screenplay with a single multi-shot generation prompt — the
 * "MULTI-SHOT, 12s — Shot 1… Shot 2…" form, where one clip covers several
 * shots.
 *
 * A multishot holds several **versions**. Each version is a complete take:
 * its own multi-shot prompt *and* its own division of the screenplay into
 * contiguous parts (the same divider model as a Shotlist). Switching the
 * active version swaps both the prompt and the screenplay split — so v1
 * and v2 can carve the same scene into shots in entirely different ways.
 *
 * `scriptParts` is the writer's working copy of the screenplay: seeded
 * from `scene.fountain`, editable on its own, not kept in sync with it.
 * Joining a version's parts in order reconstructs its whole screenplay; a
 * divider is just the seam between two parts. No hashing, no drift
 * detection — same philosophy as a Shotlist Part's `scriptRef`.
 */

import type { ShotStatus } from "./shotlist-types"

export type { ShotStatus }

/**
 * One drafted version of the multishot: a multi-shot prompt paired with
 * its own division of the scene screenplay.
 */
export interface MultishotVersion {
  /** The multi-shot generation prompt for this version. */
  prompt: string
  /**
   * The scene screenplay, divided into contiguous parts. Joining the
   * parts in order reconstructs the whole screenplay; a divider is the
   * seam between two parts. A single part = the undivided scene.
   */
  scriptParts: string[]
  /** Chinese (ZH) translation of the prompt. Optional. */
  zh?: string
}

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
   * All drafted versions — v1 is index 0. Each carries its own prompt and
   * its own screenplay division.
   */
  versions: MultishotVersion[]
  /** Index of the active version within `versions`. */
  activeVersion: number
  /**
   * Project-relative paths to reference / input images for this scene.
   * Shared across all versions — they're the scene's material.
   */
  referenceImages: string[]
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

/** Coerce raw JSON into a well-formed version, given a fallback screenplay. */
function normalizeVersion(
  raw: unknown,
  fallbackScreenplay: string,
): MultishotVersion {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >
  const rawParts = Array.isArray(v.scriptParts)
    ? (v.scriptParts as unknown[]).map((p) => asString(p))
    : null
  const scriptParts =
    rawParts && rawParts.length > 0 ? rawParts : [fallbackScreenplay]
  return {
    prompt: asString(v.prompt),
    scriptParts,
    ...(v.zh !== undefined ? { zh: asString(v.zh) } : {}),
  }
}

/**
 * Coerce raw `multishot.backlot.json` into a well-formed `SceneMultishot`.
 *
 * The agent can author this file directly with the Write tool, so a read
 * may hit a near-miss shape. This is the read-side safety net; it fills
 * the gaps so the Multishot surface always renders. It also migrates the
 * legacy shape — a flat `promptVersions` list with a single shared
 * `screenplay` string — into the per-version `versions` model. It does
 * not rescue invalid JSON — a syntax error still fails the parse upstream.
 */
export function normalizeMultishot(raw: unknown): SceneMultishot {
  const doc = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >

  // Legacy single screenplay — the seed for migrated versions.
  const legacyScreenplay = asString(doc.screenplay)

  let versions: MultishotVersion[]
  if (Array.isArray(doc.versions) && doc.versions.length > 0) {
    versions = (doc.versions as unknown[]).map((v) =>
      normalizeVersion(v, legacyScreenplay),
    )
  } else if (Array.isArray(doc.promptVersions)) {
    // Legacy: a flat prompt list + one shared screenplay.
    const prompts = (doc.promptVersions as unknown[]).map((p) => asString(p))
    const list = prompts.length > 0 ? prompts : [asString(doc.text)]
    versions = list.map((prompt) => ({
      prompt,
      scriptParts: [legacyScreenplay],
    }))
  } else {
    // Bare minimum — a single version from whatever prompt text exists.
    versions = [{ prompt: asString(doc.text), scriptParts: [legacyScreenplay] }]
  }

  let active = Number.isInteger(doc.activeVersion)
    ? (doc.activeVersion as number)
    : 0
  if (active < 0 || active >= versions.length) active = 0

  // Legacy single `zh` — attach to the active version when it has none.
  if (
    doc.zh !== undefined &&
    versions[active] &&
    versions[active]!.zh === undefined
  ) {
    versions[active] = { ...versions[active]!, zh: asString(doc.zh) }
  }

  const referenceImages = Array.isArray(doc.referenceImages)
    ? (doc.referenceImages as unknown[])
        .map((v) => asString(v))
        .filter((v) => v.length > 0)
    : []

  const status = doc.status as ShotStatus

  return {
    schemaVersion: 1,
    sceneId: asString(doc.sceneId, "scene"),
    sceneNumber: asString(doc.sceneNumber),
    heading: asString(doc.heading),
    scriptPath: asString(doc.scriptPath),
    versions,
    activeVersion: active,
    referenceImages,
    status: VALID_SHOT_STATUSES.includes(status) ? status : "draft",
    updatedAt: asString(doc.updatedAt),
  }
}
