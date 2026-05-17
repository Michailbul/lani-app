"use client"

/**
 * ShotlistScreenplay — the scene screenplay rendered as one continuous
 * Fountain leaf, cut into Parts by dividers.
 *
 * This is the same styled-source surface as the Screenwriting editor
 * (Courier "paper" page, scene headings bold, dialogue indented) — not a
 * stack of boxes. The screenplay is the join of every Part's `scriptRef`
 * slice; a divider is a block widget sitting on the seam between two
 * Parts. The whole document is editable.
 *
 * Placing the cursor in a region binds the Prompt column to that Part.
 * "Split here" drops a divider at the cursor's line; selecting text floats
 * an "Isolate" popup that carves the selection into its own Part; a
 * divider's hover "merge" control removes it. Structural changes flow
 * through the parent's Parts model and re-seed the editor; plain text
 * edits stream slices back without disturbing the cursor.
 */

import { memo, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  EditorState,
  Facet,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state"
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
  keymap,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { Scissors } from "lucide-react"
import { fountainDecorations } from "./fountain-decorations"
import { cn } from "../../lib/utils"
import type { ShotPrompt } from "../../../shared/shotlist-types"

/** The selection-isolate shortcut, rendered for the platform. */
const ISOLATE_HOTKEY =
  typeof navigator !== "undefined" &&
  navigator.platform.toLowerCase().includes("mac")
    ? "⌘⇧↵"
    : "Ctrl⇧↵"

// ── Slice ⇄ document helpers ───────────────────────────────────────────────

/** Cut a document string at the divider offsets into per-Part slices. */
function sliceDoc(doc: string, dividers: number[]): string[] {
  const out: string[] = []
  let prev = 0
  for (const d of dividers) {
    out.push(doc.slice(prev, d))
    prev = d
  }
  out.push(doc.slice(prev))
  return out
}

/** The divider offsets implied by a Parts list — cumulative slice lengths. */
function dividerOffsets(parts: ShotPrompt[]): number[] {
  const out: number[] = []
  let acc = 0
  for (let i = 0; i < parts.length - 1; i++) {
    acc += (parts[i]!.scriptRef ?? "").length
    out.push(acc)
  }
  return out
}

/** Which region a document offset falls in (0-based). */
function regionAt(dividers: number[], pos: number): number {
  let n = 0
  for (const d of dividers) if (d <= pos) n++
  return n
}

function sameNumbers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// ── Divider state — offsets that ride along through edits ──────────────────

const setDividers = StateEffect.define<number[]>()

const dividerField = StateField.define<number[]>({
  create: () => [],
  update(value, tr) {
    let next = value
    for (const e of tr.effects) {
      if (e.is(setDividers)) next = [...e.value].sort((a, b) => a - b)
    }
    if (tr.docChanged && next.length > 0) {
      next = next.map((pos) => tr.changes.mapPos(pos, -1))
    }
    return next
  },
})

// ── Callbacks the divider widget needs, carried in through a facet ─────────

interface ScreenplayCallbacks {
  onMerge: (dividerIndex: number) => void
}

const callbacksFacet = Facet.define<
  ScreenplayCallbacks,
  ScreenplayCallbacks
>({
  combine: (values) => values[0] ?? { onMerge: () => {} },
})

// ── The divider — a block widget on the seam between two Parts ─────────────

class DividerWidget extends WidgetType {
  constructor(
    readonly index: number,
    readonly callbacks: ScreenplayCallbacks,
  ) {
    super()
  }

  eq(other: DividerWidget): boolean {
    return other.index === this.index
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div")
    wrap.className = "cm-shotlist-divider"

    const ruleL = document.createElement("span")
    ruleL.className = "cm-shotlist-divider-rule"

    // Chip + merge share a relatively-positioned anchor so the merge
    // control can float out of flow — it never widens the seam or
    // punches a gap in the rule lines when hidden.
    const center = document.createElement("span")
    center.className = "cm-shotlist-divider-center"

    const chip = document.createElement("span")
    chip.className = "cm-shotlist-divider-chip"
    chip.textContent = String(this.index + 2).padStart(2, "0")

    const merge = document.createElement("button")
    merge.type = "button"
    merge.className = "cm-shotlist-divider-merge"
    merge.textContent = "✕ merge"
    merge.title = "Remove this divider — merge into the part above"
    merge.addEventListener("mousedown", (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    merge.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.callbacks.onMerge(this.index)
    })

    center.append(chip, merge)

    const ruleR = document.createElement("span")
    ruleR.className = "cm-shotlist-divider-rule"

    wrap.append(ruleL, center, ruleR)
    return wrap
  }

  ignoreEvent(): boolean {
    return true
  }
}

// ── Decorations — divider widgets + the active-region highlight ────────────

function buildDecorations(state: EditorState): DecorationSet {
  const dividers = state.field(dividerField)
  const callbacks = state.facet(callbacksFacet)
  const docLength = state.doc.length
  const head = state.selection.main.head
  const ranges: Range<Decoration>[] = []

  // Highlight the active Part like selected text — a single mark over the
  // region's whole character range. It spans cleanly across lines with no
  // gaps, even when a Part boundary falls mid-line.
  if (dividers.length > 0) {
    const active = regionAt(dividers, head)
    const start = active > 0 ? dividers[active - 1]! : 0
    const end = active < dividers.length ? dividers[active]! : docLength
    if (end > start) {
      ranges.push(
        Decoration.mark({ class: "cm-shotlist-region" }).range(start, end),
      )
    }
  }

  // The dividers themselves.
  dividers.forEach((pos, i) => {
    ranges.push(
      Decoration.widget({
        widget: new DividerWidget(i, callbacks),
        block: true,
        side: -1,
      }).range(pos),
    )
  })

  return Decoration.set(ranges, true)
}

const decorationField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(setDividers))
    ) {
      return buildDecorations(tr.state)
    }
    return value.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

