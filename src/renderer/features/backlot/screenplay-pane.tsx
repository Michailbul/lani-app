"use client"

/**
 * ScreenplayPane — Backlot's center surface.
 *
 * v1 reads the primary screenplay artifact (<worktree>/screenplay.fountain)
 * via the artifacts tRPC router and renders it as preformatted text. The
 * agent in the right-rail chat is system-prompted to Edit/Write this file
 * directly — so when the user asks for a scene, the result lands here,
 * not in chat.
 *
 * Phase D2 swaps the <pre> render below for a CodeMirror 6 surface with
 * a Fountain syntax mode + scene navigator. The data shape (artifact
 * content + relative path) does not change.
 */

import {
  ArrowLeftRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  Columns,
  Eye,
  FileEdit,
  FileQuestion,
  FileText,
  Film,
  History,
  ListTree,
  RotateCcw,
  Save,
  Undo2,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"

// Local mirror of the DiffHunk shape from artifacts.ts. Keeping it as a
// type-only declaration here avoids a renderer→main-process import cycle.
type DiffLine = {
  kind: "add" | "del" | "ctx"
  text: string
  oldNo: number | null
  newNo: number | null
}
type DiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: DiffLine[]
}

type ViewMode = "editor" | "preview" | "split" | "history"

// Mirrors the OutlineNode shape returned by artifacts.outline. Recursive
// structure for the gutter tree.
type OutlineNode = {
  id: string
  kind: "section" | "scene"
  label: string
  rawHeading: string
  depth: number
  startLine: number
  endLine: number
  occurrence: number
  children: OutlineNode[]
}

// What part the user clicked the history chevron on. Persists in
// ScreenplayPane state so the drawer survives viewMode toggles.
type PartHistoryTarget = {
  kind: "section" | "scene" | "range"
  label?: string
  occurrence: number
  /** The part's CURRENT line range in the working tree — used by restorePart. */
  startLine: number
  endLine: number
  /** Display name for the drawer header. */
  displayName: string
}

// Mirrors PartRevision from artifacts.ts.
type PartRevision = {
  hash: string
  shortHash: string
  subject: string
  author: string
  isoDate: string
  relativeDate: string
  content: string
  startLine: number
  endLine: number
  match: "exact" | "fallback" | null
}

interface ScreenplayPaneProps {
  chatId?: string | null
  directionName?: string | null
}

const VIEW_TABS: { id: ViewMode; label: string; icon: typeof FileText }[] = [
  { id: "editor", label: "Editor", icon: FileEdit },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "split", label: "Split", icon: Columns },
  { id: "history", label: "History", icon: History },
]

const REFETCH_INTERVAL_MS = 2000 // poll while user is on the pane; cheap and avoids needing a watcher subscription for v1

