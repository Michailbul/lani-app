/**
 * Per-scene shotlist model.
 *
 * One scene = one shotlist file at `<scene folder>/shotlist.backlot.json`,
 * sitting next to that scene's `scene.fountain`. A shotlist is an ordered
 * list of Parts; each Part owns a slice of the scene's screenplay plus the
 * generation prompt that covers that slice.
 *
 * The screenplay lives in the shotlist itself: each Part's `scriptRef` is a
 * contiguous slice, and the slices joined in order reconstruct the full
 * scene screenplay. A divider is simply the boundary between two Parts.
 * This is a writer's working copy of the screenplay — it is seeded from
 * `scene.fountain` but is not kept in sync with it. No hashing, no drift
 * detection.
 *
 * Prompt `text` is deliberately generic: the language, the target model,
 * and the prompt style are the author's choice, not part of the schema.
 */

export type ShotStatus =
  | "draft"
  | "ready"
  | "submitted"
  | "generated"
  | "approved"

export interface ShotPrompt {
  /** Stable internal id — never shown to the user. */
  id: string
  /** Part number — its 1-based position in screenplay order. */
  number: string
  /** Shot size: WS / MS / CU / ECU / ... (free text). */
  plan: string
  /** Lens + camera movement. */
  camera: string
  /** Short title of the Part — what happens, in a few words. */
  action: string
  /**
   * A human-readable description of what this Part covers, written by the
   * agent alongside the prompt. Shown on the Part card so the writer can tell
   * parts apart at a glance. Optional — legacy parts have none.
   */
  summary?: string
  /**
   * The screenplay text this Part owns. In the Shotlist surface the scene's
   * screenplay is the ordered Parts: every `scriptRef` is a contiguous slice,
   * and the slices joined in order reconstruct the full scene screenplay. A
   * divider is the boundary between two Parts. Editable by the writer and
   * the agent; may be empty for a prompt drafted ahead of its screenplay.
   */
  scriptRef: string
  /**
   * The active generation prompt. Content is generic — language/model is
   * the author's choice. Mirrors `promptVersions[activeVersion]` so any
   * external reader (the agent, an export) sees the chosen version here.
   */
  text: string
  /**
   * All drafted versions of this shot's prompt — v1 is index 0. Optional:
   * when absent, the shot has a single version equal to `text`. A writer
   * keeps alternate prompt drafts and switches the active one.
   */
  promptVersions?: string[]
  /** Index of the active version within `promptVersions`. */
  activeVersion?: number
  /**
   * The Chinese (ZH) translation of this Part's prompt. Optional — the
   * writer toggles between the English prompt and this in the Shotlist
   * surface, and the agent fills it in on a translation request.
   */
  zh?: string
  /** Short label, e.g. duration / aspect ratio / a tag. */
  tag: string
  status: ShotStatus
  updatedAt: string
}

export interface SceneShotlist {
  schemaVersion: 1
  /** Matches the project scene entity id (the scene folder name). */
  sceneId: string
  /** Scene number — also written into the .fountain. */
  sceneNumber: string
  /** Scene heading, e.g. "INT. CAFE — DAY". */
  heading: string
  /** Project-relative path to the scene's screenplay. */
  scriptPath: string
  synopsis?: string
  shots: ShotPrompt[]
  updatedAt: string
}

/**
 * Coerce raw `shotlist.backlot.json` into a well-formed `SceneShotlist`.
 *
 * The agent authors this file directly with the Write tool, so a read
 * can hit a near-miss shape: a Part missing an `id`, an unknown status,
 * an absent `schemaVersion`. This is the read-side safety net — it fills
 * the gaps so the Shotlist surface always renders. Id fallback is
 * deterministic (position-based) so repeated polls don't thrash the
 * selected Part. It does not rescue invalid JSON — a syntax error still
 * fails the parse upstream.
 */
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

function normalizeShot(raw: unknown, index: number): ShotPrompt {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const hasVersions =
    Array.isArray(r.promptVersions) && r.promptVersions.length > 0

  let promptVersions: string[] | undefined
  let activeVersion: number | undefined
  let text = asString(r.text)
  if (hasVersions) {
    promptVersions = (r.promptVersions as unknown[]).map((v) => asString(v))
    activeVersion = Number.isInteger(r.activeVersion)
      ? (r.activeVersion as number)
      : 0
    if (activeVersion < 0 || activeVersion >= promptVersions.length) {
      activeVersion = 0
    }
    text = promptVersions[activeVersion] ?? ""
  }

  const status = r.status as ShotStatus
  return {
    id: asString(r.id) || `shot-${index + 1}`,
    number: asString(r.number, String(index + 1)),
    plan: asString(r.plan),
    camera: asString(r.camera),
    action: asString(r.action),
    ...(r.summary !== undefined ? { summary: asString(r.summary) } : {}),
    scriptRef: asString(r.scriptRef),
    text,
    ...(promptVersions ? { promptVersions, activeVersion } : {}),
    ...(r.zh !== undefined ? { zh: asString(r.zh) } : {}),
    tag: asString(r.tag),
    status: VALID_SHOT_STATUSES.includes(status) ? status : "draft",
    updatedAt: asString(r.updatedAt),
  }
}

export function normalizeShotlist(raw: unknown): SceneShotlist {
  const doc = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >
  const shots = Array.isArray(doc.shots) ? doc.shots : []
  return {
    schemaVersion: 1,
    sceneId: asString(doc.sceneId, "scene"),
    sceneNumber: asString(doc.sceneNumber),
    heading: asString(doc.heading),
    scriptPath: asString(doc.scriptPath),
    ...(doc.synopsis ? { synopsis: asString(doc.synopsis) } : {}),
    shots: shots.map((shot, index) => normalizeShot(shot, index)),
    updatedAt: asString(doc.updatedAt),
  }
}
