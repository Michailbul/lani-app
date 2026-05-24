"use client"

/**
 * DiffSurface — unified, continuous review diff.
 *
 * One scrolling stream of lines, not a stack of per-hunk cards. Hunks
 * are joined into a single table; a thin location rail separates them
 * and carries that hunk's Approve / Dismiss controls. Content lines
 * are editable in place — click a line, type, and the edit is written
 * straight to the file.
 *
 * Blank-line additions and removals render as a slim, faint row rather
 * than a tall solid green/red bar — they are real changes, but a
 * whitespace tweak shouldn't shout as loud as a rewritten sentence.
 *
 * Router-agnostic: the entity editor (paths.*) and the screenplay
 * surface (artifacts.*) feed the same DiffHunk[] shape and pass their
 * own mutation callbacks.
 */

import { Fragment, useEffect, useRef, useState } from "react"
import { Check, X } from "lucide-react"
import { cn } from "../../lib/utils"

export type DiffLine = {
  kind: "add" | "del" | "ctx"
  text: string
  oldNo: number | null
  newNo: number | null
}

export type DiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: DiffLine[]
}

export interface DiffSurfaceProps {
  hunks: DiffHunk[]
  /** Show the per-hunk Approve / Dismiss controls. False for untracked
   *  files (they have no per-hunk granularity — the global Accept /
   *  Revert covers them). */
  perHunkEnabled: boolean
  onAcceptHunk: (index: number) => void
  onRejectHunk: (index: number) => void
  /** Index of the hunk currently being mutated, so its controls stay
   *  disabled and don't reflow under the user. */
  busyHunkIndex: number | null
  /** Per-line dismiss — optional. */
  perLineEnabled?: boolean
  onDismissLine?: (line: DiffLine) => void
  /** Per-line edit-in-place — optional. Returning a Promise lets the
   *  caller surface failures (stale diff, etc.) before the row exits
   *  edit mode. */
  onCommitLineEdit?: (line: DiffLine, newValue: string) => Promise<void>
  /** Hidden when the parent renders its own empty state. */
  emptyMessage?: string
}

/** Fixed column count — kept stable so the hunk rail can colSpan it. */
const COLS = 5

export function DiffSurface({
  hunks,
  perHunkEnabled,
  onAcceptHunk,
  onRejectHunk,
  busyHunkIndex,
  perLineEnabled,
  onDismissLine,
  onCommitLineEdit,
  emptyMessage,
}: DiffSurfaceProps) {
  if (hunks.length === 0) {
    return emptyMessage ? (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    ) : null
  }
  return (
    <div className="h-full">
      <div className="w-full max-w-[920px] mx-auto px-6 py-8">
        {/* One continuous diff. A single hairline frames the whole
            thing — no per-hunk cards. */}
        <div className="rounded-lg border border-border/60 overflow-hidden bg-card/20">
          <table className="w-full font-mono text-[13px] leading-6">
            {hunks.map((hunk, hi) => {
              const busy = busyHunkIndex === hi
              return (
                // One tbody per hunk so a hover anywhere in the hunk
                // can surface its controls, while the table stays a
                // single unified stream.
                <tbody key={hi} className="group/hunk">
                  <HunkRail
                    header={hunk.header}
                    first={hi === 0}
                    perHunkEnabled={perHunkEnabled}
                    busy={busy}
                    anyBusy={busyHunkIndex !== null}
                    onAccept={() => onAcceptHunk(hi)}
                    onReject={() => onRejectHunk(hi)}
                  />
                  {hunk.lines.map((line, li) => (
                    <DiffLineRow
                      key={`${hi}-${li}`}
                      line={line}
                      onDismiss={
                        perLineEnabled && onDismissLine && line.kind !== "ctx"
                          ? () => onDismissLine(line)
                          : undefined
                      }
                      onCommitEdit={
                        perLineEnabled &&
                        onCommitLineEdit &&
                        line.kind !== "del"
                          ? (newValue) => onCommitLineEdit(line, newValue)
                          : undefined
                      }
                    />
                  ))}
                </tbody>
              )
            })}
          </table>
        </div>
      </div>
    </div>
  )
}

/**
 * Hunk rail — a thin full-width row marking where a hunk sits in the
 * file. Carries that hunk's Approve / Dismiss. Sits inline in the
 * stream so the diff reads as one continuous thing.
 */
