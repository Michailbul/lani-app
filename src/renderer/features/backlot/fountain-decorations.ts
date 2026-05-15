/**
 * CodeMirror line decorations for the Fountain styled-source editor.
 *
 * Each physical line is classified (see fountain-classify.ts) and gets
 * a `cm-fountain-<kind>` class on its `.cm-line` element. The actual
 * typeset styling — indents, weights, alignment — lives in globals.css
 * so it sits next to the `.rich-prose` rules and stays themeable.
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

function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc
  const kinds = classifyFountainLines(doc.toString())
  const builder = new RangeSetBuilder<Decoration>()
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const kind = kinds[n - 1] ?? "action"
    builder.add(
      line.from,
      line.from,
      Decoration.line({ class: `cm-fountain-${kind}` }),
    )
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
