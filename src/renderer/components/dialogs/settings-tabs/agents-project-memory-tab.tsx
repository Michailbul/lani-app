import { useEffect, useState } from "react"
import { useAtomValue } from "jotai"
import { Check, FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { selectedProjectAtom } from "../../../features/agents/atoms"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"

/**
 * AgentsProjectMemoryTab — view and edit the active project's
 * CLAUDE.md.
 *
 * CLAUDE.md is the project's persistent memory: the agent loads it
 * every turn (via `settingSources: ["project"]`) and updates it as
 * facts solidify. This tab edits that file directly — a settings-side
 * surface for the same file the agent and the main editor also touch.
 * A clean save is checkpointed as a focused git commit.
 */
export function AgentsProjectMemoryTab() {
  const project = useAtomValue(selectedProjectAtom)
  const utils = trpc.useUtils()

  const memory = trpc.projects.readClaudeMd.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  )

  const save = trpc.projects.writeClaudeMd.useMutation({
    onSuccess: () => {
      if (project?.id) {
        utils.projects.readClaudeMd.invalidate({ projectId: project.id })
      }
      toast.success("CLAUDE.md saved", {
        description: "The agent reads it on its next turn.",
      })
    },
    onError: (err) => toast.error(err.message || "Couldn't save"),
  })

  // Local editable buffer. Seeded once per project from the loaded
  // content; a background refetch never clobbers in-progress edits.
  const [draft, setDraft] = useState<string | null>(null)
  const [seededFor, setSeededFor] = useState<string | null>(null)
  useEffect(() => {
    const pid = project?.id ?? null
    if (seededFor === pid) return
    if (!pid) {
      setDraft(null)
      setSeededFor(null)
      return
    }
    if (memory.data) {
      setDraft(memory.data.content)
      setSeededFor(pid)
    } else {
      // New project, content not loaded yet — drop the stale buffer.
      setDraft(null)
    }
  }, [project?.id, memory.data, seededFor])

  if (!project) {
    return (
      <div className="p-6">
        <div className="flex flex-col space-y-1.5">
          <h3 className="text-sm font-semibold text-foreground">
            CLAUDE.md
          </h3>
          <p className="text-xs text-muted-foreground">
            Open a project to view and edit its CLAUDE.md.
          </p>
        </div>
      </div>
    )
  }

  const loaded = memory.data
  const exists = loaded?.exists ?? false
  const dirty = draft !== null && loaded != null && draft !== loaded.content

  const onSave = () => {
    if (draft === null || !project.id) return
    save.mutate({ projectId: project.id, content: draft })
  }

  return (
    <div className="flex flex-col h-full min-h-0 w-full max-w-5xl mx-auto p-8 gap-5">
      {/* Header */}
      <div className="flex flex-col space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">
          CLAUDE.md
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          <code>CLAUDE.md</code> for{" "}
          <strong className="text-foreground">{project.name}</strong> — the
          project's persistent memory. The agent loads it every turn and
          updates it as facts solidify. Edits take effect on the next agent
          turn.
        </p>
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between py-1">
        <div className="flex flex-col space-y-0.5">
          <span className="text-sm font-medium text-foreground">
            {exists ? "CLAUDE.md" : "No CLAUDE.md yet"}
          </span>
          <span className="text-xs text-muted-foreground">
            {exists
              ? "Project root · loaded into every agent session."
              : "Saving will create it at the project root."}
          </span>
        </div>
        <FileText className="h-4 w-4 text-muted-foreground/60 shrink-0" />
      </div>

      {/* Editor */}
      <div className="flex flex-col flex-1 min-h-0 gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            CLAUDE.md
          </span>
        </div>
        {memory.isPending || draft === null ? (
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
            placeholder="# CLAUDE.md…"
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end">
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
