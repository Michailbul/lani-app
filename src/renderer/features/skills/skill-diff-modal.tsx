"use client"

/**
 * SkillDiffDrawer — right-side slide-in panel that surfaces an
 * agent-proposed change to a SKILL.md.
 *
 * Why a drawer, not a center modal: the user wants to see the change
 * in context with the rest of their workspace (project tree, file
 * preview, chat). A modal yanks them out of the work; a drawer pulls
 * the change into the work. Close on Apply / Dismiss / X / overlay-click
 * / Esc.
 *
 * The diff body is NOT a read-only GitHub-style two-column patch. It is
 * the proposed skill as one editable document: no card, no container
 * fill, no +/− gutter. Changed lines carry a 2px Coral margin tick;
 * removed lines sit inline as faint, struck-through ghosts just above
 * their replacement. The writer edits the document directly — what they
 * see is what Apply writes to disk.
 *
 * Visual register: editorial. Mono kicker, display headline, Coral
 * hairline accents, hairline rules between regions — no boxes.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { diffLines } from "diff"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { motion } from "motion/react"
import { Check, Loader2, X } from "lucide-react"
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  keymap,
} from "@codemirror/view"
import { EditorState, type Range } from "@codemirror/state"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { cn } from "../../lib/utils"

export interface SkillProposalForUi {
  id: string
  skillName: string
  skillPath: string
  source: "user" | "project" | "plugin"
  oldContent: string
  newContent: string
  summary: string
  createdAt: number
}

interface SkillDiffDrawerProps {
  proposal: SkillProposalForUi | null
  /** True while waiting for the resolveProposal mutation to land. */
  pending: "apply" | "dismiss" | null
  /** Apply carries the (possibly edited) document the user sees. */
  onApply: (finalContent: string) => void
  onDismiss: () => void
  /** User closed via X / Esc / overlay — same semantics as dismiss. */
  onClose: () => void
}

function diffStats(oldContent: string, newContent: string) {
  const chunks = diffLines(oldContent, newContent)
  let added = 0
  let removed = 0
  for (const chunk of chunks) {
    if (!chunk.added && !chunk.removed) continue
    const lineCount = chunk.value.replace(/\n$/, "").split("\n").length
    if (chunk.added) added += lineCount
    else removed += lineCount
  }
  return { added, removed }
}

const SOURCE_LABEL: Record<SkillProposalForUi["source"], string> = {
  user: "User",
  project: "Project",
  plugin: "Plugin",
}

export const SkillDiffDrawer = memo(function SkillDiffDrawer({
  proposal,
  pending,
  onApply,
  onDismiss,
  onClose,
}: SkillDiffDrawerProps) {
  const open = !!proposal

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && proposal && !pending) onClose()
      }}
    >
      <DialogPrimitive.Portal>
        {/* Very soft backdrop — keep the workspace visible so the user
            keeps context; just a hint that something is modal. */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-foreground/[0.04] backdrop-blur-[1px]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed right-0 top-0 bottom-0 z-50 flex flex-col",
            "w-[min(720px,calc(100vw-3rem))]",
            "bg-background border-l border-border",
            "shadow-[-24px_0_60px_-30px_rgba(0,0,0,0.25)]",
            "outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            "duration-200 [animation-timing-function:cubic-bezier(0.2,0.8,0.2,1)]",
          )}
        >
          {proposal && (
            <DrawerBody
              key={proposal.id}
              proposal={proposal}
              pending={pending}
              onApply={onApply}
              onDismiss={onDismiss}
              onClose={onClose}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
})

// ──────────────────────────────────────────────────────────────────────
// Body — keyed by proposal.id so each new proposal gets a fresh mount:
// fresh editable draft, fresh entrance animation.
// ──────────────────────────────────────────────────────────────────────

interface DrawerBodyProps extends Omit<SkillDiffDrawerProps, "proposal"> {
  proposal: SkillProposalForUi
}

