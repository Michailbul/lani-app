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
  Check,
  Columns,
  Eye,
  FileEdit,
  FileQuestion,
  FileText,
  History,
  RotateCcw,
  Save,
  Undo2,
  X,
} from "lucide-react"
import { useMemo, useState } from "react"
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
  // diff gets a hover-revealed × button. Server synthesises a 1-line
  // --unidiff-zero patch and applies it --reverse; other lines stay
  // pending so the user can review them next.
  const dismissLine = trpc.artifacts.dismissLine.useMutation({
    onSettled: refreshAll,
  })
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

  const content = artifact.data?.content ?? null
  const exists = artifact.data?.exists ?? false
  const relativePath = artifact.data?.relativePath ?? "screenplay.fountain"

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

      {/* Surface */}
      <div className="flex-1 min-h-0 overflow-auto">
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
            />
          )
        ) : viewMode === "preview" ? (
          <PreviewSurface content={content} />
        ) : viewMode === "split" ? (
          <div className="grid grid-cols-2 h-full">
            <div className="border-r border-border min-h-0 overflow-auto">
              <EditorSurface content={content} />
            </div>
            <div className="min-h-0 overflow-auto">
              <PreviewSurface content={content} />
            </div>
          </div>
        ) : (
          <EditorSurface content={content} />
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

function EditorSurface({ content }: { content: string | null }) {
  if (!content || content.trim().length === 0) {
    return <BlankCanvas />
  }
  return (
    <div className="h-full flex justify-center">
      <pre
        className={cn(
          "w-full max-w-[820px] mx-auto px-10 py-12",
          "font-mono text-sm leading-7 text-foreground/90",
          "whitespace-pre-wrap break-words",
          "select-text",
        )}
      >
        {content}
      </pre>
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
}

function DiffSurface({
  hunks,
  perHunkEnabled,
  onAcceptHunk,
  onRejectHunk,
  busyHunkIndex,
  perLineEnabled,
  onDismissLine,
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
                      key={li}
                      line={line}
                      onDismiss={
                        perLineEnabled && line.kind !== "ctx"
                          ? () => onDismissLine(line)
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
}: {
  line: DiffLine
  onDismiss?: () => void
}) {
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
      <td className={cn("pr-4 align-top whitespace-pre-wrap break-words", textColor)}>
        {line.text || " "}
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
              "opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity",
              "flex items-center justify-center w-5 h-5 rounded",
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

