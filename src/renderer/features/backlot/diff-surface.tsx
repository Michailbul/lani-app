"use client"

/**
 * DiffSurface — Cursor-style green/red hunk renderer with per-hunk and
 * per-line review controls.
 *
 * Lifted from screenplay-pane.tsx so the entity-editor and the
 * screenplay pane can share one component. Both surfaces render the
 * same shape (DiffHunk[]) — the only difference is which router (the
 * legacy `artifacts.*` or the generalised `paths.*`) feeds the hunks
 * and which mutations the per-hunk buttons fire. We pass those in via
 * callbacks so the component itself is router-agnostic.
 *
 * Per-line dismiss + line edit are intentionally OPTIONAL — the
 * screenplay surface uses them, but for arbitrary files in the
 * generalised path flow we keep v1 surface area smaller (per-hunk
 * is enough; per-line can come later).
 */

import { useEffect, useRef, useState } from "react"
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
  /** Show the per-hunk Approve / Dismiss buttons. False for untracked
   *  files (they have no per-hunk granularity — the global Accept /
   *  Revert covers them). */
  perHunkEnabled: boolean
  onAcceptHunk: (index: number) => void
  onRejectHunk: (index: number) => void
  /** Index of the hunk currently being mutated, so its buttons stay
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
      <div className="w-full max-w-[920px] mx-auto px-6 py-8 space-y-6">
        {hunks.map((hunk, hi) => {
          const busy = busyHunkIndex === hi
          return (
            <div
              key={hi}
              className="rounded-lg border border-border overflow-hidden bg-card/40"
            >
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-secondary/40 border-b border-border">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {hunk.header.replace(/^@@\s*|\s*@@$/g, "")}
                </span>
                {perHunkEnabled && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onRejectHunk(hi)}
                      disabled={busy || busyHunkIndex !== null}
                      title="Dismiss this hunk (revert to HEAD just here)"
                      className={cn(
                        "press flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                        "border border-border bg-background hover:bg-rose-500/10",
                        "text-foreground/70 hover:text-rose-700 dark:hover:text-rose-300",
                        "transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
                        "disabled:opacity-50 disabled:cursor-progress disabled:active:scale-100",
                      )}
                    >
                      <X className="h-3 w-3" />
                      Dismiss
                    </button>
                    <button
                      type="button"
                      onClick={() => onAcceptHunk(hi)}
                      disabled={busy || busyHunkIndex !== null}
                      title="Approve this hunk (commit just this change)"
                      className={cn(
                        "press flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                        "border border-border bg-background hover:bg-emerald-500/10",
                        "text-foreground/70 hover:text-emerald-700 dark:hover:text-emerald-300",
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
              <table className="w-full font-mono text-[13px] leading-6">
                <tbody>
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
              </table>
            </div>
          )
        })}
      </div>
    </div>
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

  const bg =
    line.kind === "add"
      ? "bg-emerald-500/15 dark:bg-emerald-500/15"
      : line.kind === "del"
        ? "bg-rose-500/15 dark:bg-rose-500/15"
        : ""
  const sigil =
    line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "
  const sigilColor =
    line.kind === "add"
      ? "text-emerald-700 dark:text-emerald-300"
      : line.kind === "del"
        ? "text-rose-700 dark:text-rose-300"
        : "text-muted-foreground/40"
  const textColor =
    line.kind === "add"
      ? "text-emerald-900 dark:text-emerald-100"
      : line.kind === "del"
        ? "text-rose-900 dark:text-rose-100 line-through decoration-rose-500/50"
        : "text-foreground/80"

  return (
    <tr className={cn(bg, "group hover:bg-foreground/[0.04]")}>
      <td className="select-none w-10 text-right pr-2 align-top text-[10px] text-muted-foreground/60 font-mono tabular-nums pt-0.5">
        {line.oldNo ?? ""}
      </td>
      <td className="select-none w-10 text-right pr-2 align-top text-[10px] text-muted-foreground/60 font-mono tabular-nums pt-0.5">
        {line.newNo ?? ""}
      </td>
      <td
        className={cn(
          "select-none w-5 text-center align-top font-semibold",
          sigilColor,
        )}
      >
        {sigil}
      </td>
      <td
        className={cn(
          "pr-4 align-top whitespace-pre-wrap break-words",
          textColor,
          onCommitEdit &&
            !editing &&
            "cursor-text hover:outline hover:outline-1 hover:outline-primary/30",
        )}
        onClick={() => {
          if (onCommitEdit && !editing) setEditing(true)
        }}
        title={
          onCommitEdit && !editing ? "Click to edit this line" : undefined
        }
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
        ) : (
          line.text || " "
        )}
      </td>
      <td className="select-none w-7 align-top pt-0.5 pr-1">
        {onDismiss && (
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