export function ScreenplayPane({ chatId, directionName }: ScreenplayPaneProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("editor")

  const artifact = trpc.artifacts.read.useQuery(
    { chatId: chatId ?? "" },
    {
      enabled: !!chatId,
      refetchInterval: REFETCH_INTERVAL_MS,
      refetchOnWindowFocus: true,
    },
  )

  const ensure = trpc.artifacts.ensure.useMutation({
    onSuccess: () => artifact.refetch(),
  })

  const diff = trpc.artifacts.diff.useQuery(
    { chatId: chatId ?? "" },
    {
      enabled: !!chatId,
      refetchInterval: REFETCH_INTERVAL_MS,
      refetchOnWindowFocus: true,
    },
  )

  const refreshAll = () => {
    artifact.refetch()
    diff.refetch()
  }

  const accept = trpc.artifacts.accept.useMutation({ onSuccess: refreshAll })
  const reject = trpc.artifacts.reject.useMutation({ onSuccess: refreshAll })

  // Per-hunk approve / dismiss. Only available for "modified" diffs —
  // untracked files have no per-hunk granularity (the global Accept /
  // Revert covers them). Track the busy hunk index so the rest of the
  // diff doesn't reflow under the user mid-decision.
  const [busyHunkIndex, setBusyHunkIndex] = useState<number | null>(null)
  const acceptHunk = trpc.artifacts.acceptHunk.useMutation({
    onSettled: () => {
      setBusyHunkIndex(null)
      refreshAll()
    },
  })
  const rejectHunk = trpc.artifacts.rejectHunk.useMutation({
    onSettled: () => {
      setBusyHunkIndex(null)
      refreshAll()
    },
  })
  const onAcceptHunk = (hunkIndex: number) => {
    if (!chatId) return
    setBusyHunkIndex(hunkIndex)
    acceptHunk.mutate({ chatId, hunkIndex })
  }
  const onRejectHunk = (hunkIndex: number) => {
    if (!chatId) return
    setBusyHunkIndex(hunkIndex)
    rejectHunk.mutate({ chatId, hunkIndex })
  }

  // Per-line dismiss — the finest granularity. Each + or - line in the
  // diff gets a × button. Server does direct working-tree surgery; loud
  // error if the line moved under us so we can surface it to the user.
  const [lineError, setLineError] = useState<string | null>(null)
  const dismissLine = trpc.artifacts.dismissLine.useMutation({
    onSuccess: () => setLineError(null),
    onError: (err) => setLineError(err.message),
    onSettled: refreshAll,
  })

  // Inline edit-in-diff — click a + or context line to type a replacement.
  // Saves the whole file via artifacts.write, which the diff refetch
  // reflects as a new pending change replacing the original.
  const writeArtifact = trpc.artifacts.write.useMutation({
    onSettled: refreshAll,
  })
  const commitLineEdit = async (
    line: DiffLine,
    newValue: string,
  ): Promise<void> => {
    if (!chatId) return
    if (newValue === line.text) return // no-op
    if (line.newNo == null) {
      setLineError("Cannot edit a removed line. Click × to restore it instead.")
      return
    }
    const current = content ?? ""
    const lines = current.split("\n")
    const idx = line.newNo - 1
    let targetIdx = -1
    if (idx >= 0 && idx < lines.length && lines[idx] === line.text) {
      targetIdx = idx
    } else {
      targetIdx = lines.findIndex((l) => l === line.text)
    }
    if (targetIdx < 0) {
      setLineError(
        "Couldn't find the line in the working tree — it may have shifted. Refresh and try again.",
      )
      return
    }
    lines[targetIdx] = newValue
    await writeArtifact.mutateAsync({
      chatId,
      content: lines.join("\n"),
    })
  }
  const onDismissLine = (line: DiffLine) => {
    if (!chatId) return
    if (line.kind === "ctx") return
    dismissLine.mutate({
      chatId,
      kind: line.kind,
      oldNo: line.oldNo,
      newNo: line.newNo,
      text: line.text,
    })
  }

  // Outline + part-history. The gutter renders the outline tree; clicking
  // the history chevron on a node sets `partHistoryTarget`, which opens
  // the drawer. Drawer state lives at this level so it survives viewMode
  // toggles (you can open history for Scene 3 in editor mode, click into
  // history view, and the drawer is still there when you come back).
  const outline = trpc.artifacts.outline.useQuery(
    { chatId: chatId ?? "" },
    {
      enabled: !!chatId,
      refetchInterval: REFETCH_INTERVAL_MS,
      refetchOnWindowFocus: true,
    },
  )
  const [partHistoryTarget, setPartHistoryTarget] =
    useState<PartHistoryTarget | null>(null)
  const onOpenPartHistory = (node: OutlineNode) => {
    setPartHistoryTarget({
      kind: node.kind,
      label: node.label,
      occurrence: node.occurrence,
      startLine: node.startLine,
      endLine: node.endLine,
      displayName: node.rawHeading.trim() || node.label,
    })
  }
  const closePartHistory = () => setPartHistoryTarget(null)

  const content = artifact.data?.content ?? null
  const exists = artifact.data?.exists ?? false
  const relativePath = artifact.data?.relativePath ?? "screenplay.fountain"
  const outlineTree = (outline.data?.tree ?? []) as OutlineNode[]
  const outlineFlat = (outline.data?.flat ?? []) as OutlineNode[]

  const diffStatus = diff.data?.status ?? "missing"
  const hunks = (diff.data?.hunks ?? []) as DiffHunk[]
  const hasPending = diffStatus === "modified" || diffStatus === "untracked"

  const stats = useMemo(() => computeStats(content), [content])

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      {/* Slug bar */}
      <div className="flex items-center justify-between h-9 px-4 border-b border-border bg-card/40 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground/80 truncate">
            {directionName ?? "No direction"}
          </span>
          <span className="text-muted-foreground/50 text-xs">·</span>
          <span className="text-xs text-muted-foreground truncate font-mono">
            {relativePath}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-mono">
          Backlot
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between h-10 px-3 border-b border-border bg-background select-none">
        <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-secondary/60 border border-border/50">
          {VIEW_TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = viewMode === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setViewMode(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground/80",
                )}
              >
                <Icon className="h-3 w-3" />
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono tabular-nums">
          <span>{stats.pages.toFixed(1)} pages</span>
          <span className="text-muted-foreground/40">·</span>
          <span>~{stats.runtimeMin} min</span>
          <button
            disabled
            className={cn(
              "ml-2 flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium",
              "bg-secondary text-muted-foreground/50 cursor-not-allowed",
            )}
            title="Auto-saved by the agent on every Edit/Write"
          >
            <Save className="h-3 w-3" />
            Auto
          </button>
        </div>
      </div>

      {/* Per-line operation error — surfaces stale-diff or surgery failures */}
      {lineError && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-rose-500/10">
          <div className="flex items-center gap-2 text-xs">
            <X className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
            <span className="text-rose-900 dark:text-rose-100">{lineError}</span>
          </div>
          <button
            type="button"
            onClick={() => setLineError(null)}
            className="text-rose-700 dark:text-rose-300 hover:text-rose-900 dark:hover:text-rose-100 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Pending-changes review bar — only when the file differs from HEAD */}
      {hasPending && (
        <div
          className={cn(
            "flex items-center justify-between px-3 py-2 border-b border-border",
            "bg-primary/10",
          )}
        >
          <div className="flex items-center gap-2 text-xs text-foreground">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="font-medium">
              {diffStatus === "untracked"
                ? "New screenplay from the agent."
                : "Pending changes from the agent."}
            </span>
            <span className="text-muted-foreground">
              Review the highlights below — accept to commit, revert to discard.
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => chatId && reject.mutate({ chatId })}
              disabled={reject.isPending || accept.isPending}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium",
                "border border-border bg-background hover:bg-secondary",
                "text-foreground/80 hover:text-foreground transition-colors",
                "disabled:opacity-50 disabled:cursor-progress",
              )}
            >
              <Undo2 className="h-3 w-3" />
              Revert
            </button>
            <button
              type="button"
              onClick={() => chatId && accept.mutate({ chatId })}
              disabled={accept.isPending || reject.isPending}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium",
                "bg-primary text-primary-foreground hover:opacity-90",
                "disabled:opacity-50 disabled:cursor-progress",
              )}
            >
              <Check className="h-3 w-3" />
              Accept
            </button>
          </div>
        </div>
      )}

      {/* Surface — `relative` lets the part-history drawer overlay anchor here */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <div className="absolute inset-0 overflow-auto">
        {!chatId ? (
          <NoChatState />
        ) : !exists ? (
          <NoArtifactState
            onEnsure={() => chatId && ensure.mutate({ chatId })}
            isEnsuring={ensure.isPending}
          />
        ) : viewMode === "history" ? (
          <HistorySurface chatId={chatId} onRestored={refreshAll} />
        ) : hasPending && viewMode !== "preview" ? (
          // While there are pending changes, the editor view shows the
          // green/red diff. Preview still renders the current full content
          // (post-edit) so the user can see what they'd be approving.
          viewMode === "split" ? (
            <div className="grid grid-cols-2 h-full">
              <div className="border-r border-border min-h-0 overflow-auto">
                <DiffSurface
              hunks={hunks}
              perHunkEnabled={diffStatus === "modified"}
              onAcceptHunk={onAcceptHunk}
              onRejectHunk={onRejectHunk}
              busyHunkIndex={busyHunkIndex}
              perLineEnabled={diffStatus === "modified"}
              onDismissLine={onDismissLine}
              onCommitLineEdit={commitLineEdit}
            />
              </div>
              <div className="min-h-0 overflow-auto">
                <PreviewSurface content={content} />
              </div>
            </div>
          ) : (
            <DiffSurface
              hunks={hunks}
              perHunkEnabled={diffStatus === "modified"}
              onAcceptHunk={onAcceptHunk}
              onRejectHunk={onRejectHunk}
              busyHunkIndex={busyHunkIndex}
              perLineEnabled={diffStatus === "modified"}
              onDismissLine={onDismissLine}
              onCommitLineEdit={commitLineEdit}
            />
          )
        ) : viewMode === "preview" ? (
          <PreviewSurface content={content} />
        ) : viewMode === "split" ? (
          <div className="grid grid-cols-2 h-full">
            <div className="border-r border-border min-h-0 overflow-auto">
              <EditorSurface
                content={content}
                chatId={chatId ?? null}
                onSaved={refreshAll}
                outline={outlineTree}
                outlineFlat={outlineFlat}
                onOpenPartHistory={onOpenPartHistory}
              />
            </div>
            <div className="min-h-0 overflow-auto">
              <PreviewSurface content={content} />
            </div>
          </div>
        ) : (
          <EditorSurface
            content={content}
            chatId={chatId ?? null}
            onSaved={refreshAll}
            outline={outlineTree}
            outlineFlat={outlineFlat}
            onOpenPartHistory={onOpenPartHistory}
          />
        )}
        </div>

        {/* Part history drawer — overlays the right side of the surface. */}
        {partHistoryTarget && chatId && (
          <PartHistoryDrawer
            chatId={chatId}
            target={partHistoryTarget}
            onClose={closePartHistory}
            onRestored={() => {
              closePartHistory()
              refreshAll()
            }}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between h-7 px-4 border-t border-border bg-card/40 select-none">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70 font-mono tabular-nums uppercase tracking-wider">
          <span>{stats.words} words</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{stats.scenes} scenes</span>
        </div>
        <div className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider">
          Fountain
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Surfaces
// ────────────────────────────────────────────────────────────────────────

interface EditorSurfaceProps {
  content: string | null
  chatId: string | null
  /** Called whenever the user-typed buffer is flushed to disk. */
  onSaved?: () => void
  /** Outline tree (sections + scenes) to render in the left gutter. */
  outline?: OutlineNode[]
  /** Same outline in document order — used to flatten when needed. */
  outlineFlat?: OutlineNode[]
  /** Click handler on a node's history chevron — opens the drawer. */
  onOpenPartHistory?: (node: OutlineNode) => void
}

/**
 * EditorSurface — direct in-place editing of the screenplay artifact.
 *
 * Buffers the user's keystrokes locally and debounces saves to disk via
 * artifacts.write. Once the file lands the diff query (running on a 2 s
 * refetchInterval upstream) picks the change up and the surface flips
 * to the green/red review view — same flow the agent's edits go through.
 *
 * If the file changes on disk WHILE the user is editing (the agent
 * writes mid-typing), we don't blow away their buffer; instead we leave
 * the local state alone until the user pauses (no keystrokes for ≥ the
 * settle window) at which point the next server sync wins. For v1 this
 * race is acceptable — collaborative editing with operational transform
 * is deferred.
 *
 * Layout: a narrow OutlineGutter on the left (table-of-contents style,
 * with expand-history chevrons next to each section/scene), the
 * centered textarea on the right. The gutter hides itself when the
 * outline is empty so a fresh screenplay still gets full width.
 */
function EditorSurface({
  content,
  chatId,
  onSaved,
  outline,
  outlineFlat,
  onOpenPartHistory,
}: EditorSurfaceProps) {
  const [value, setValue] = useState<string>(content ?? "")
  const lastTypedRef = useRef<number>(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const write = trpc.artifacts.write.useMutation({
    onSuccess: () => onSaved?.(),
  })

  // Pull server content into the local buffer when the user is idle.
  // "Idle" = no keystroke in the last 800 ms. Prevents server-side
  // refetches from clobbering the user's mid-typing draft.
  useEffect(() => {
    if (content == null) return
    if (Date.now() - lastTypedRef.current < 800) return
    setValue(content)
  }, [content])

  // Cleanup any pending save on unmount.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    setValue(next)
    lastTypedRef.current = Date.now()
    if (!chatId) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      write.mutate({ chatId, content: next })
    }, 600)
  }

  if (!content && !value) {
    return <BlankCanvas />
  }

  const hasOutline = (outlineFlat?.length ?? 0) > 0

  return (
    <div className="h-full flex">
      {hasOutline && onOpenPartHistory && (
        <OutlineGutter
          tree={outline ?? []}
          onOpenHistory={onOpenPartHistory}
        />
      )}
      <div className="flex-1 min-w-0 overflow-auto">
        <div className="h-full flex justify-center">
          <textarea
            value={value}
            onChange={onChange}
            spellCheck
            autoCorrect="off"
            autoCapitalize="off"
            wrap="soft"
            className={cn(
              "w-full max-w-[820px] mx-auto px-10 py-12",
              "font-mono text-sm leading-7 text-foreground/90",
              "bg-transparent border-0 outline-none resize-none",
              "select-text",
              "min-h-full",
              // Subtle ring on focus instead of the default browser outline.
              "focus:outline-none focus:ring-0",
              "caret-primary",
            )}
            placeholder="Start typing your screenplay, or ask the assistant on the right to draft it."
          />
        </div>
      </div>
    </div>
  )
}

interface DiffSurfaceProps {
  hunks: DiffHunk[]
  perHunkEnabled: boolean
  onAcceptHunk: (index: number) => void
  onRejectHunk: (index: number) => void
  busyHunkIndex: number | null
  perLineEnabled: boolean
  onDismissLine: (line: DiffLine) => void
  onCommitLineEdit: (line: DiffLine, newValue: string) => Promise<void>
}

function DiffSurface({
  hunks,
  perHunkEnabled,
  onAcceptHunk,
  onRejectHunk,
  busyHunkIndex,
  perLineEnabled,
  onDismissLine,
  onCommitLineEdit,
}: DiffSurfaceProps) {
  if (hunks.length === 0) {
    return <BlankCanvas />
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
                        "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                        "border border-border bg-background hover:bg-rose-500/10",
                        "text-foreground/70 hover:text-rose-700 dark:hover:text-rose-300",
                        "transition-colors disabled:opacity-50 disabled:cursor-progress",
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
                        "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                        "border border-border bg-background hover:bg-emerald-500/10",
                        "text-foreground/70 hover:text-emerald-700 dark:hover:text-emerald-300",
                        "transition-colors disabled:opacity-50 disabled:cursor-progress",
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
                        perLineEnabled && line.kind !== "ctx"
                          ? () => onDismissLine(line)
                          : undefined
                      }
                      onCommitEdit={
                        perLineEnabled && line.kind !== "del"
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

  // Sync draft with prop changes when not actively editing.
  useEffect(() => {
    if (!editing) setDraft(line.text)
  }, [line.text, editing])

  // Focus + select-all when entering edit mode.
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
  // Dual-tone palette: dark text on tinted-light bg in light mode, light
  // text on tinted-dark bg in dark mode. Sigil column uses saturated
  // emerald-700/rose-700 (light) or emerald-300/rose-300 (dark) and is
  // semibold so the +/− reads unambiguously against the row bg.
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
      <td className={cn("select-none w-5 text-center align-top font-semibold", sigilColor)}>
        {sigil}
      </td>
      <td
        className={cn(
          "pr-4 align-top whitespace-pre-wrap break-words",
          textColor,
          onCommitEdit && !editing && "cursor-text hover:outline hover:outline-1 hover:outline-primary/30",
        )}
        onClick={() => {
          if (onCommitEdit && !editing) setEditing(true)
        }}
        title={onCommitEdit && !editing ? "Click to edit this line" : undefined}
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
          (line.text || "\u00A0")
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

function PreviewSurface({ content }: { content: string | null }) {
  // Phase D3 wires afterwriting-labs for proper screenplay typesetting.
  // For v1 this is a clean center-aligned reader view of the same source.
  if (!content || content.trim().length === 0) {
    return <BlankCanvas variant="preview" />
  }
  return (
    <div className="h-full bg-secondary/20">
      <div className="max-w-[700px] mx-auto px-12 py-14 font-mono text-sm leading-7 text-foreground/90 whitespace-pre-wrap select-text">
        {content}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// History — time-travel through the screenplay's commits
// ────────────────────────────────────────────────────────────────────────

function HistorySurface({
  chatId,
  onRestored,
}: {
  chatId: string
  onRestored: () => void
}) {
  const history = trpc.artifacts.history.useQuery(
    { chatId, limit: 80 },
    { refetchOnWindowFocus: true },
  )
  const [selectedHash, setSelectedHash] = useState<string | null>(null)

  // Auto-select the most recent commit when history loads.
  if (
    history.data &&
    history.data.length > 0 &&
    selectedHash === null
  ) {
    setSelectedHash(history.data[0].hash)
  }

  const versionAt = trpc.artifacts.versionAt.useQuery(
    { chatId, commitHash: selectedHash ?? "" },
    { enabled: !!selectedHash },
  )

  const restore = trpc.artifacts.restore.useMutation({
    onSettled: () => onRestored(),
  })

  const commits = history.data ?? []

  if (history.isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Loading history…
      </div>
    )
  }

  if (commits.length === 0) {
    return (
      <div className="h-full flex items-center justify-center px-8">
        <div className="max-w-md text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-full bg-secondary/60 border border-border/60 flex items-center justify-center">
            <History className="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            No history yet.
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            History fills in as you Accept or Approve agent edits — each
            commit becomes a snapshot you can browse or restore.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[300px_1fr] h-full">
      {/* Timeline */}
      <div className="border-r border-border overflow-auto">
        <div className="px-3 py-2 border-b border-border bg-card/40 sticky top-0 z-10">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
            Timeline · {commits.length} commit{commits.length === 1 ? "" : "s"}
          </div>
        </div>
        <ol className="divide-y divide-border">
          {commits.map((c) => {
            const isSelected = c.hash === selectedHash
            return (
              <li key={c.hash}>
                <button
                  type="button"
                  onClick={() => setSelectedHash(c.hash)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 transition-colors",
                    "hover:bg-secondary/40",
                    isSelected && "bg-primary/10 hover:bg-primary/10",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className="text-sm font-medium text-foreground/90 truncate">
                      {c.subject || "(no message)"}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums shrink-0">
                      {c.shortHash}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{c.relativeDate}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-mono tabular-nums">
                      +{c.additions}
                    </span>
                    <span className="text-rose-700 dark:text-rose-400 font-mono tabular-nums">
                      −{c.deletions}
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      {/* Selected version reader */}
      <div className="overflow-auto bg-secondary/10">
        {!selectedHash ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Pick a commit on the left to preview.
          </div>
        ) : versionAt.isLoading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Loading snapshot…
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 border-b border-border bg-card/80 backdrop-blur">
              <div className="text-xs font-mono text-muted-foreground">
                {commits.find((c) => c.hash === selectedHash)?.shortHash}
                <span className="mx-2 text-muted-foreground/40">·</span>
                {commits.find((c) => c.hash === selectedHash)?.relativeDate}
              </div>
              <button
                type="button"
                onClick={() =>
                  restore.mutate({ chatId, commitHash: selectedHash })
                }
                disabled={restore.isPending}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium",
                  "bg-primary text-primary-foreground hover:opacity-90",
                  "disabled:opacity-50 disabled:cursor-progress",
                )}
                title="Copy this snapshot into the working tree as a pending change"
              >
                <RotateCcw className="h-3 w-3" />
                {restore.isPending ? "Restoring…" : "Restore this version"}
              </button>
            </div>
            <pre className="px-10 py-10 font-mono text-sm leading-7 text-foreground/90 whitespace-pre-wrap break-words select-text">
              {versionAt.data?.content ?? ""}
            </pre>
          </>
        )}
      </div>
    </div>
  )
}

function BlankCanvas({ variant = "editor" }: { variant?: "editor" | "preview" }) {
  return (
    <div
      className={cn(
        "h-full flex items-center justify-center px-8",
        variant === "preview" && "bg-secondary/20",
      )}
    >
      <div className="max-w-md text-center space-y-3">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          The page is yours.
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Ask the assistant on the right to draft a scene — the result lands
          here, not in chat. The agent edits this file in place.
        </p>
      </div>
    </div>
  )
}

function NoChatState() {
  return (
    <div className="h-full flex items-center justify-center px-8">
      <div className="max-w-md text-center space-y-3">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Pick a direction.
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Open a chat in the sidebar, or start a new one. Each direction is its
          own git worktree, with its own screenplay artifact.
        </p>
      </div>
    </div>
  )
}

function NoArtifactState({
  onEnsure,
  isEnsuring,
}: {
  onEnsure: () => void
  isEnsuring: boolean
}) {
  return (
    <div className="h-full flex items-center justify-center px-8">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-secondary/60 border border-border/60 flex items-center justify-center">
          <FileQuestion className="h-5 w-5 text-muted-foreground" />
        </div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          No screenplay yet.
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Send the assistant a prompt — it will create{" "}
          <code className="font-mono text-xs">screenplay.fountain</code>{" "}
          automatically. Or seed an empty one to start typing yourself.
        </p>
        <button
          type="button"
          onClick={onEnsure}
          disabled={isEnsuring}
          className={cn(
            "px-3 py-1.5 rounded-md text-xs font-medium",
            "bg-primary text-primary-foreground hover:opacity-90",
            "disabled:opacity-50 disabled:cursor-progress",
          )}
        >
          {isEnsuring ? "Creating…" : "Seed empty screenplay"}
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Outline gutter — sections + scenes in document order, each with a
// history chevron that opens the PartHistoryDrawer for that part.
// ────────────────────────────────────────────────────────────────────────

interface OutlineGutterProps {
  tree: OutlineNode[]
  onOpenHistory: (node: OutlineNode) => void
}

function OutlineGutter({ tree, onOpenHistory }: OutlineGutterProps) {
  return (
    <aside className="w-64 shrink-0 border-r border-border bg-card/40 overflow-auto">
      <div className="px-3 py-3 border-b border-border bg-card/60 sticky top-0 z-10">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
          <ListTree className="h-3 w-3" />
          Outline
        </div>
      </div>
      <div className="py-2">
        {tree.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground/60">
            Add a `# Section` or an `INT./EXT.` scene heading to populate the
            outline.
          </div>
        ) : (
          tree.map((node) => (
            <OutlineNodeRow
              key={node.id}
              node={node}
              onOpenHistory={onOpenHistory}
            />
          ))
        )}
      </div>
    </aside>
  )
}

interface OutlineNodeRowProps {
  node: OutlineNode
  onOpenHistory: (node: OutlineNode) => void
}

function OutlineNodeRow({ node, onOpenHistory }: OutlineNodeRowProps) {
  const Icon = node.kind === "section" ? BookOpen : Film
  const indent =
    node.kind === "section" ? (node.depth - 1) * 10 : (node.depth) * 10 + 14
  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1.5 pl-3 pr-2 py-1 text-xs",
          "hover:bg-secondary/60 transition-colors",
        )}
        style={{ paddingLeft: 12 + indent }}
      >
        <Icon
          className={cn(
            "h-3 w-3 shrink-0",
            node.kind === "section"
              ? "text-primary/80"
              : "text-muted-foreground/70",
          )}
        />
        <span
          className={cn(
            "truncate flex-1 min-w-0",
            node.kind === "section"
              ? "font-medium text-foreground"
              : "text-foreground/80 font-mono text-[11px]",
          )}
          title={node.label}
        >
          {node.label}
        </span>
        <button
          type="button"
          onClick={() => onOpenHistory(node)}
          className={cn(
            "shrink-0 p-1 rounded opacity-0 group-hover:opacity-100",
            "hover:bg-primary/15 hover:text-primary transition-colors",
            "text-muted-foreground",
          )}
          aria-label={`Open history of ${node.label}`}
          title="Open part history"
        >
          <Clock className="h-3 w-3" />
        </button>
      </div>
      {node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <OutlineNodeRow
              key={child.id}
              node={child}
              onOpenHistory={onOpenHistory}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Part history drawer — overlays the surface, listing every revision of
// a single section/scene/range with a "Swap into current" action.
// ────────────────────────────────────────────────────────────────────────

interface PartHistoryDrawerProps {
  chatId: string
  target: PartHistoryTarget
  onClose: () => void
  onRestored: () => void
}

function PartHistoryDrawer({
  chatId,
  target,
  onClose,
  onRestored,
}: PartHistoryDrawerProps) {
  const history = trpc.artifacts.partHistory.useQuery({
    chatId,
    kind: target.kind,
    label: target.label,
    occurrence: target.occurrence,
    startLine: target.startLine,
    endLine: target.endLine,
  })
  const restorePart = trpc.artifacts.restorePart.useMutation({
    onSuccess: onRestored,
  })

  // Esc-to-close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  const revisions = (history.data ?? []) as PartRevision[]

  return (
    <>
      {/* Backdrop — click to close, transparent so the editor stays visible. */}
      <div
        className="absolute inset-0 bg-background/40 backdrop-blur-[1px] z-20"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 w-[460px] z-30",
          "bg-card border-l border-border shadow-2xl",
          "flex flex-col overflow-hidden",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 h-11 px-4 border-b border-border bg-card/80">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <History className="h-3.5 w-3.5 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
                History — {target.kind}
              </div>
              <div
                className="text-xs font-medium text-foreground truncate"
                title={target.displayName}
              >
                {target.displayName}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close history"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — list of revisions */}
        <div className="flex-1 min-h-0 overflow-auto">
          {history.isPending ? (
            <div className="p-6 text-xs text-muted-foreground">
              Walking commits…
            </div>
          ) : revisions.length === 0 ? (
            <div className="p-6 text-xs text-muted-foreground">
              No prior versions of this part. Once changes are accepted, every
              revision lives here.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {revisions.map((rev, idx) => (
                <RevisionRow
                  key={rev.hash}
                  rev={rev}
                  isLatest={idx === 0}
                  isCurrent={idx === 0}
                  pending={
                    restorePart.isPending && restorePart.variables?.content === rev.content
                  }
                  onSwap={() =>
                    restorePart.mutate({
                      chatId,
                      // Restore at the part's CURRENT line range — that's
                      // where the splice happens. The historical line
                      // range is informational only.
                      startLine: target.startLine,
                      endLine: target.endLine,
                      content: rev.content,
                    })
                  }
                />
              ))}
            </ul>
          )}
        </div>

        {/* Footer — error surface */}
        {restorePart.error && (
          <div className="px-4 py-2 border-t border-border bg-rose-500/10 text-xs text-rose-900 dark:text-rose-100">
            {restorePart.error.message}
          </div>
        )}
        <div className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground/70 font-mono uppercase tracking-wider">
          Swapping a version creates a pending diff — review &amp; accept like
          any other edit.
        </div>
      </div>
    </>
  )
}

interface RevisionRowProps {
  rev: PartRevision
  isLatest: boolean
  isCurrent: boolean
  pending: boolean
  onSwap: () => void
}

function RevisionRow({ rev, isLatest, pending, onSwap }: RevisionRowProps) {
  const [expanded, setExpanded] = useState(isLatest)
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] flex-wrap">
            <span className="font-mono text-foreground/90">
              {rev.shortHash}
            </span>
            <span className="text-muted-foreground/50">·</span>
            <span className="text-muted-foreground">{rev.relativeDate}</span>
            {isLatest && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                Latest
              </span>
            )}
            {rev.match === "fallback" && (
              <span
                className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium"
                title="Same heading text but a different occurrence index — verify before swapping."
              >
                Fuzzy
              </span>
            )}
          </div>
          <div className="text-xs text-foreground/80 mt-1 line-clamp-2">
            {rev.subject}
          </div>
          <div className="text-[10px] text-muted-foreground/60 mt-0.5">
            {rev.author}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              "p-1.5 rounded text-muted-foreground hover:text-foreground",
              "hover:bg-secondary transition-colors",
            )}
            title={expanded ? "Collapse preview" : "Expand preview"}
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                expanded && "rotate-90",
              )}
            />
          </button>
          <button
            type="button"
            onClick={onSwap}
            disabled={pending}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
              "border border-border bg-background hover:bg-primary hover:text-primary-foreground",
              "transition-colors",
              "disabled:opacity-50 disabled:cursor-progress",
            )}
            title="Replace the current version with this one. Surfaces as a pending diff for review."
          >
            <ArrowLeftRight className="h-3 w-3" />
            Swap
          </button>
        </div>
      </div>
      {expanded && (
        <pre
          className={cn(
            "mt-2 p-2 rounded border border-border bg-background/60",
            "text-[11px] leading-5 font-mono text-foreground/90",
            "whitespace-pre-wrap break-words max-h-72 overflow-auto",
          )}
        >
          {rev.content || "(empty)"}
        </pre>
      )}
    </li>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Stats
// ────────────────────────────────────────────────────────────────────────

interface ScreenplayStats {
  words: number
  scenes: number
  pages: number
  runtimeMin: number
}

function computeStats(content: string | null): ScreenplayStats {
  if (!content) return { words: 0, scenes: 0, pages: 0, runtimeMin: 0 }
  const words = content.trim().length === 0 ? 0 : content.trim().split(/\s+/).length
  // Fountain scene headings: lines starting INT./EXT./EST./I/E. or "."
  const sceneLines = content
    .split("\n")
    .filter((l) => /^(INT\.|EXT\.|EST\.|I\/E\.|INT\/EXT\.|\.)\b/i.test(l.trim()))
  const scenes = sceneLines.length
  // Industry standard: 1 page ≈ 250 words ≈ 1 minute screen time.
  const pages = words / 250
  const runtimeMin = Math.max(0, Math.round(pages))
  return { words, scenes, pages, runtimeMin }
}