// ── The "paper page" theme — matches the Screenwriting editor ──────────────

const screenplayTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    color: "hsl(var(--foreground))",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily:
      '"Courier Prime", "Courier New", Courier, ui-monospace, monospace',
    lineHeight: "1.55",
    justifyContent: "center",
    paddingTop: "12px",
    paddingBottom: "96px",
  },
  ".cm-content": {
    width: "100%",
    maxWidth: "680px",
    padding: "56px 64px",
    caretColor: "hsl(var(--primary))",
    backgroundColor: "hsl(var(--background))",
    border: "1px solid hsl(var(--border) / 0.5)",
    borderRadius: "2px",
  },
  ".cm-line": { padding: "0" },
  ".cm-selectionBackground": {
    backgroundColor: "hsl(var(--primary) / 0.22)",
  },
  ".cm-cursor": { borderLeftColor: "hsl(var(--primary))" },
})

// ──────────────────────────────────────────────────────────────────────────

/**
 * The split the cursor currently enables: a single divider at the caret
 * line, or carving the selected range out as its own Part.
 */
type SplitAction =
  | { kind: "split"; shotId: string; offset: number }
  | { kind: "carve"; shotId: string; start: number; end: number }

interface ShotlistScreenplayProps {
  /** The scene's Parts, in screenplay order. */
  parts: ShotPrompt[]
  /** Index of the Part whose prompt is shown in the Prompt column. */
  activeIndex: number
  /** A region was selected — bind the Prompt column to this Part. */
  onSelect: (shotId: string) => void
  /** The screenplay text changed — slices align 1:1 with `parts`. */
  onEditSlices: (slices: string[]) => void
  /** Place a divider: split `shotId`'s slice at `offsetInPart`. */
  onSplit: (shotId: string, offsetInPart: number) => void
  /** Carve `shotId`'s slice between `start` and `end` into its own Part. */
  onCarve: (shotId: string, start: number, end: number) => void
  /** Remove the divider after Part `dividerIndex` (0-based). */
  onMerge: (dividerIndex: number) => void
}