function DrawerBody({
  proposal,
  pending,
  onApply,
  onDismiss,
  onClose,
}: DrawerBodyProps) {
  // The editable document. Seeded with the agent's proposal; the writer
  // can tweak anything before applying. Apply writes exactly this.
  const [draft, setDraft] = useState(proposal.newContent)

  const stats = useMemo(
    () => diffStats(proposal.oldContent, draft),
    [proposal.oldContent, draft],
  )
  const noChange = draft === proposal.oldContent

  return (
    <>
      {/* ── Header ───────────────────────────────────────────────── */}
      <header className="relative shrink-0 px-7 pt-7 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block w-[14px] h-[1px] bg-primary"
              />
              <span
                className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Skill change proposed
              </span>
              <span className="text-muted-foreground/30">·</span>
              <span
                className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/65"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {SOURCE_LABEL[proposal.source]}
              </span>
            </div>

            <DialogPrimitive.Title asChild>
              <motion.h2
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.04 }}
                className="mt-3 text-[26px] leading-[1.1] tracking-[-0.012em] text-foreground truncate"
                style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                title={proposal.skillName}
              >
                {proposal.skillName}
              </motion.h2>
            </DialogPrimitive.Title>

            {proposal.summary && (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: 0.08 }}
                className="mt-3 text-[14px] leading-[1.55] text-foreground/80 break-words"
                style={{ fontFamily: "var(--font-body)" }}
              >
                {proposal.summary}
              </motion.p>
            )}

            <p
              className="mt-3 text-[10.5px] tracking-tight text-muted-foreground/55 truncate"
              style={{ fontFamily: "var(--font-mono)" }}
              title={proposal.skillPath}
            >
              {proposal.skillPath}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={!!pending}
            aria-label="Close"
            className={cn(
              "press shrink-0 -mt-1 -mr-1 h-8 w-8 rounded-full",
              "flex items-center justify-center",
              "text-muted-foreground/70 hover:text-foreground",
              "hover:bg-foreground/[0.05]",
              "disabled:opacity-40 disabled:pointer-events-none",
              "transition-colors duration-150",
            )}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Hairline + diff stats — single line under the masthead. */}
      <div className="px-7">
        <div className="h-px bg-border/70" />
      </div>
      <div className="shrink-0 px-7 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] uppercase tracking-[0.20em] text-muted-foreground/65"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Editable diff
          </span>
          <span
            className="flex items-center gap-1.5 text-[11.5px] tabular-nums"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            <span className="text-emerald-700 dark:text-emerald-400">
              +{stats.added}
            </span>
            <span className="text-muted-foreground/35">·</span>
            <span className="text-rose-700 dark:text-rose-400">
              −{stats.removed}
            </span>
          </span>
        </div>
        <span
          className="text-[10px] uppercase tracking-[0.20em] text-muted-foreground/45"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          SKILL.md
        </span>
      </div>

      <div className="px-7">
        <div className="h-px bg-border/70" />
      </div>

      {/* ── Diff body — editable document, no box ───────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <SkillDiffEditor
          oldContent={proposal.oldContent}
          initialValue={proposal.newContent}
          onChange={setDraft}
        />
      </div>

      <div className="px-7">
        <div className="h-px bg-border/70" />
      </div>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="shrink-0 px-7 py-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground/65 leading-[1.5] max-w-[280px]">
          Apply writes the file exactly as shown above — your edits
          included. Dismiss leaves it untouched. The agent is told the
          verdict either way.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onDismiss}
            disabled={!!pending}
            className={cn(
              "press h-9 px-4 rounded-md",
              "text-[13px] text-foreground/80 hover:text-foreground",
              "hover:bg-foreground/[0.04]",
              "disabled:opacity-50 disabled:pointer-events-none",
              "transition-colors duration-150",
            )}
            style={{ fontFamily: "var(--font-body)", fontWeight: 500 }}
          >
            {pending === "dismiss" ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Dismissing
              </span>
            ) : (
              "Dismiss"
            )}
          </button>
          <button
            type="button"
            onClick={() => onApply(draft)}
            disabled={!!pending || noChange}
            title={noChange ? "Nothing to apply — matches the current file" : undefined}
            className={cn(
              "press h-9 px-5 rounded-md",
              "bg-primary text-primary-foreground",
              "hover:bg-primary/90",
              "shadow-[0_1px_0_0_hsl(var(--primary)_/_0.6)]",
              "disabled:opacity-60 disabled:pointer-events-none",
              "transition-colors duration-150",
              "inline-flex items-center gap-1.5 text-[13px]",
            )}
            style={{ fontFamily: "var(--font-body)", fontWeight: 500 }}
          >
            {pending === "apply" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Applying
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Apply change
              </>
            )}
          </button>
        </div>
      </footer>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// SkillDiffEditor — CodeMirror surface holding the proposed content as
// an editable document. A ViewPlugin re-diffs against `oldContent` on
// every keystroke and decorates: changed lines get a Coral margin tick;
// removed lines render as faint struck-through ghost rows inline.
// ──────────────────────────────────────────────────────────────────────

/** Faint, struck-through ghost rows for lines the change removed. */
class RemovedLinesWidget extends WidgetType {
  constructor(readonly lines: string[]) {
    super()
  }

  eq(other: RemovedLinesWidget) {
    return (
      other.lines.length === this.lines.length &&
      other.lines.every((line, i) => line === this.lines[i])
    )
  }

  toDOM() {
    const wrap = document.createElement("div")
    wrap.className = "cm-skilldiff-removed"
    for (const line of this.lines) {
      const row = document.createElement("div")
      row.className = "cm-skilldiff-removed-line"
      row.textContent = line.length > 0 ? line : " "
      wrap.appendChild(row)
    }
    return wrap
  }

  ignoreEvent() {
    return true
  }
}

/**
 * Diff the editor's current doc against `oldContent` and build the
 * decoration set: a line decoration (Coral tick) for each added/changed
 * line, a block widget of ghost rows wherever lines were removed.
 */
function buildDiffDecorations(
  view: EditorView,
  oldContent: string,
): DecorationSet {
  const doc = view.state.doc
  const chunks = diffLines(oldContent, doc.toString())
  const ranges: Range<Decoration>[] = []

  // 1-based line cursor into the *new* doc.
  let newLine = 1
  let pendingRemoved: string[] = []

  const flushRemoved = () => {
    if (pendingRemoved.length === 0) return
    const lines = pendingRemoved
    pendingRemoved = []
    const widget = Decoration.widget({
      widget: new RemovedLinesWidget(lines),
      block: true,
      side: newLine > doc.lines ? 1 : -1,
    })
    const pos =
      newLine > doc.lines ? doc.length : doc.line(newLine).from
    ranges.push(widget.range(pos))
  }

  for (const chunk of chunks) {
    const text = chunk.value.replace(/\n$/, "")
    const count = text.length > 0 ? text.split("\n").length : 0

    if (chunk.removed) {
      if (count > 0) pendingRemoved.push(...text.split("\n"))
      continue
    }

    // Unchanged or added: these lines exist in the new doc. Any pending
    // removed lines belong on the seam right above them.
    flushRemoved()

    if (chunk.added) {
      for (let i = 0; i < count; i++) {
        const line = doc.line(newLine + i)
        ranges.push(
          Decoration.line({ class: "cm-skilldiff-changed" }).range(line.from),
        )
      }
    }
    newLine += count
  }
  // Trailing removed lines (the change deleted the tail of the file).
  flushRemoved()

  return Decoration.set(ranges, true)
}

function skillDiffDecorations(oldContent: string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildDiffDecorations(view, oldContent)
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildDiffDecorations(update.view, oldContent)
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}

// Boxless editorial theme: transparent surface, mono document, a 2px
// Coral inset tick on changed lines, faint struck ghost rows. No
// gutter, no line numbers, no container chrome.
const skillDiffTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "hsl(var(--foreground) / 0.92)",
    fontSize: "12.5px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.7",
    overflow: "auto",
  },
  ".cm-content": { padding: "12px 0", caretColor: "hsl(var(--primary))" },
  ".cm-line": { padding: "0 28px" },
  ".cm-skilldiff-changed": {
    boxShadow: "inset 2px 0 0 0 hsl(var(--primary))",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "hsl(var(--primary))",
  },
  ".cm-selectionBackground": {
    backgroundColor: "hsl(var(--primary) / 0.13)",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "hsl(var(--primary) / 0.18)",
  },
  ".cm-skilldiff-removed": {
    padding: "1px 0",
  },
  ".cm-skilldiff-removed-line": {
    padding: "0 28px",
    color: "hsl(var(--muted-foreground) / 0.5)",
    textDecoration: "line-through",
    textDecorationColor: "hsl(var(--muted-foreground) / 0.35)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
})

function SkillDiffEditor({
  oldContent,
  initialValue,
  onChange,
}: {
  oldContent: string
  initialValue: string
  onChange: (next: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!hostRef.current) return

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        skillDiffDecorations(oldContent),
        skillDiffTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })

    return () => view.destroy()
    // The whole drawer body is keyed by proposal.id, so this mounts
    // fresh per proposal — oldContent/initialValue never change for a
    // given mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={hostRef} className="h-full" />
}
