/**
 * HarnessEditorModal — in-pane review/approve surface for the agent's
 * `harness_open_editor` MCP tool.
 *
 * The MCP tool writes a focus-request file; HarnessFocusHost picks it
 * up and flips harnessEditorModalOpenAtom. This modal renders over the
 * main edit area so the writer can:
 *
 *   - see a diff of the agent's proposed harness vs. the current one
 *   - edit the proposal inline before accepting
 *   - approve (save) → ~/.lani/harness-prompt.md is written
 *   - cancel / close → nothing changes
 *
 * No navigation away from whatever the writer was doing.
 */

import { useEffect, useMemo, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import { createPatch } from "diff"
import { PatchDiff } from "@pierre/diffs/react"
import { useTheme } from "next-themes"
import { Check, Loader2, Pencil, RotateCcw, X } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
} from "../../components/ui/dialog"
import {
  harnessEditorDraftRequestAtom,
  harnessEditorModalOpenAtom,
} from "../../lib/atoms"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"

type ViewMode = "diff" | "edit"

export function HarnessEditorModal() {
  const [open, setOpen] = useAtom(harnessEditorModalOpenAtom)
  const [draftRequest, setDraftRequest] = useAtom(harnessEditorDraftRequestAtom)
  const harness = trpc.harness.get.useQuery(undefined, { enabled: open })
  const utils = trpc.useUtils()
  const { resolvedTheme } = useTheme()
  const isLight = resolvedTheme !== "dark"

  const [draft, setDraft] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>("diff")

  const effective = harness.data?.effective ?? ""
  const proposed = draftRequest?.proposedContent?.trim() || ""

  // Seed the draft once we have both the current harness and (optionally)
  // a proposed replacement. If the agent supplied proposedContent, that
  // becomes the starting draft; otherwise we open on the current text
  // (the writer can review and edit the existing harness).
  useEffect(() => {
    if (!open) return
    if (draft !== null) return
    if (harness.isPending) return
    setDraft(proposed || effective)
  }, [open, draft, harness.isPending, proposed, effective])

  // Reset internal state every time the modal closes so the next open
  // re-seeds cleanly from a fresh request.
  useEffect(() => {
    if (open) return
    setDraft(null)
    setView("diff")
  }, [open])

  const save = trpc.harness.set.useMutation({
    onSuccess: () => {
      utils.harness.get.invalidate()
      setDraftRequest(null)
      setOpen(false)
      toast.success("Harness saved", {
        description: "Takes effect on the next agent turn.",
      })
    },
    onError: (err) => toast.error(err.message || "Couldn't save"),
  })

  const dirty = draft !== null && draft.trim() !== effective.trim()
  const matchesProposed =
    draft !== null && proposed && draft.trim() === proposed.trim()

  const diffPatch = useMemo(() => {
    if (draft === null) return ""
    if (!dirty) return ""
    return createPatch(
      "harness-prompt.md",
      effective,
      draft,
      "current",
      "proposed",
    )
  }, [draft, effective, dirty])

  const close = () => {
    setOpen(false)
    setDraftRequest(null)
  }

  const onApprove = () => {
    if (draft === null) return
    save.mutate({ content: draft })
  }

  const onResetToProposed = () => {
    if (!proposed) return
    setDraft(proposed)
  }

  const header = draftRequest?.summary || draftRequest?.reason || null

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent
        showCloseButton={false}
        className="w-[min(1100px,calc(100vw-3rem))] h-[min(820px,calc(100vh-3rem))] max-h-[calc(100vh-3rem)] max-w-[calc(100vw-3rem)] p-0 gap-0 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 border-b border-border">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Harness update requested
              </h2>
              <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                review
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              {header ||
                "Review the agent's proposed change to the system prompt before saving."}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="press shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* View toggle */}
        <div className="flex items-center justify-between px-5 py-2 border-b border-border bg-muted/30">
          <div className="inline-flex rounded-md border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => setView("diff")}
              className={cn(
                "press px-2.5 py-1 rounded text-[11px] font-medium transition-colors",
                view === "diff"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Diff
            </button>
            <button
              type="button"
              onClick={() => setView("edit")}
              className={cn(
                "press inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors",
                view === "edit"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {proposed && !matchesProposed && (
              <button
                type="button"
                onClick={onResetToProposed}
                className="press inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-secondary hover:text-foreground"
                title="Reset draft to the agent's proposed content"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to proposed
              </button>
            )}
            {!dirty && (
              <span className="text-muted-foreground/70">
                No changes vs. current harness
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {harness.isPending || draft === null ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
              Loading harness…
            </div>
          ) : view === "edit" ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className={cn(
                "w-full h-full resize-none p-5 bg-background",
                "font-mono text-[13px] leading-[1.6] text-foreground/90",
                "outline-none border-0",
                "selection:bg-primary/25 caret-primary",
              )}
              placeholder="The Lani harness prompt…"
            />
          ) : dirty ? (
            <div className="h-full overflow-auto">
              <PatchDiff
                patch={diffPatch}
                options={{
                  diffStyle: "split",
                  diffIndicators: "classic",
                  themeType: isLight ? "light" : "dark",
                  overflow: "scroll",
                  disableFileHeader: true,
                  expandUnchanged: false,
                }}
              />
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <span>The draft matches the current harness — nothing to apply.</span>
              <button
                type="button"
                onClick={() => setView("edit")}
                className="press inline-flex items-center gap-1 px-2.5 py-1 rounded border border-border bg-background hover:bg-secondary text-foreground"
              >
                <Pencil className="h-3 w-3" />
                Switch to Edit
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border bg-muted/30">
          <span className="text-[11px] text-muted-foreground">
            Saves to <code className="font-mono">~/.lani/harness-prompt.md</code>. Applies on the next agent turn.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={close}
              disabled={save.isPending}
              className={cn(
                "press px-3 py-1.5 rounded-md text-xs font-medium",
                "border border-border bg-background hover:bg-secondary",
                "text-foreground/80 hover:text-foreground",
                "disabled:opacity-40 disabled:pointer-events-none",
              )}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onApprove}
              disabled={!dirty || save.isPending}
              className={cn(
                "press inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium",
                "bg-primary text-primary-foreground",
                "shadow-[0_1px_2px_-1px_rgba(0,0,0,0.15)] hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.18)]",
                "disabled:opacity-50 disabled:pointer-events-none",
              )}
            >
              {save.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Approve &amp; save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
