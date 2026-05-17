import { useEffect, useMemo, useState } from "react"
import { Check, Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"

/**
 * AgentsSystemPromptTab — view and edit the Backlot system prompt.
 *
 * The "system prompt" is the Backlot harness block appended to every
 * agent session (see src/main/lib/claude/harness-prompt.ts). It ships
 * with a default; editing here writes ~/.backlot/harness-prompt.md,
 * which buildBacklotHarnessBlock() picks up on the next agent turn —
 * no app restart.
 */
export function AgentsSystemPromptTab() {
  const harness = trpc.harness.get.useQuery()
  const utils = trpc.useUtils()

  const save = trpc.harness.set.useMutation({
    onSuccess: () => {
      utils.harness.get.invalidate()
      toast.success("System prompt saved", {
        description: "Takes effect on the next agent turn.",
      })
    },
    onError: (err) => toast.error(err.message || "Couldn't save"),
  })
  const reset = trpc.harness.reset.useMutation({
    onSuccess: () => {
      utils.harness.get.invalidate()
      toast.success("Reset to the shipped default")
    },
    onError: (err) => toast.error(err.message || "Couldn't reset"),
  })

  // Local editable buffer. Seeded from the effective prompt once the
  // query lands; we don't re-seed on every refetch so the user's
  // in-progress edits survive a background invalidate.
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => {
    if (draft === null && harness.data) {
      setDraft(harness.data.effective)
    }
  }, [harness.data, draft])

  const effective = harness.data?.effective ?? ""
  const defaultText = harness.data?.default ?? ""
  const isCustomized = harness.data?.isCustomized ?? false
  const version = harness.data?.version ?? ""

  const dirty = draft !== null && draft.trim() !== effective.trim()
  // "Matches default" — useful signal so the user knows saving now
  // would be equivalent to a reset.
  const matchesDefault = useMemo(
    () => draft !== null && draft.trim() === defaultText.trim(),
    [draft, defaultText],
  )

  const onSave = () => {
    if (draft === null) return
    save.mutate({ content: draft })
  }
  const onResetToDefault = () => {
    setDraft(defaultText)
    reset.mutate()
  }

  return (
    <div className="flex flex-col h-full min-h-0 w-full max-w-5xl mx-auto p-8 gap-5">
      {/* Header */}
      <div className="flex flex-col space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">System Prompt</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The Backlot harness — appended to every agent session. It tells
          the agent how Backlot projects are structured and how to behave
          (edit files in place, keep chat replies short, Fountain
          conventions). Edits take effect on the next agent turn.
        </p>
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between py-1">
        <div className="flex flex-col space-y-0.5">
          <span className="text-sm font-medium text-foreground">
            {isCustomized ? "Customized" : "Using the shipped default"}
          </span>
          <span className="text-xs text-muted-foreground">
            {isCustomized
              ? "Your edited prompt is active. Reset any time to restore the default."
              : `Default harness v${version}. Edit below to customize.`}
          </span>
        </div>
        <span
          className={cn(
            "shrink-0 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded",
            isCustomized
              ? "bg-primary/15 text-primary"
              : "bg-secondary text-muted-foreground",
          )}
        >
          {isCustomized ? "Custom" : `v${version}`}
        </span>
      </div>

      {/* Editor — boxless, fills the panel */}
      <div className="flex flex-col flex-1 min-h-0 gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            harness-prompt.md
          </span>
          {matchesDefault && (
            <span className="text-[10px] text-muted-foreground/70">
              matches default
            </span>
          )}
        </div>
        {harness.isPending || draft === null ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className={cn(
              "w-full flex-1 min-h-0 resize-none p-0 bg-transparent",
              "font-mono text-[13.5px] leading-[1.65] text-foreground/90",
              "outline-none border-0",
              "selection:bg-primary/25 caret-primary",
            )}
            placeholder="The Backlot harness prompt…"
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onResetToDefault}
          disabled={(!isCustomized && matchesDefault) || reset.isPending}
          className={cn(
            "press flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium",
            "border border-border bg-background hover:bg-secondary",
            "text-foreground/80 hover:text-foreground",
            "transition-colors duration-150",
            "disabled:opacity-40 disabled:pointer-events-none",
          )}
        >
          {reset.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          Reset to default
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || save.isPending}
          className={cn(
            "press flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium",
            "bg-primary text-primary-foreground",
            "shadow-[0_1px_2px_-1px_rgba(0,0,0,0.15)] hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.18)]",
            "transition-[box-shadow] duration-150",
            "disabled:opacity-50 disabled:pointer-events-none",
          )}
        >
          {save.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {dirty ? "Save changes" : "Saved"}
        </button>
      </div>
    </div>
  )
}
