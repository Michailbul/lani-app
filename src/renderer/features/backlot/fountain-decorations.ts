/**
 * CodeMirror line decorations for the Fountain styled-source editor.
 *
 * Each physical line is classified (see fountain-classify.ts) and gets
 * a `cm-fountain-<kind>` class on its `.cm-line` element. The actual
 * typeset styling — indents, weights, alignment — lives in globals.css
 * so it sits next to the `.rich-prose` rules and stays themeable.
 *
 * Character-cue lines also carry a mark decoration on their bracketed
 * tag — `MOTHER [low, clipped, eyes on the Bentley]` — wrapping the
 * `[...]` portion in `.cm-fountain-emotion`. The CSS rule promotes that
 * span to a block so the tag stacks below the name without changing
 * the underlying source line.
 *
 * Re-decoration runs on every document change. Screenplays are a few
 * thousand lines at most, so a full re-classify per edit is cheap and
 * keeps the logic a single pure pass instead of an incremental mapper.
 */

import { RangeSetBuilder } from "@codemirror/state"
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view"
import { classifyFountainLines } from "./fountain-classify"

/** Match the trailing `[…]` portion of a character cue line. The cue
 *  name lives before the bracket; the bracket span — including its
 *  delimiters — is what we visually demote to a block below the name. */
const EMOTION_TAG_RE = /\[[^\]]*\]\s*$/

function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc
  const source = doc.toString()
  const kinds = classifyFountainLines(source)

  // Two passes, single builder: line decorations must be issued at
  // `line.from` in document order, and mark decorations issued at the
  // exact offsets of the bracketed range. RangeSetBuilder requires
  // strictly non-decreasing `from` offsets, so we interleave the cue
  // line's line-deco with the emotion mark in one pass.
  const builder = new RangeSetBuilder<Decoration>()
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const kind = kinds[n - 1] ?? "action"
    builder.add(
      line.from,
      line.from,
      Decoration.line({ class: `cm-fountain-${kind}` }),
    )
    if (kind === "character") {
      const text = line.text
      const match = EMOTION_TAG_RE.exec(text)
      if (match && match.index > 0) {
        const start = line.from + match.index
        const end = line.from + text.length
        builder.add(
          start,
          end,
          Decoration.mark({ class: "cm-fountain-emotion" }),
        )
      }
    }
  }
  return builder.finish()
}

export const fountainDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
)
