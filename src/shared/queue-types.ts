/**
 * Project submission queue.
 *
 * One project = one queue file at `queue.lani.json` in the project
 * (or worktree) root. The queue is a tracker: prompts drafted in the
 * Multishot or Shotlist surfaces are pushed into it, and an external
 * agent reads the file, submits each prompt to a video model (Runway),
 * and writes the result back — flipping `status` and bumping
 * `submissionCount`.
 *
 * It is a plain JSON file with no MCP layer: the agent `Read`s and
 * `Edit`s it, the Queue surface polls it, so changes show up live on
 * both sides.
 *
 * Reference images for a queued prompt are *copied* into
 * `queue-media/<itemId>/` at the root when the item is added — the
 * queue item is self-contained and survives edits or deletion of the
 * scene it came from.
 */

/** The active queue file — sits at the project/worktree root. */
export const QUEUE_FILE_RELPATH = "queue.lani.json"

/**
 * The archive file — kept separate from the active queue so the
 * working document stays lean. Archiving an item moves it out of
 * `queue.lani.json` and into this file; restoring moves it back.
 */
export const QUEUE_ARCHIVE_RELPATH = "queue-archive.lani.json"

/** Per-item reference images are copied under this root folder. */
export const QUEUE_MEDIA_DIR = "queue-media"

export type QueueStatus = "pending" | "submitted"

/**
 * Where a queue row came from.
 *
 * - `multishot` / `shotlist` — pushed in from those surfaces with a real
 *   scene id and label.
 * - `manual` — created in the Queue surface itself via the "+ New" button.
 *   No scene context; the writer fills the prompt directly on the row.
 */
export type QueueSourceMode = "multishot" | "shotlist" | "manual"

export interface QueueItem {
  /** Stable id — also the name of this item's `queue-media/` folder. */
  id: string
  /** The EN generation prompt to submit. */
  prompt: string
  /** Optional ZH translation of the prompt. */
  zh?: string
  /** Project-relative paths under `queue-media/<id>/`. */
  referenceImages: string[]
  /** `pending` until the external agent submits it, then `submitted`. */
  status: QueueStatus
  /**
   * The iterator — how many times this prompt has been submitted. The
   * external agent bumps it on every submission attempt; the count
   * persists even if `status` is reset to `pending` for a re-run.
   */
  submissionCount: number
  /** Where the prompt came from — for provenance on the queue row. */
  source: {
    mode: QueueSourceMode
    /** The originating scene id. */
    sceneId: string
    /** Human-readable origin, e.g. "Scene 1 — INT. CAFE" or "Part 03". */
    label: string
    /**
     * The scene name / slug shown in the Source column of the queue table,
     * e.g. "INT. COFFEE SHOP — DAY". Falls back to `label` when absent.
     */
    sceneName?: string
    /**
     * The part / shot identifier within the scene, e.g. "Part 03" or
     * "Shot 2". Shown as a sub-label under the scene name.
     */
    partLabel?: string
  }
  /**
   * A short excerpt of the screenplay text (action line, dialogue, etc.)
   * that this prompt was derived from — shown in the Script column of the
   * queue table so the writer can trace every shot back to the page.
   */
  scriptExcerpt?: string
  /** ISO-8601 — when the item was added to the queue. */
  addedAt: string
  /** ISO-8601 — last edit (status flip, count bump, …). */
  updatedAt: string

  /**
   * ISO-8601 set when the item was archived. Present only on items
   * that live in `queue-archive.lani.json` — which file an item
   * sits in is the source of truth for active vs. archived; this
   * timestamp records *when* it was archived for the history view.
   */
  archivedAt?: string
  /** A keep / favourite flag the writer toggles on a submission. */
  liked: boolean
  /** A free-text note the writer attaches to the submission. */
  comment?: string
  /**
   * Project-relative path to the linked result video — the generated
   * clip — copied into `queue-media/<id>/`. Absent until one is linked.
   */
  resultVideo?: string
  /**
   * The Runway asset/project name — e.g. "daddy-issues-shot01-v2".
   * Filled in by the writer or external agent so submissions can be
   * traced back to a specific Runway asset by name.
   */
  runwayName?: string
  /**
   * The Runway (or other video-model) URL for the generated clip — the
   * direct link the external agent or writer pastes after submission.
   * Stored as-is; rendered as a clickable link in the queue table.
   */
  runwayUrl?: string
  /**
   * How many generation runs to request for this prompt. The external
   * agent reads this to decide how many times to submit the same prompt.
   * Defaults to 1 when absent.
   */
  repeatCount?: number
  /**
   * Per-submission override instructions — free-text directions the
   * external agent must respect for this specific submission. When
   * present, these supersede whatever standing submission instructions
   * the writer (or the submission skill) would otherwise apply. Lives
   * alongside `runwayUrl` because it is part of the submission
   * configuration, not the prompt itself.
   */
  customInstructions?: string
}

/**
 * Self-documenting field descriptions written into the queue JSON on
 * every save. Lets a human or external agent crack open the file and
 * understand each non-obvious field without needing to look at the
 * Lani source. Keyed by field name on `QueueItem`.
 */
