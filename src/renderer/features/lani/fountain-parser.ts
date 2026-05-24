/**
 * Minimal Fountain (https://fountain.io) block tokenizer.
 *
 * Covers the blocks a working screenwriter needs to *see* typeset:
 *   • Title page    — Key: Value pairs at file top before the first blank line
 *   • Scene heading — INT./EXT./EST./I/E lines, plus `.FORCED` heading
 *   • Shot heading  — Lani extension: `SHOT A:` / `SHOT B: CU - push`
 *   • Action        — default paragraph
 *   • Character     — ALL-CAPS cue, optionally with `[visible emotion]`
 *   • Parenthetical — (text) directly under a character
 *   • Dialogue      — line(s) following character/parenthetical until blank
 *   • Transition    — ALL-CAPS line ending in `TO:`, or starting with `>`
 *   • Centered      — `> text <`
 *   • Section       — `# heading`, `## heading`, etc. (1-6)
 *   • Page break    — `===`
 *
 * Production-time annotations are stripped before tokenizing so they
 * don't pollute the typeset page:
 *   • Boneyard      — /* commented-out content *\/  (multi-line)
 *   • Notes         — [[writer's note]]              (multi-line)
 *   • Synopses      — `= a one-line beat summary`   (above-the-line)
 *
 * Inline emphasis (`*italic*`, `**bold**`, `***both***`, `_underline_`)
 * is exposed via `parseInlineEmphasis` so the renderer can draw the
 * marks without showing the markers themselves. Backslash escapes a
 * single marker.
 *
 * Still TODO when needed: lyrics (`~`), per-line forced action.
 *
 * The output is a flat array of blocks; the renderer maps each kind to
 * a screenplay-typeset element. Title-page entries are grouped so the
 * renderer can lay them out in the centred title block.
 */

export type FountainBlock =
  | { kind: "title-page"; entries: Array<{ key: string; value: string }> }
  | { kind: "scene-heading"; text: string }
  | { kind: "shot-heading"; text: string }
  | { kind: "action"; text: string }
  | { kind: "character"; text: string; dual?: boolean }
  | { kind: "parenthetical"; text: string }
  | { kind: "dialogue"; text: string }
  | { kind: "transition"; text: string }
  | { kind: "centered"; text: string }
  | { kind: "section"; level: number; text: string }
  | { kind: "page-break" }

/**
 * One run of inline-emphasised text inside a block. The renderer maps
 * each kind to the matching DOM element (em / strong / underline /
 * bold-italic combo). Plain text is `kind: "text"`.
 */
export type InlineSegment =
  | { kind: "text"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "bold-italic"; text: string }
  | { kind: "underline"; text: string }

/**
 * Parse Fountain inline emphasis into rich segments.
 *   *italic*       → italic
 *   **bold**       → bold
 *   ***both***     → bold-italic
 *   _underline_    → underline
 *
 * `\*` (backslash) escapes a single marker so the writer can type a
 * literal asterisk. Unbalanced markers (`*foo` with no closer) emit
 * the input as plain text — the writer's draft never silently
 * swallows characters.
 *
 * Flat tokenizer, no nesting. Covers ~all real writer usage; if true
 * nesting (`**bold _both_ bold**`) becomes a need we can swap in a
 * recursive descent without changing the type.
 */