export const ShotlistScreenplay = memo(function ShotlistScreenplay({
  parts,
  activeIndex,
  onSelect,
  onEditSlices,
  onSplit,
  onCarve,
  onMerge,
}: ShotlistScreenplayProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [splitMode, setSplitMode] = useState<"split" | "carve" | null>(null)
  // Viewport coords of the selection end — anchors the Isolate popup.
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(
    null,
  )

  // Latest props reachable from the long-lived editor without rebuilding it.
  const partsRef = useRef(parts)
  partsRef.current = parts
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onEditSlicesRef = useRef(onEditSlices)
  onEditSlicesRef.current = onEditSlices
  const onSplitRef = useRef(onSplit)
  onSplitRef.current = onSplit
  const onCarveRef = useRef(onCarve)
  onCarveRef.current = onCarve
  const onMergeRef = useRef(onMerge)
  onMergeRef.current = onMerge

  const lastRegionRef = useRef(-1)
  const splitActionRef = useRef<SplitAction | null>(null)
  const prevPartCountRef = useRef(parts.length)

  const performSplitAction = () => {
    const action = splitActionRef.current
    if (!action) return
    if (action.kind === "split") {
      onSplitRef.current(action.shotId, action.offset)
    } else {
      onCarveRef.current(action.shotId, action.start, action.end)
    }
  }
  const performSplitActionRef = useRef(performSplitAction)
  performSplitActionRef.current = performSplitAction

  // Mount once. The editor is a long-lived imperative object.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const initialParts = partsRef.current
    const doc = initialParts.map((p) => p.scriptRef ?? "").join("")
    const offsets = dividerOffsets(initialParts)
    const initialCaret =
      activeIndex > 0 ? (offsets[activeIndex - 1] ?? 0) : 0

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        selection: { anchor: Math.min(initialCaret, doc.length) },
        extensions: [
          history(),
          keymap.of([
            {
              key: "Mod-Shift-Enter",
              run: () => {
                performSplitActionRef.current()
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          dividerField.init(() => offsets),
          decorationField,
          fountainDecorations,
          screenplayTheme,
          callbacksFacet.of({
            onMerge: (i) => onMergeRef.current(i),
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              const text = u.state.doc.toString()
              const divs = u.state.field(dividerField)
              onEditSlicesRef.current(sliceDoc(text, divs))
            }
            if (u.selectionSet || u.docChanged) {
              const divs = u.state.field(dividerField)
              const doc = u.state.doc
              const sel = u.state.selection.main
              const region = regionAt(divs, sel.head)

              if (region !== lastRegionRef.current) {
                lastRegionRef.current = region
                const selPart = partsRef.current[region]
                if (selPart) onSelectRef.current(selPart.id)
              }

              const regionStart = region > 0 ? (divs[region - 1] ?? 0) : 0
              const regionEnd =
                region < divs.length
                  ? (divs[region] ?? doc.length)
                  : doc.length
              const part = partsRef.current[region]

              let action: SplitAction | null = null
              if (part && sel.empty) {
                // Caret split — drop one divider, snapped to the line.
                const lineStart = doc.lineAt(sel.head).from
                if (
                  lineStart > regionStart &&
                  lineStart < regionEnd &&
                  !divs.includes(lineStart)
                ) {
                  action = {
                    kind: "split",
                    shotId: part.id,
                    offset: lineStart - regionStart,
                  }
                }
              } else if (part) {
                // Selection carve — the selected lines become their own
                // Part. Snap both ends to whole lines, clamp to the region.
                const from = Math.max(sel.from, regionStart)
                const to = Math.min(sel.to, regionEnd)
                if (to > from) {
                  const start = Math.max(doc.lineAt(from).from, regionStart)
                  const toLine = doc.lineAt(to)
                  const lineEnd =
                    to === toLine.from
                      ? to
                      : toLine.number < doc.lines
                        ? doc.line(toLine.number + 1).from
                        : doc.length
                  const end = Math.min(lineEnd, regionEnd)
                  if (end > start && (start > regionStart || end < regionEnd)) {
                    action = {
                      kind: "carve",
                      shotId: part.id,
                      start: start - regionStart,
                      end: end - regionStart,
                    }
                  }
                }
              }
              splitActionRef.current = action
              setSplitMode(action?.kind ?? null)

              // Anchor the Isolate popup to the end of a carve selection.
              if (action?.kind === "carve") {
                const c = u.view.coordsAtPos(sel.to)
                setPopupPos(c ? { top: c.top, left: c.left } : null)
              } else {
                setPopupPos(null)
              }
            }
          }),
          // Keep the Isolate popup pinned to the selection as it scrolls.
          EditorView.domEventHandlers({
            scroll: (_event, view) => {
              if (splitActionRef.current?.kind !== "carve") return false
              const sel = view.state.selection.main
              const c = sel.empty ? null : view.coordsAtPos(sel.to)
              setPopupPos(c ? { top: c.top, left: c.left } : null)
              return false
            },
          }),
        ],
      }),
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Mount-only — initial state is captured intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-seed the editor when the Parts model changes underneath it: an
  // external (agent / poll) edit, or a structural split/merge. Plain
  // local typing is skipped — the editor's own buffer is already right.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const joined = parts.map((p) => p.scriptRef ?? "").join("")
    const offsets = dividerOffsets(parts)
    const currentDoc = view.state.doc.toString()
    const currentDividers = view.state.field(dividerField)
    const structural = parts.length !== prevPartCountRef.current
    prevPartCountRef.current = parts.length

    const docMatches = currentDoc === joined
    const dividersMatch = sameNumbers(currentDividers, offsets)

    if (!structural && docMatches && dividersMatch) return
    if (!structural && docMatches && view.hasFocus) return

    view.dispatch({
      changes: docMatches
        ? undefined
        : { from: 0, to: currentDoc.length, insert: joined },
      effects: setDividers.of(offsets),
    })

    if (structural) {
      const caret =
        activeIndex > 0 ? (offsets[activeIndex - 1] ?? 0) : 0
      view.dispatch({
        selection: { anchor: Math.min(caret, joined.length) },
      })
      lastRegionRef.current = activeIndex
      view.focus()
    }
  }, [parts, activeIndex])

  return (
    <div className="flex min-h-0 flex-1 flex-col pl-5">
      <div className="flex h-7 shrink-0 items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
          Screenplay
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/55">
          {parts.length} {parts.length === 1 ? "region" : "regions"}
        </span>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={performSplitActionRef.current}
          disabled={splitMode !== "split"}
          title={
            splitMode === "split"
              ? `Split the part at the cursor line (${ISOLATE_HOTKEY})`
              : splitMode === "carve"
                ? "Select text — the Isolate action appears by the selection"
                : "Place the cursor on a line to split the part"
          }
          className={cn(
            "press ml-auto inline-flex h-6 items-center gap-1 rounded-md px-2",
            "font-mono text-[9px] uppercase tracking-[0.12em] transition-colors",
            splitMode === "split"
              ? "bg-primary/15 text-primary hover:bg-primary/25"
              : "cursor-not-allowed text-muted-foreground/30",
          )}
        >
          <Scissors className="h-3 w-3" />
          Split here
        </button>
      </div>
      <div
        ref={hostRef}
        className="cm-fountain-host mt-2 min-h-0 flex-1 overflow-auto"
      />

      {/* Isolate popup — floats above a screenplay text selection. */}
      {splitMode === "carve" &&
        popupPos &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: popupPos.top,
              left: popupPos.left,
              zIndex: 60,
              transform: "translate(-50%, calc(-100% - 8px))",
            }}
          >
            <div className="shotlist-selection-popup overflow-hidden rounded-lg border border-border/70 bg-popover shadow-lg shadow-black/10">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => performSplitActionRef.current()}
                title="Carve the selected text into its own part"
                className="press flex h-8 items-center gap-2 px-2.5 text-[12px] font-medium text-popover-foreground transition-colors hover:bg-foreground/[0.06]"
              >
                <Scissors className="h-3.5 w-3.5 text-primary" />
                Isolate
                <kbd className="ml-0.5 rounded bg-foreground/[0.07] px-1.5 py-[3px] font-mono text-[10px] font-semibold tracking-[0.04em] text-muted-foreground">
                  {ISOLATE_HOTKEY}
                </kbd>
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
})