export const QUEUE_FIELD_DESCRIPTIONS: Record<string, string> = {
  customInstructions:
    "overrides any instructions for that specific submission, if present",
}

export interface SubmissionQueue {
  schemaVersion: 1
  /**
   * Field-level descriptions for non-obvious item fields. Written on
   * every save so the JSON document is self-documenting; readers may
   * ignore it.
   */
  fieldDescriptions?: Record<string, string>
  items: QueueItem[]
  updatedAt: string
}

const VALID_QUEUE_STATUSES: readonly QueueStatus[] = ["pending", "submitted"]
const VALID_SOURCE_MODES: readonly QueueSourceMode[] = [
  "multishot",
  "shotlist",
  "manual",
]

function asString(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}

function normalizeItem(raw: unknown, index: number): QueueItem {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >

  // Legacy items may carry a `versions[]` array from earlier builds.
  // Fold the active version (or version 0) into the top-level fields so
  // the rest of the system can ignore the old shape.
  const rawVersions = Array.isArray(r.versions) ? r.versions : null
  let prompt = asString(r.prompt)
  let zh = r.zh !== undefined ? asString(r.zh) : undefined
  let referenceImages = Array.isArray(r.referenceImages)
    ? (r.referenceImages as unknown[])
        .map((v) => asString(v))
        .filter((v) => v.length > 0)
    : []

  if (rawVersions && rawVersions.length > 0) {
    const rawActive = Number(r.activeVersion)
    const activeIdx =
      Number.isFinite(rawActive) &&
      rawActive >= 0 &&
      rawActive < rawVersions.length
        ? Math.floor(rawActive)
        : 0
    const v = (rawVersions[activeIdx] && typeof rawVersions[activeIdx] === "object"
      ? rawVersions[activeIdx]
      : {}) as Record<string, unknown>
    prompt = asString(v.prompt) || prompt
    zh = v.zh !== undefined ? asString(v.zh) : zh
    const vRefs = Array.isArray(v.referenceImages)
      ? (v.referenceImages as unknown[])
          .map((x) => asString(x))
          .filter((x) => x.length > 0)
      : null
    if (vRefs) referenceImages = vRefs
  }

  const status = r.status as QueueStatus

  const rawCount = Number(r.submissionCount)
  const submissionCount =
    Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 0

  const src = (r.source && typeof r.source === "object" ? r.source : {}) as
    Record<string, unknown>
  const srcMode = src.mode as QueueSourceMode

  return {
    id: asString(r.id) || `q-${index + 1}`,
    prompt,
    ...(zh !== undefined ? { zh } : {}),
    referenceImages,
    status: VALID_QUEUE_STATUSES.includes(status) ? status : "pending",
    submissionCount,
    source: {
      mode: VALID_SOURCE_MODES.includes(srcMode) ? srcMode : "multishot",
      sceneId: asString(src.sceneId),
      label: asString(src.label),
      ...(src.sceneName !== undefined
        ? { sceneName: asString(src.sceneName) }
        : {}),
      ...(src.partLabel !== undefined
        ? { partLabel: asString(src.partLabel) }
        : {}),
    },
    ...(r.scriptExcerpt !== undefined
      ? { scriptExcerpt: asString(r.scriptExcerpt) }
      : {}),
    addedAt: asString(r.addedAt),
    updatedAt: asString(r.updatedAt),
    ...(r.archivedAt ? { archivedAt: asString(r.archivedAt) } : {}),
    liked: r.liked === true,
    ...(r.comment !== undefined ? { comment: asString(r.comment) } : {}),
    ...(r.resultVideo !== undefined
      ? { resultVideo: asString(r.resultVideo) }
      : {}),
    ...(r.runwayName !== undefined ? { runwayName: asString(r.runwayName) } : {}),
    ...(r.runwayUrl !== undefined ? { runwayUrl: asString(r.runwayUrl) } : {}),
    ...(r.repeatCount !== undefined
      ? (() => {
          const n = Number(r.repeatCount)
          return Number.isFinite(n) && n >= 1
            ? { repeatCount: Math.floor(n) }
            : {}
        })()
      : {}),
    ...(r.customInstructions !== undefined
      ? { customInstructions: asString(r.customInstructions) }
      : {}),
  }
}

/**
 * Coerce raw `queue.lani.json` into a well-formed `SubmissionQueue`.
 *
 * The external agent edits this file directly, so a read can hit a
 * near-miss shape — a missing `submissionCount`, an unknown `status`,
 * an absent `schemaVersion`. This is the read-side safety net; it fills
 * the gaps so the Queue surface always renders. Id fallback is
 * deterministic (position-based) so repeated polls don't thrash the
 * selected row. It does not rescue invalid JSON — a syntax error still
 * fails the parse upstream.
 */
export function normalizeQueue(raw: unknown): SubmissionQueue {
  const doc = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >
  const items = Array.isArray(doc.items) ? doc.items : []
  return {
    schemaVersion: 1,
    fieldDescriptions: { ...QUEUE_FIELD_DESCRIPTIONS },
    items: items.map((item, index) => normalizeItem(item, index)),
    updatedAt: asString(doc.updatedAt),
  }
}
