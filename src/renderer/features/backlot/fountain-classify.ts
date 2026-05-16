/**
 * Per-line Fountain classifier.
 *
 * `parseFountain` (fountain-parser.ts) groups source into typeset blocks
 * but drops line identity. The styled-source editor needs the opposite:
 * one kind per physical line so CodeMirror can decorate each `.cm-line`
 * in place. The heuristics here mirror the parser's so the editor's
 * styling agrees with the typeset preview.
 *
 * The editing buffer stays raw Fountain — classification only drives
 * presentation, never rewrites the text.
 */

export type FountainLineKind =
  | "blank"
  | "title"
  | "scene"
  | "action"
  | "character"
  | "paren"
  | "dialogue"
  | "transition"
  | "centered"
  | "section"
  | "pagebreak"
  | "synopsis"
  | "note"

const SCENE_HEADING_PREFIX =
  /^(?:INT|EXT|EST|INT\.\/EXT|I\/E|INT\/EXT)[\s.\-]/i

/** Entirely uppercase — at least one A–Z, no a–z. */
function isAllCaps(line: string): boolean {
  if (!line) return false
  if (!/[A-Z]/.test(line)) return false
  if (/[a-z]/.test(line)) return false
  return true
}

/**
 * Classify every physical line of a Fountain document. The returned
 * array is index-aligned with `source.split("\n")`.
 */
export function classifyFountainLines(source: string): FountainLineKind[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const kinds: FountainLineKind[] = new Array(lines.length).fill("action")

  // ── Pass 1 — boneyard / whole-line notes ────────────────────────
  // Mark commented-out content so it reads as muted. Treated as a
  // structural blank in pass 2 so it doesn't break block detection.
  const structuralBlank: boolean[] = new Array(lines.length).fill(false)
  let inBoneyard = false
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    if (inBoneyard) {
      kinds[idx] = "note"
      structuralBlank[idx] = true
      if (line.includes("*/")) inBoneyard = false
      continue
    }
    const trimmed = line.trim()
    if (trimmed.startsWith("/*")) {
      kinds[idx] = "note"
      structuralBlank[idx] = true
      if (!trimmed.includes("*/")) inBoneyard = true
      continue
    }
    // Whole-line writer's note: [[ … ]] alone on the line.
    if (/^\[\[.*\]\]$/.test(trimmed)) {
      kinds[idx] = "note"
      structuralBlank[idx] = true
    }
  }

  const isBlank = (idx: number) =>
    idx < 0 ||
    idx >= lines.length ||
    lines[idx].trim() === "" ||
    structuralBlank[idx]

  // ── Pass 2 — title page ─────────────────────────────────────────
  let cursor = 0
  while (cursor < lines.length && isBlank(cursor)) {
    if (lines[cursor].trim() === "") kinds[cursor] = "blank"
    cursor++
  }
  if (
    cursor < lines.length &&
    /^[A-Za-z][A-Za-z0-9 _-]*\s*:/.test(lines[cursor])
  ) {
    const titleStart = cursor
    let valid = true
    let scan = cursor
    while (scan < lines.length && lines[scan].trim() !== "") {
      const line = lines[scan]
      const isKey = /^([A-Za-z][A-Za-z0-9 _-]*)\s*:\s*(.*)$/.test(line)
      const isContinuation = /^\s+\S/.test(line)
      if (!isKey && !isContinuation) {
        valid = false
        break
      }
      scan++
    }
    if (valid) {
      for (let idx = titleStart; idx < scan; idx++) kinds[idx] = "title"
      cursor = scan
    }
  }

  // ── Pass 3 — body ───────────────────────────────────────────────
  let i = cursor
  while (i < lines.length) {
    if (kinds[i] === "note") {
      i++
      continue
    }
    const raw = lines[i]
    const trimmed = raw.trim()

    if (trimmed === "") {
      kinds[i] = "blank"
      i++
      continue
    }
    if (/^={3,}\s*$/.test(trimmed)) {
      kinds[i] = "pagebreak"
      i++
      continue
    }
    if (/^=\s+\S/.test(trimmed)) {
      kinds[i] = "synopsis"
      i++
      continue
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      kinds[i] = "section"
      i++
      continue
    }
    if (/^>\s*.*<\s*$/.test(trimmed)) {
      kinds[i] = "centered"
      i++
      continue
    }
    if (/^>\s*\S/.test(trimmed) && !trimmed.endsWith("<")) {
      kinds[i] = "transition"
      i++
      continue
    }
    if (/^\.[^.]/.test(trimmed)) {
      kinds[i] = "scene"
      i++
      continue
    }
    if (SCENE_HEADING_PREFIX.test(trimmed)) {
      kinds[i] = "scene"
      i++
      continue
    }
    if (
      isAllCaps(trimmed) &&
      /TO:$/.test(trimmed) &&
      isBlank(i - 1) &&
      isBlank(i + 1)
    ) {
      kinds[i] = "transition"
      i++
      continue
    }
    // Character — all-caps, blank above, content below. Consume the
    // dialogue / parentheticals beneath until the next blank.
    if (isAllCaps(trimmed) && isBlank(i - 1) && !isBlank(i + 1)) {
      kinds[i] = "character"
      i++
      while (i < lines.length && !isBlank(i)) {
        if (kinds[i] === "note") {
          i++
          continue
        }
        const dlg = lines[i].trim()
        kinds[i] = /^\(.*\)$/.test(dlg) ? "paren" : "dialogue"
        i++
      }
      continue
    }
    // Default — action.
    kinds[i] = "action"
    i++
  }

  return kinds
}
