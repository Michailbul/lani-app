"use client"

/**
 * EntityEditor — generic single-file editor for the active entity.
 *
 * In Screenwriting mode this is the center pane for *any* entity that
 * lives as one file on disk: brief, world, main script, character,
 * location, act, AND scenes (their `scene.fountain`) and shots.
 *
 * Prompts mode swaps scenes/shots over to PromptsModeView (script +
 * prompt + refs split); atomic markdown entities still land here in
 * either mode because the prompts surface is scene-specific.
 *
 * Flow (Cursor-style):
 *   1. User clicks an entity in the project tree → activeEntityAtom set
 *   2. This component reads the real file via entities.read
 *   3. User types → debounced autosave to entities.write
 *   4. Agent uses Edit/Write tools on the same path → next poll picks up
 *
 * Save status appears as a tiny indicator in the top-right.
 */

import { useEffect, useRef, useState, useCallback } from "react"
import { useAtomValue } from "jotai"
import {
  BookOpen,
  Camera,
  Check,
  Clapperboard,
  Film,
  FileText,
  GitCompare,
  Globe2,
  Layers,
  Loader2,
  MapPin,
  Undo2,
  User,
} from "lucide-react"
import { toast } from "sonner"
import { MarkdownIcon, CodeIcon } from "../../components/ui/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip"
import { Button } from "../../components/ui/button"
// MarkdownPreview is no longer used here — the editor now mounts a
// SINGLE RichMarkdownEditor that toggles editable on click, instead
// of swapping between two different DOM trees (which caused the
// click-to-edit displacement bug). MarkdownPreview is still exported
// from markdown-preview.tsx for any other callers that need it
// (markdown rendering outside the entity-editor flow).
import { RichMarkdownEditor } from "./rich-markdown-editor"
import { FountainSourceEditor } from "./fountain-source-editor"
import { FountainPreview } from "./fountain-preview"
import { DiffSurface, type DiffHunk, type DiffLine } from "./diff-surface"
import { selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { activeEntityAtom, type ActiveEntity } from "./atoms"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"

const POLL_MS = 5000 // refetch interval — picks up agent-side edits
const AUTOSAVE_DEBOUNCE = 600

/** Two browse modes share the same editor. See ProjectFileTree for the
 * full rationale: chatId → worktree, projectId → canonical project root.
 * Edits in project-mode land directly on the canonical files (no fork). */
type EntityRoot =
  | { chatId: string; projectId?: undefined }
  | { chatId?: undefined; projectId: string }

export function EntityEditor() {
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const active = useAtomValue(activeEntityAtom)

  const entityRoot: EntityRoot | null = chatId
    ? { chatId }
    : selectedProject?.id
      ? { projectId: selectedProject.id }
      : null

  if (!active) {
    return <PlaceholderState />
  }
  if (!entityRoot) {
    return <PlaceholderState message="Pick a project to open files." />
  }
  if (active.kind === "master-script") {
    // The legacy master-script artifact still has its own surface
    // (ScreenplayPane); routing for it lives in ModeAwareCenter.
    return null
  }

  return <ActiveEntityFile entityRoot={entityRoot} active={active} />
}

// ────────────────────────────────────────────────────────────────────────
// Inner — only renders when there's a real entityRoot + entity
// ────────────────────────────────────────────────────────────────────────

function ActiveEntityFile({
  entityRoot,
  active,
}: {
  entityRoot: EntityRoot
  active: NonNullable<ActiveEntity>
}) {
  const path = "path" in active ? active.path : ""
  // chatId is the diff root — only chats have worktrees we can diff
  // against HEAD. In project-mode the diff query stays disabled.
  const chatId = entityRoot.chatId ?? null

  const read = trpc.entities.read.useQuery(
    { ...entityRoot, entityPath: path },
    {
      enabled: !!path,
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
    },
  )
  const write = trpc.entities.write.useMutation()

  const [buffer, setBuffer] = useState<string>("")
  const lastTypedRef = useRef<number>(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  )

  // View mode: rendered preview, rich (TipTap) editor, or source.
  // Markdown files default to "rendered" (typeset, click to edit).
  // Fountain files default to "source" — the styled-source
  // FountainSourceEditor, an always-editable screenplay surface
  // (Courier page, scene caps, dialogue indents). It is the writer's
  // home for a .fountain file; the Code toggle flips to the read-only
  // typeset preview. Per-file (resets on entity change).
  const isFountain =
    active.kind === "scene" ||
    active.kind === "main-script" ||
    (active.kind === "file" && /\.fountain$/i.test(path))
  const isMarkdown =
    active.kind === "brief" ||
    active.kind === "world" ||
    active.kind === "character" ||
    active.kind === "location" ||
    active.kind === "act" ||
    active.kind === "shot" ||
    (active.kind === "file" && /\.(md|markdown|mdx)$/i.test(path))
  const previewable = isMarkdown || isFountain
  type ViewMode = "rendered" | "rich" | "source"
  const [viewMode, setViewMode] = useState<ViewMode>(
    isMarkdown ? "rendered" : "source",
  )
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  // When the active entity changes, reset to the appropriate default.
  // Markdown lands on the typeset preview; fountain and plain files
  // land directly in their editor.
  useEffect(() => {
    setViewMode(isMarkdown ? "rendered" : "source")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // ── Cursor-style diff review ─────────────────────────────────────
  // When the active file has uncommitted changes vs HEAD (whether the
  // agent or the user wrote them), show a diff layer over the editor:
  // a banner with Accept / Revert at the top, and DiffSurface with
  // per-hunk Approve / Dismiss in the body. Toggle to "View file"
  // pulls the user back to the live content if they want to see
  // what they'd be approving.
  //
  // Only meaningful inside a chat — without a chatId there's no
  // worktree to diff against. In project-mode (no chat) the diff
  // query is disabled and the editor renders as before.
  const diff = trpc.paths.diff.useQuery(
    { chatId: chatId ?? "", relPath: path },
    {
      enabled: !!chatId && !!path,
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
    },
  )
  const diffStatus = diff.data?.status ?? "missing"
  const hunks = (diff.data?.hunks ?? []) as DiffHunk[]
  const hasPending = diffStatus === "modified" || diffStatus === "untracked"

  // User can override the auto-show. Defaults to showing the diff
  // whenever there are pending changes; clicking "View file" flips
  // to false. Reset on entity change so each file's default takes
  // over again.
  const [showDiff, setShowDiff] = useState<boolean>(true)
  useEffect(() => {
    setShowDiff(true)
  }, [path])

  const utils = trpc.useUtils()
  const refreshDiff = useCallback(() => {
    if (!chatId) return
    utils.paths.diff.invalidate({ chatId, relPath: path })
    utils.paths.changedFiles.invalidate({ chatId })
    void read.refetch()
  }, [chatId, path, utils, read])

  const acceptFile = trpc.paths.accept.useMutation({
    onSuccess: refreshDiff,
    onError: (err) => toast.error(err.message || "Couldn't accept changes"),
  })
  const rejectFile = trpc.paths.reject.useMutation({
    onSuccess: refreshDiff,
    onError: (err) => toast.error(err.message || "Couldn't revert changes"),
  })

  const [busyHunkIndex, setBusyHunkIndex] = useState<number | null>(null)
  const acceptHunk = trpc.paths.acceptHunk.useMutation({
    onSettled: () => {
      setBusyHunkIndex(null)
      refreshDiff()
    },
    onError: (err) => toast.error(err.message || "Couldn't approve hunk"),
  })
  const rejectHunk = trpc.paths.rejectHunk.useMutation({
    onSettled: () => {
      setBusyHunkIndex(null)
      refreshDiff()
    },
    onError: (err) => toast.error(err.message || "Couldn't dismiss hunk"),
  })
  const onAcceptHunk = (hunkIndex: number) => {
    if (!chatId) return
    setBusyHunkIndex(hunkIndex)
    acceptHunk.mutate({ chatId, relPath: path, hunkIndex })
  }
  const onRejectHunk = (hunkIndex: number) => {
    if (!chatId) return
    setBusyHunkIndex(hunkIndex)
    rejectHunk.mutate({ chatId, relPath: path, hunkIndex })
  }

  // Inline edit-in-diff — click a + or context line in the unified
  // diff, type a replacement, and the whole file is rewritten with
  // that one line swapped. The diff refetch reflects the result.
  // Removed (−) lines can't be edited; the diff offers no per-line
  // restore here, so the user reverts at hunk granularity instead.
  const commitLineEdit = useCallback(
    async (line: DiffLine, newValue: string): Promise<void> => {
      if (newValue === line.text) return
      if (line.newNo == null) {
        toast.error("Can't edit a removed line — approve or dismiss the hunk.")
        return
      }
      const current = read.data?.content ?? buffer
      const lines = current.split("\n")
      const idx = line.newNo - 1
      let targetIdx = -1
      if (idx >= 0 && idx < lines.length && lines[idx] === line.text) {
        targetIdx = idx
      } else {
        targetIdx = lines.findIndex((l) => l === line.text)
      }
      if (targetIdx < 0) {
        toast.error(
          "Couldn't locate that line — it may have shifted. Refresh and retry.",
        )
        return
      }
      lines[targetIdx] = newValue
      const next = lines.join("\n")
      try {
        await write.mutateAsync({
          ...entityRoot,
          entityPath: path,
          content: next,
        })
        setBuffer(next)
        refreshDiff()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't save the edit",
        )
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [read.data?.content, buffer, path, refreshDiff],
  )

  // Pull server content into the buffer when the user is idle. Same idiom
  // as the screenplay editor — don't blow away mid-typing edits.
  useEffect(() => {
    const remote = read.data?.content ?? ""
    if (read.isPending) return
    if (Date.now() - lastTypedRef.current < 1000) return
    if (remote !== buffer) setBuffer(remote)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read.data?.content])

  // Cleanup pending save on entity change.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [path])

  const flush = (next: string) => {
    if (!path) return
    setSaveState("saving")
    write.mutate(
      { ...entityRoot, entityPath: path, content: next },
      {
        onSuccess: () => {
          setSaveState("saved")
          setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1400)
        },
        onError: () => setSaveState("error"),
      },
    )
  }

  const handleBufferChange = useCallback(
    (next: string) => {
      setBuffer(next)
      lastTypedRef.current = Date.now()
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => flush(next), AUTOSAVE_DEBOUNCE)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    handleBufferChange(e.target.value)
  }

  // Click on the rendered preview swaps to rich edit mode — Notion's
  // pattern. Blur flushes any pending save and swaps back to preview.
  // Source mode is reached only via the explicit toggle.
  //
  // Click coords are captured so the rich editor can drop the cursor
  // exactly where the user clicked, instead of jumping to end-of-doc.
  // Cleared when the user blurs back to preview so the next entry
  // starts fresh.
  //
  // Fountain entities default straight into their styled-source
  // editor, so this click-to-edit path only fires for them when the
  // user has toggled to the typeset preview and clicks back in.
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(
    null,
  )
  const handleEnterEdit = useCallback(
    (e?: { clientX: number; clientY: number }) => {
      if (!previewable) return
      if (e && typeof e.clientX === "number" && typeof e.clientY === "number") {
        setFocusPoint({ x: e.clientX, y: e.clientY })
      } else {
        setFocusPoint(null)
      }
      setViewMode(isMarkdown ? "rich" : "source")
    },
    [isMarkdown, previewable],
  )

  const handleEditorBlur = useCallback(() => {
    // Flush any debounced save immediately so the preview shows what
    // disk has — the rendered view should never lag the buffer.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      flush(buffer)
    }
    // Markdown follows the Notion pattern — blur returns to the typeset
    // preview. Fountain does NOT: its styled-source editor IS the home
    // surface, so blurring just flushes the save and stays put. The
    // typeset preview is reached only via the explicit Code toggle.
    if (isMarkdown) setViewMode("rendered")
    // Reset the click anchor so the next click-to-edit is what
    // determines cursor placement (not a stale coordinate).
    setFocusPoint(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMarkdown, buffer])

  // Toggle between "rendered/rich" and "source". For markdown files
  // we cycle: rendered → source (raw) → rendered. Rich edit is reached
  // by clicking on the rendered preview body, not by this toggle.
  // For fountain files: rendered (typeset page) → source (raw fountain
  // textarea) → rendered.
  const handleToggleViewMode = useCallback(() => {
    if (!previewable) return
    setViewMode((m) => {
      if (m === "source") {
        // Leaving source — flush + go back to rendered preview.
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
          flush(buffer)
        }
        return "rendered"
      }
      // Otherwise (rendered or rich) — drop into source.
      setTimeout(() => editorTextareaRef.current?.focus(), 0)
      return "source"
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewable, buffer])

  const label = "label" in active ? active.label : "Untitled"

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header — editorial masthead. Kicker (mono caps) + display
          headline. Right side: save state + path in mono. The hairline
          rule is left-anchored Coral, like an editor's margin mark. */}
      <header className="relative shrink-0 px-10 pt-7 pb-5 bg-background">
        <div className="flex items-end justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-[14px] h-[1px] bg-primary"
                aria-hidden
              />
              <span
                className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/75"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {kindLabel(active.kind)}
              </span>
            </div>
            <h1
              className="mt-2 text-[34px] leading-[1.05] tracking-[-0.012em] text-foreground truncate"
              style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
              title={label}
            >
              {label}
            </h1>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0 pb-1">
            <div className="flex items-center gap-2">
              <SaveIndicator state={saveState} />
              {previewable && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleToggleViewMode}
                      className="h-6 w-6 p-0 hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                      aria-label={
                        viewMode === "source"
                          ? isFountain
                            ? "Preview screenplay"
                            : "Preview markdown"
                          : isFountain
                            ? "Edit screenplay"
                            : "Edit raw markdown"
                      }
                    >
                      <div className="relative w-4 h-4">
                        <MarkdownIcon
                          className={cn(
                            "absolute inset-0 w-4 h-4 transition-[opacity,transform] duration-200 ease-out",
                            viewMode !== "source"
                              ? "opacity-100 scale-100"
                              : "opacity-0 scale-75",
                          )}
                        />
                        <CodeIcon
                          className={cn(
                            "absolute inset-0 w-4 h-4 transition-[opacity,transform] duration-200 ease-out",
                            viewMode === "source"
                              ? "opacity-100 scale-100"
                              : "opacity-0 scale-75",
                          )}
                        />
                      </div>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {viewMode === "source"
                      ? isFountain
                        ? "Preview screenplay"
                        : "Preview markdown"
                      : isFountain
                        ? "Edit screenplay"
                        : "Edit raw markdown"}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <span
              className="text-[10px] tracking-tight text-muted-foreground/55 truncate max-w-[320px]"
              style={{ fontFamily: "var(--font-mono)" }}
              title={path}
            >
              {path}
            </span>
          </div>
        </div>
        <div className="mt-5 h-px bg-border/70" />
      </header>

      {/* Pending-changes banner — when the active file differs from
          HEAD (whether the agent or the user wrote them), surface a
          Cursor-style review bar with file-level Accept/Revert and a
          "View file"/"View diff" toggle. Per-hunk approve/dismiss
          lives inside the DiffSurface body below. */}
      {hasPending && (
        <div
          className={cn(
            "shrink-0 flex items-center justify-between px-6 py-2 border-b border-border",
            "bg-primary/10",
          )}
        >
          <div className="flex items-center gap-2 text-xs text-foreground min-w-0">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
            <span className="font-medium shrink-0">
              {diffStatus === "untracked"
                ? "New file from the agent."
                : "Pending changes."}
            </span>
            <span className="text-muted-foreground truncate">
              Approve hunks below — or accept the whole file / revert.
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowDiff((v) => !v)}
              className={cn(
                "press flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium",
                "border border-border bg-background hover:bg-secondary",
                "text-foreground/80 hover:text-foreground",
                "transition-[color,background-color] duration-150",
              )}
              title={showDiff ? "Show the working file" : "Show the diff"}
            >
              <GitCompare className="h-3 w-3" />
              {showDiff ? "View file" : "View diff"}
            </button>
            <button
              type="button"
              onClick={() => chatId && rejectFile.mutate({ chatId, relPath: path })}
              disabled={rejectFile.isPending || acceptFile.isPending}
              className={cn(
                "press flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium",
                "border border-border bg-background hover:bg-secondary",
                "text-foreground/80 hover:text-foreground",
                "transition-[color,background-color] duration-150",
                "disabled:opacity-50 disabled:cursor-progress disabled:active:scale-100",
              )}
            >
              <Undo2 className="h-3 w-3" />
              Revert
            </button>
            <button
              type="button"
              onClick={() => chatId && acceptFile.mutate({ chatId, relPath: path })}
              disabled={acceptFile.isPending || rejectFile.isPending}
              className={cn(
                "press flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium",
                "bg-primary text-primary-foreground",
                "shadow-[0_1px_2px_-1px_rgba(0,0,0,0.15)] hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.18)]",
                "transition-[box-shadow] duration-150 [transition-timing-function:var(--ease-out)]",
                "disabled:opacity-50 disabled:cursor-progress disabled:active:scale-100",
              )}
            >
              <Check className="h-3 w-3" />
              Accept
            </button>
          </div>
        </div>
      )}

      {/* Body — manuscript surface. Constrained max-width so the writer's
          eye doesn't have to track edge-to-edge across a 27" display. */}
      <div className="flex-1 min-h-0 overflow-auto">
        {hasPending && showDiff ? (
          <DiffSurface
            hunks={hunks}
            perHunkEnabled={diffStatus === "modified"}
            onAcceptHunk={onAcceptHunk}
            onRejectHunk={onRejectHunk}
            busyHunkIndex={busyHunkIndex}
            perLineEnabled={diffStatus === "modified"}
            onCommitLineEdit={commitLineEdit}
          />
        ) : read.isPending ? (
          <div className="px-10 py-12">
            <div className="max-w-[720px] mx-auto">
              <span
                className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/55"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Loading…
              </span>
            </div>
          </div>
        ) : !read.data?.exists ? (
          <NotYetCreatedState
            path={path}
            onCreate={() => flush(buildTemplate(active))}
          />
        ) : isFountain ? (
          // Screenplay surface. "source" → the always-editable
          // styled-source FountainSourceEditor (Courier page, scene
          // caps, dialogue indents) — the writer's home for a
          // .fountain file. Typing into it never changes how the page
          // looks. "rendered" → the read-only typeset preview, reached
          // via the Code toggle; clicking it drops back into the
          // editor near the click point.
          viewMode === "rendered" ? (
            <div
              role="button"
              tabIndex={0}
              onClick={(e) =>
                handleEnterEdit({ clientX: e.clientX, clientY: e.clientY })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  handleEnterEdit()
                }
              }}
              className={cn(
                "w-full h-full pt-3 cursor-text",
                "transition-[background-color] duration-150",
                "hover:bg-foreground/[0.012] dark:hover:bg-foreground/[0.02]",
                "focus:outline-none focus-visible:bg-foreground/[0.02]",
              )}
              aria-label="Edit screenplay"
            >
              <FountainPreview source={buffer} />
            </div>
          ) : (
            <FountainSourceEditor
              value={buffer}
              onChange={handleBufferChange}
              onBlur={handleEditorBlur}
              autoFocus={!!focusPoint}
              focusPoint={focusPoint}
            />
          )
        ) : isMarkdown && viewMode !== "source" ? (
          // Markdown rendered + rich edit — handled by a SINGLE
          // always-mounted RichMarkdownEditor. We toggle the editor's
          // `editable` flag on click. This is what fixes the
          // click-to-edit displacement bug: the DOM tree is identical
          // in both modes, only the ProseMirror editable state
          // changes, so the page can't shift on the swap.
          //
          // The wrapper handles the click-to-edit gesture when in
          // rendered mode. When already in rich mode, the wrapper
          // becomes a passthrough — TipTap owns the cursor.
          <div
            role={viewMode === "rendered" ? "button" : undefined}
            tabIndex={viewMode === "rendered" ? 0 : undefined}
            onClick={
              viewMode === "rendered"
                ? (e) => {
                    handleEnterEdit({
                      clientX: e.clientX,
                      clientY: e.clientY,
                    })
                  }
                : undefined
            }
            onKeyDown={
              viewMode === "rendered"
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      handleEnterEdit()
                    }
                  }
                : undefined
            }
            className={cn(
              "w-full h-full pt-3",
              viewMode === "rendered" && [
                "cursor-text",
                "transition-[background-color] duration-150",
                "hover:bg-foreground/[0.012] dark:hover:bg-foreground/[0.02]",
                "focus:outline-none focus-visible:bg-foreground/[0.02]",
              ],
            )}
            aria-label="Edit markdown"
          >
            <RichMarkdownEditor
              value={buffer}
              editable={viewMode === "rich"}
              onChange={handleBufferChange}
              onBlur={handleEditorBlur}
              autoFocus={viewMode === "rich"}
              focusPoint={focusPoint}
            />
          </div>
        ) : (
          // Raw textarea — plain non-previewable files, plus markdown
          // in source mode (reached via the Code/MD toggle for editing
          // frontmatter or hand-tuning markup). Fountain never lands
          // here; it has its own styled-source editor above.
          <div className="w-full h-full pb-24">
            <textarea
              ref={editorTextareaRef}
              value={buffer}
              onChange={onChange}
              onBlur={isMarkdown ? handleEditorBlur : undefined}
              spellCheck
              className={cn(
                "block w-full max-w-[760px] mx-auto h-full min-h-full",
                "px-10 pt-3 bg-transparent",
                "border-0 outline-none resize-none",
                "text-foreground/90 selection:bg-primary/25 caret-primary",
                "text-[13px] leading-[1.7]",
              )}
              style={{
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// States
// ────────────────────────────────────────────────────────────────────────

function PlaceholderState({
  message = "Pick something from the project tree to start editing.",
}: {
  message?: string
}) {
  return (
    <div className="flex h-full items-center justify-center px-10">
      <div className="text-center max-w-[420px]">
        <span
          className="block text-[10px] uppercase tracking-[0.24em] text-muted-foreground/55 mb-4"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Empty surface
        </span>
        <p
          className="text-[20px] leading-[1.3] text-foreground/70"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          {message}
        </p>
      </div>
    </div>
  )
}

function NotYetCreatedState({
  path,
  onCreate,
}: {
  path: string
  onCreate: () => void
}) {
  return (
    <div className="flex h-full items-start justify-center px-10 pt-16">
      <div className="text-left max-w-[520px] w-full">
        <span
          className="block text-[10px] uppercase tracking-[0.24em] text-muted-foreground/55 mb-3"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Not yet written
        </span>
        <p
          className="text-[24px] leading-[1.2] text-foreground/85 mb-5"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          This file doesn't exist on disk yet — start it from a template,
          or let the agent draft it.
        </p>
        <div className="flex items-baseline gap-3 mb-7">
          <span
            className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/55"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Path
          </span>
          <span
            className="text-[11px] text-muted-foreground/80 truncate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {path}
          </span>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className={cn(
            // Typographic CTA — matches the editorial empty-state register
            // (display kicker + display sentence above) instead of a chunky
            // filled button. Coral hairline under the label tightens to a
            // full Coral text colour on hover. `.press` (from the animation
            // pass) gives it the same interactive feedback as every other
            // button in the app.
            "press group inline-flex items-baseline gap-2 px-0 py-1",
            "text-[13px] tracking-[0.02em] text-foreground",
            "border-b border-primary hover:text-primary",
          )}
          style={{ fontFamily: "var(--font-body)", fontWeight: 500 }}
        >
          <span>Create starter</span>
          <span
            className="text-[10px] tracking-[0.22em] uppercase text-muted-foreground/60 group-hover:text-primary/80 transition-colors"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            ↵
          </span>
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function KindIcon({ kind }: { kind: NonNullable<ActiveEntity>["kind"] }) {
  const cls = "h-4 w-4 text-primary/80 shrink-0"
  if (kind === "brief") return <BookOpen className={cls} />
  if (kind === "world") return <Globe2 className={cls} />
  if (kind === "main-script") return <Clapperboard className={cls} />
  if (kind === "character") return <User className={cls} />
  if (kind === "location") return <MapPin className={cls} />
  if (kind === "act") return <Layers className={cls} />
  if (kind === "scene") return <Film className={cls} />
  if (kind === "shot") return <Camera className={cls} />
  if (kind === "file") return <FileText className={cls} />
  return <FileText className={cls} />
}

function kindLabel(kind: NonNullable<ActiveEntity>["kind"]) {
  switch (kind) {
    case "brief":
      return "Project brief"
    case "world":
      return "World bible"
    case "main-script":
      return "Main script"
    case "character":
      return "Character"
    case "location":
      return "Location"
    case "act":
      return "Act"
    case "scene":
      return "Scene"
    case "shot":
      return "Shot"
    case "master-script":
      return "Master script"
    case "file":
      return "File"
    default:
      return "File"
  }
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  // Idle: a quiet dot — present so the chrome doesn't jump when state
  // transitions in. Active states swap the dot for status type.
  const baseCls =
    "flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em]"
  const fontStyle = { fontFamily: "var(--font-mono)" } as const

  if (state === "idle") {
    return (
      <span
        className={cn(baseCls, "text-muted-foreground/45")}
        style={fontStyle}
      >
        <span className="inline-block w-[5px] h-[5px] rounded-full bg-muted-foreground/30" />
        Saved
      </span>
    )
  }
  if (state === "saving") {
    return (
      <span
        className={cn(baseCls, "text-muted-foreground")}
        style={fontStyle}
      >
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        Saving
      </span>
    )
  }
  if (state === "saved") {
    return (
      <span
        className={cn(baseCls, "text-primary/85")}
        style={fontStyle}
      >
        <Check className="h-2.5 w-2.5" />
        Saved
      </span>
    )
  }
  return (
    <span
      className={cn(baseCls, "text-rose-500/90 dark:text-rose-400/90")}
      style={fontStyle}
    >
      <span className="inline-block w-[5px] h-[5px] rounded-full bg-rose-500/80" />
      Save failed
    </span>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Templates — written when user clicks "Create starter" on a missing file
// ────────────────────────────────────────────────────────────────────────

function buildTemplate(active: NonNullable<ActiveEntity>): string {
  switch (active.kind) {
    case "brief":
      return `# Project Brief

## Logline

(One sentence — what's the story, in twenty words or less?)

## Short description

(A paragraph or two. The pitch you'd give to a producer.)

## Style

(Visual / tonal direction. References, mood, what this should *feel*
like. The agent uses this when composing prompts.)
`
    case "main-script":
      return `Title: Untitled
Credit: Written by
Author:

FADE IN:

# Act I

EXT. — — DAY

`
    case "act":
      return `# ${"label" in active ? active.label : "Act"}

## Logline

(One-sentence summary of this act's beat.)

## Beats

- (key story moment 1)
- (key story moment 2)
- (key story moment 3)
`
    case "world":
      return `# World Bible

The art-direction spine of this project. Every prompt eventually
references this — palette, era, lens choices, tone, technology level,
visual references.

## Tone

(How does this world *feel*? One paragraph.)

## Visual palette

(Colours, lighting style, material qualities. Reference film stills
if useful.)

## Era + technology

(When + what level of tech?)

## Lens / camera language

(Anamorphic, handheld, locked-off? Default focal length feel?)

## Visual references

(Drag images or reference filenames inside this project.)
`
    case "character":
      return `# ${"label" in active ? active.label : "Character"}

The lock for this character — the canonical description that every
prompt referencing them pastes verbatim.

## Identity

(Age, build, distinguishing features. Lock the visual so the model
returns the same person across all prompts.)

## Voice + personality

(How they speak. What they want. What they hide.)

## Wardrobe

(Default outfit, variations per scene if any.)

## Reference images

(Filenames inside assets/refs/, or leave blank for now.)
`
    case "location":
      return `# ${"label" in active ? active.label : "Location"}

Reference card for this place.

## Description

(Where is it? What does it look like? One paragraph.)

## Time of day variants

(Dawn / day / dusk / night — different prompts likely need different versions.)

## Lighting setup

(Key light direction, intensity, colour temperature, atmosphere.)

## Reference images

(Filenames inside assets/refs/, or leave blank.)
`
    case "scene": {
      const label = "label" in active ? active.label : "Scene"
      const heading = label.toUpperCase()
      return `INT. ${heading} - DAY

(Action — what happens in this scene.)

`
    }
    case "shot":
      return `# ${"label" in active ? active.label : "Shot"}

## Frame

(What's in the frame? Composition, subject, action.)

## Camera

(Lens, movement, angle, distance.)

## Light

(Source, direction, quality, temperature.)

## Notes

(Anything else the model needs.)
`
    default:
      return `# ${"label" in active ? active.label : "Untitled"}\n\n`
  }
}