function HunkRail({
  header,
  first,
  perHunkEnabled,
  busy,
  anyBusy,
  onAccept,
  onReject,
}: {
  header: string
  first: boolean
  perHunkEnabled: boolean
  busy: boolean
  anyBusy: boolean
  onAccept: () => void
  onReject: () => void
}) {
  const location = header.replace(/^@@\s*|\s*@@$/g, "").trim()
  return (
    <tr>
      <td colSpan={COLS} className={cn(!first && "border-t border-border/60")}>
        <div className="flex items-center justify-between gap-2 px-3 py-1 bg-secondary/30">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/65">
            {location}
          </span>
          {perHunkEnabled && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onReject}
                disabled={busy || anyBusy}
                title="Dismiss this hunk (revert to HEAD just here)"
                className={cn(
                  "press flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                  "text-muted-foreground/70 hover:text-rose-700 dark:hover:text-rose-300",
                  "hover:bg-rose-500/10",
                  "transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
                  "disabled:opacity-50 disabled:cursor-progress disabled:active:scale-100",
                )}
              >
                <X className="h-3 w-3" />
                Dismiss
              </button>
              <button
                type="button"
                onClick={onAccept}
                disabled={busy || anyBusy}
                title="Approve this hunk (commit just this change)"
                className={cn(
                  "press flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                  "text-muted-foreground/70 hover:text-emerald-700 dark:hover:text-emerald-300",
                  "hover:bg-emerald-500/10",
                  "transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
                  "disabled:opacity-50 disabled:cursor-progress disabled:active:scale-100",
                )}
              >
                <Check className="h-3 w-3" />
                Approve
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

function DiffLineRow({
  line,
  onDismiss,
  onCommitEdit,
}: {
  line: DiffLine
  onDismiss?: () => void
  onCommitEdit?: (newValue: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(line.text)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // A blank-line change is a real change, but whitespace shouldn't
  // shout — render it as a slim faint row instead of a tall colour bar.
  const isBlank = line.text === ""

  useEffect(() => {
    if (!editing) setDraft(line.text)
  }, [line.text, editing])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const finishEdit = async (commit: boolean) => {
    if (commit && onCommitEdit && draft !== line.text) {
      try {
        await onCommitEdit(draft)
      } catch {
        /* error surfaces via mutation toast */
      }
    } else if (!commit) {
      setDraft(line.text)
    }
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      finishEdit(true)
    } else if (e.key === "Escape") {
      e.preventDefault()
      finishEdit(false)
    }
  }

  // Blank rows get the faintest possible tint; content rows keep the
  // readable green/red wash.
  const bg =
    line.kind === "add"
      ? isBlank
        ? "bg-emerald-500/[0.06]"
        : "bg-emerald-500/[0.13]"
      : line.kind === "del"
        ? isBlank
          ? "bg-rose-500/[0.06]"
          : "bg-rose-500/[0.13]"
        : ""
  const sigil = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "
  const sigilColor =
    line.kind === "add"
      ? isBlank
        ? "text-emerald-600/40 dark:text-emerald-400/35"
        : "text-emerald-700 dark:text-emerald-300"
      : line.kind === "del"
        ? isBlank
          ? "text-rose-600/40 dark:text-rose-400/35"
          : "text-rose-700 dark:text-rose-300"
        : "text-muted-foreground/40"
  const textColor =
    line.kind === "add"
      ? "text-emerald-900 dark:text-emerald-100"
      : line.kind === "del"
        ? "text-rose-900 dark:text-rose-100 line-through decoration-rose-500/50"
        : "text-foreground/80"

  // Slim metrics for blank rows — roughly a third of a content line.
  const numCell = cn(
    "select-none w-10 text-right pr-2 align-top font-mono tabular-nums",
    "text-[10px] text-muted-foreground/55",
    isBlank ? "leading-[8px] py-0" : "pt-0.5",
  )

  const editable = !!onCommitEdit && !isBlank

  return (
    <tr className={cn(bg, "group hover:bg-foreground/[0.04]")}>
      <td className={numCell}>{line.oldNo ?? ""}</td>
      <td className={numCell}>{line.newNo ?? ""}</td>
      <td
        className={cn(
          "select-none w-5 text-center align-top font-semibold",
          sigilColor,
          isBlank && "leading-[8px]",
        )}
      >
        {sigil}
      </td>
      <td
        className={cn(
          "pr-4 align-top whitespace-pre-wrap break-words",
          textColor,
          isBlank && "leading-[8px] py-0",
          editable &&
            !editing &&
            "cursor-text hover:outline hover:outline-1 hover:outline-primary/30",
        )}
        onClick={() => {
          if (editable && !editing) setEditing(true)
        }}
        title={editable && !editing ? "Click to edit this line" : undefined}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => finishEdit(true)}
            className={cn(
              "w-full bg-background/70 px-1 py-0 -my-0.5",
              "font-mono text-[13px] leading-6",
              "outline outline-2 outline-primary rounded-sm",
              textColor,
            )}
          />
        ) : isBlank ? (
          ""
        ) : (
          line.text || " "
        )}
      </td>
      <td
        className={cn(
          "select-none w-7 align-top pr-1",
          isBlank ? "py-0" : "pt-0.5",
        )}
      >
        {onDismiss && !isBlank && (
          <button
            type="button"
            onClick={onDismiss}
            title={
              line.kind === "add"
                ? "Dismiss this added line"
                : "Restore this removed line"
            }
            className={cn(
              "opacity-40 group-hover:opacity-100 focus:opacity-100 transition-opacity",
              "flex items-center justify-center w-5 h-5 rounded",
              "border border-transparent group-hover:border-border",
              "text-muted-foreground hover:text-rose-700 dark:hover:text-rose-300",
              "hover:bg-rose-500/15",
            )}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </td>
    </tr>
  )
}
