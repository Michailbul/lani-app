/**
 * Per-scene shotlist model.
 *
 * One scene = one shotlist file at `<scene folder>/shotlist.backlot.json`,
 * sitting next to that scene's `scene.fountain`. A shotlist is an ordered
 * list of shots; each shot carries the generation prompt for that shot.
 *
 * The connection to the screenplay is the shot number. It appears here and
 * is also written into the `.fountain` as a plain-text marker, so a reader
 * of either artifact can cross-reference. Backlot treats this as a
 * convention — not a tracked link. No hashing, no drift detection.
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
  /** Shot number — the connection to the screenplay, mirrored in the .fountain. */
  number: string
  /** Shot size: WS / MS / CU / ECU / ... (free text). */
  plan: string
  /** Lens + camera movement. */
  camera: string
  /** What happens in the shot. */
  action: string
  /** The screenplay beat this shot covers — plain text, for side-by-side context. */
  scriptRef: string
  /** The generation prompt. Content is generic — language/model is the author's choice. */
  text: string
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