export function parseInlineEmphasis(input: string): InlineSegment[] {
  if (!input) return []
  const segments: InlineSegment[] = []
  let buf = ""
  let i = 0

  const flushText = () => {
    if (buf) {
      segments.push({ kind: "text", text: buf })
      buf = ""
    }
  }

  while (i < input.length) {
    // \* / \_ — escape a single marker.
    if (input[i] === "\\" && i + 1 < input.length) {
      buf += input[i + 1]
      i += 2
      continue
    }

    // ***bold-italic*** (must be checked before ** and *)
    if (input.startsWith("***", i)) {
      const end = input.indexOf("***", i + 3)
      if (end > i + 3) {
        flushText()
        segments.push({ kind: "bold-italic", text: input.slice(i + 3, end) })
        i = end + 3
        continue
      }
    }

    // **bold**
    if (input.startsWith("**", i)) {
      const end = input.indexOf("**", i + 2)
      if (end > i + 2) {
        flushText()
        segments.push({ kind: "bold", text: input.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }

    // *italic*
    if (input[i] === "*") {
      const end = input.indexOf("*", i + 1)
      if (end > i + 1) {
        flushText()
        segments.push({ kind: "italic", text: input.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    // _underline_
    if (input[i] === "_") {
      const end = input.indexOf("_", i + 1)
      if (end > i + 1) {
        flushText()
        segments.push({ kind: "underline", text: input.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    buf += input[i]
    i++
  }

  flushText()
  return segments
}

/**
 * Strip Fountain production-time annotations (boneyard `/* … *\/` and
 * notes `[[ … ]]`). Both can span multiple lines. Removed regions
 * collapse to nothing; the parser then naturally treats now-empty
 * lines as blanks.
 */
function stripAnnotations(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\[\[[\s\S]*?\]\]/g, "")
}

const SCENE_HEADING_PREFIX =
  /^(?:INT|EXT|EST|INT\.\/EXT|I\/E|INT\/EXT)[\s.\-]/i
const SHOT_HEADING_PREFIX = /^SHOT\s+[A-Z0-9][A-Z0-9-]*(?:\s*[:\-–—]\s*|\b)/

/** Is this line entirely uppercase (used for character + transition heuristics)? */
function isAllCaps(line: string): boolean {
  if (!line) return false
  // Has at least one A–Z and no a–z letters.
  if (!/[A-Z]/.test(line)) return false
  if (/[a-z]/.test(line)) return false
  return true
}

function isShotHeading(line: string): boolean {
  return SHOT_HEADING_PREFIX.test(line.trim())
}

function isCharacterCue(line: string): boolean {
  const cue = line
    .replace(/\s*\^\s*$/, "")
    .replace(/\[[^\]]*\]/g, "")
    .trim()
  return isAllCaps(cue)
}

/**
 * Tokenize raw Fountain source into block descriptors.
 */
export function parseFountain(source: string): FountainBlock[] {
  const blocks: FountainBlock[] = []
  if (!source) return blocks

  // Strip writer-side annotations before tokenizing — they shouldn't
  // appear in the typeset page at all.
  const cleaned = stripAnnotations(source)

  // Normalize line endings; keep blank lines as separators.
  const rawLines = cleaned.replace(/\r\n?/g, "\n").split("\n")

  // ── Title page ──────────────────────────────────────────────────
  // Title-page key/value pairs run from the top until the first blank
  // line, only if the very first non-blank line looks like `Key: …`.
  let cursor = 0
  while (cursor < rawLines.length && rawLines[cursor].trim() === "") cursor++
  const titleStart = cursor
  const titleEntries: Array<{ key: string; value: string }> = []
  let consumedTitle = false
  if (
    cursor < rawLines.length &&
    /^[A-Za-z][A-Za-z0-9 _-]*\s*:/.test(rawLines[cursor])
  ) {
    let currentKey: string | null = null
    let currentValue: string[] = []
    while (cursor < rawLines.length) {
      const line = rawLines[cursor]
      if (line.trim() === "") {
        // Title page terminates at the first blank line.
        if (currentKey !== null) {
          titleEntries.push({
            key: currentKey,
            value: currentValue.join("\n").trim(),
          })
        }
        cursor++ // consume the blank
        consumedTitle = true
        break
      }
      const keyMatch = /^([A-Za-z][A-Za-z0-9 _-]*)\s*:\s*(.*)$/.exec(line)
      if (keyMatch) {
        if (currentKey !== null) {
          titleEntries.push({
            key: currentKey,
            value: currentValue.join("\n").trim(),
          })
        }
        currentKey = keyMatch[1].trim()
        currentValue = keyMatch[2] ? [keyMatch[2]] : []
      } else if (/^\s+\S/.test(line)) {
        // Continuation of previous value (indented continuation).
        currentValue.push(line.replace(/^\s+/, ""))
      } else {
        // Doesn't look like title-page anymore — bail.
        currentKey = null
        currentValue = []
        cursor = titleStart // rewind
        consumedTitle = false
        break
      }
      cursor++
    }
    if (consumedTitle && titleEntries.length > 0) {
      blocks.push({ kind: "title-page", entries: titleEntries })
    } else {
      cursor = titleStart
    }
  }

  // ── Body ────────────────────────────────────────────────────────
  // We scan line-by-line and use the previous block's kind plus the
  // surrounding blank lines to disambiguate character vs action.
  let i = cursor
  const lines = rawLines

  const prevIsBlank = (idx: number) =>
    idx === 0 || (lines[idx - 1] ?? "").trim() === ""
  const nextIsBlank = (idx: number) =>
    idx === lines.length - 1 || (lines[idx + 1] ?? "").trim() === ""

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw

    if (line.trim() === "") {
      i++
      continue
    }

    // Page break — 3+ equals signs alone on a line.
    if (/^={3,}\s*$/.test(line)) {
      blocks.push({ kind: "page-break" })
      i++
      continue
    }

    // Synopsis: `= one-line beat summary`. Above-the-line outline
    // content; not part of the typeset page. Skip without emitting a
    // block so it doesn't fold into surrounding action.
    if (/^=\s+\S/.test(line)) {
      i++
      continue
    }

    // Section heading — `#`, `##`, …
    const sectionMatch = /^(#{1,6})\s+(.*)$/.exec(line)
    if (sectionMatch) {
      blocks.push({
        kind: "section",
        level: sectionMatch[1].length,
        text: sectionMatch[2].trim(),
      })
      i++
      continue
    }

    // Centered text: `> something <`
    const centeredMatch = /^>\s*(.*?)\s*<\s*$/.exec(line)
    if (centeredMatch) {
      blocks.push({ kind: "centered", text: centeredMatch[1] })
      i++
      continue
    }

    // Forced transition: `> CUT TO:`
    const forcedTransitionMatch = /^>\s*(.+)$/.exec(line)
    if (forcedTransitionMatch && !line.endsWith("<")) {
      blocks.push({
        kind: "transition",
        text: forcedTransitionMatch[1].trim().toUpperCase(),
      })
      i++
      continue
    }

    // Forced scene heading: `.INT. SOMETHING - DAY`
    if (/^\.[^.]/.test(line)) {
      blocks.push({ kind: "scene-heading", text: line.slice(1).trim() })
      i++
      continue
    }

    // Standard scene heading: starts with INT./EXT./EST./…
    if (SCENE_HEADING_PREFIX.test(line.trim())) {
      blocks.push({ kind: "scene-heading", text: line.trim() })
      i++
      continue
    }

    // Lani shot heading: visible director-screenwriter structure
    // inside a Fountain file.
    if (isShotHeading(line)) {
      blocks.push({ kind: "shot-heading", text: line.trim() })
      i++
      continue
    }

    // Transition: ALL-CAPS line ending with `TO:` and bracketed by blanks.
    const trimmed = line.trim()
    if (
      isAllCaps(trimmed) &&
      /TO:$/.test(trimmed) &&
      prevIsBlank(i) &&
      nextIsBlank(i)
    ) {
      blocks.push({ kind: "transition", text: trimmed })
      i++
      continue
    }

    // Character: ALL-CAPS line preceded by blank and followed by
    // non-blank. Strip dual-dialogue caret.
    if (isCharacterCue(trimmed) && prevIsBlank(i) && !nextIsBlank(i)) {
      const dual = trimmed.endsWith("^")
      blocks.push({
        kind: "character",
        text: dual ? trimmed.slice(0, -1).trim() : trimmed,
        dual,
      })
      i++

      // Now consume the dialogue/parentheticals beneath the character
      // until we hit a blank line.
      while (i < lines.length && lines[i].trim() !== "") {
        const dlgRaw = lines[i].trim()
        const parenMatch = /^\((.*)\)$/.exec(dlgRaw)
        if (parenMatch) {
          blocks.push({ kind: "parenthetical", text: parenMatch[1] })
        } else {
          blocks.push({ kind: "dialogue", text: dlgRaw })
        }
        i++
      }
      continue
    }

    // Default — action. Group consecutive non-blank lines into one
    // action paragraph so the renderer can word-wrap naturally.
    const actionLines = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      // Don't fold the next line in if it's something the parser
      // would otherwise treat as a different block type.
      !/^={3,}\s*$/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !SCENE_HEADING_PREFIX.test(lines[i].trim()) &&
      !isShotHeading(lines[i]) &&
      !/^\.[^.]/.test(lines[i]) &&
      !/^>/.test(lines[i])
    ) {
      actionLines.push(lines[i])
      i++
    }
    blocks.push({ kind: "action", text: actionLines.join("\n") })
  }

  return blocks
}
