"use client"

/**
 * FountainSourceEditor — Backlot's screenplay editing surface.
 *
 * A CodeMirror 6 editor whose buffer is raw Fountain, decorated so it
 * reads like a typeset screenplay page: Courier on a centred "paper"
 * leaf, scene headings bold, Backlot `SHOT A:` headings marked,
 * dialogue and character names indented, transitions right-aligned.
 * The text never leaves Fountain — the decorations are pure presentation.
 *
 * The point of styled-source over a render/edit swap: there is no
 * swap. The writer always sees the same screenplay-shaped surface and
 * always types directly into it. Clicking places a cursor; it does
 * not change what the page looks like.
 *
 * Mirrors RichMarkdownEditor's prop shape so EntityEditor can drive
 * both the same way (value in, onChange/onBlur out, optional
 * click-coordinate cursor placement).
 */

import { memo, useEffect, useRef } from "react"
import { EditorView, keymap } from "@codemirror/view"
import { EditorState } from "@codemirror/state"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { fountainDecorations } from "./fountain-decorations"
import { cn } from "../../lib/utils"

interface FountainSourceEditorProps {
  /** Raw Fountain source. */
  value: string
  onChange: (next: string) => void
  onBlur?: () => void
  /** Focus the editor on mount. */
  autoFocus?: boolean
  /**
   * Viewport-relative click coords. When provided, the cursor lands at
   * the position closest to the click after mount — used by
   * EntityEditor's click-to-edit flow so focusing the editor doesn't
   * jump the cursor to the end of the document.
   */
  focusPoint?: { x: number; y: number } | null
  className?: string
}

// Styled source keeps Fountain's screenplay typography, but it should
// sit on the same open canvas as markdown entities. No paper-card
// background, border, or shadow here.
const fountainTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    color: "hsl(var(--foreground))",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily:
      '"Courier Prime", "Courier New", Courier, ui-monospace, monospace',
    lineHeight: "1.55",
  },
  ".cm-content": {
    width: "100%",
    maxWidth: "720px",
    margin: "0 auto",
    padding: "8px 40px 96px",
    boxSizing: "border-box",
    caretColor: "hsl(var(--primary))",
    backgroundColor: "transparent",
  },
  ".cm-line": { padding: "0" },
  ".cm-selectionBackground": {
    backgroundColor: "hsl(var(--primary) / 0.22)",
  },
  ".cm-cursor": { borderLeftColor: "hsl(var(--primary))" },
})

export const FountainSourceEditor = memo(function FountainSourceEditor({
  value,
  onChange,
  onBlur,
  autoFocus,
  focusPoint,
  className,
}: FountainSourceEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  // Keep the latest callbacks reachable from the editor's listeners
  // without re-creating the EditorView on every parent render.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onBlurRef = useRef(onBlur)
  onBlurRef.current = onBlur

  // Mount once. The editor is a long-lived imperative object; React
  // owns only the host node.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          fountainDecorations,
          fountainTheme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              onChangeRef.current(u.state.doc.toString())
            }
          }),
          EditorView.domEventHandlers({
            blur: () => {
              onBlurRef.current?.()
              return false
            },
          }),
        ],
      }),
    })
    viewRef.current = view

    requestAnimationFrame(() => {
      if (focusPoint) {
        const pos = view.posAtCoords({
          x: focusPoint.x,
          y: focusPoint.y,
        })
        if (pos != null) {
          view.dispatch({
            selection: { anchor: pos },
            scrollIntoView: false,
          })
        }
      }
      if (autoFocus || focusPoint) view.focus()
    })

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Mount-only — initial value/focus are captured intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pull external content (agent edits, poll refresh) into the editor
  // when the user is idle. Skipped while focused so a mid-keystroke
  // buffer round-trip can't yank the doc out from under the cursor.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.hasFocus) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    })
  }, [value])

  return (
    <div
      ref={hostRef}
      className={cn("cm-fountain-host w-full h-full overflow-auto", className)}
    />
  )
})
