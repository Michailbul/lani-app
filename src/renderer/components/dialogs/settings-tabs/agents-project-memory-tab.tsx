import { useEffect, useState } from "react"
import { Check, FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"

/**
 * AgentsProjectMemoryTab — edit the global CLAUDE.md template.
 *
 * Lani keeps one shared CLAUDE.md template at
 * `~/.lani/CLAUDE.template.md`. Every new project's CLAUDE.md is
 * seeded from it; when the template changes, existing projects whose
 * CLAUDE.md is still an untouched scaffold are refreshed to the new
 * version (projects with real memory are left alone).
 */
export function AgentsProjectMemoryTab() {
  const utils = trpc.useUtils()

  const template = trpc.projects.readClaudeMdTemplate.useQuery()

  const save = trpc.projects.writeClaudeMdTemplate.useMutation({
    onSuccess: () => {
      utils.projects.readClaudeMdTemplate.invalidate()
      toast.success("Template saved", {
        description: "New projects use it; untouched ones were refreshed.",
      })
    },
    onError: (err) => toast.error(err.message || "Couldn't save"),
  })

  // Local editable buffer, seeded once from the loaded template.
  const [draft, setDraft] = useState<string | null>(null)
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (seeded) return
    if (template.data) {
      setDraft(template.data.content)
      setSeeded(true)
    }
  }, [template.data, seeded])

  const loaded = template.data?.content ?? null
  const dirty = draft !== null && loaded !== null && draft !== loaded

  const onSave = () => {
    if (draft === null) return
    save.mutate({ content: draft })
  }

  return (
    <div className="flex flex-col h-full min-h-0 w-full max-w-5xl mx-auto p-8 gap-5">
      {/* Header */}
      <div className="flex flex-col space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">
          CLAUDE.md template
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The shared starting point for every project's{" "}
          <code>CLAUDE.md</code> — a project's persistent memory, which the
          agent reads each turn. New projects are seeded from this template;
          when you change it, existing projects whose memory is still an
          untouched scaffold are refreshed. Projects with real memory are
          left alone.
        </p>
      </div>

      {/* Status row */}
      <div className="flex items-center gap-2 py-1">
        <FileText className="h-4 w-4 text-muted-foreground/60 shrink-0" />
        <span className="text-xs text-muted-foreground font-mono">
          ~/.lani/CLAUDE.template.md
        </span>
      </div>

      {/* Editor */}
      <div className="flex flex-col flex-1 min-h-0 gap-2">
        {template.isPending || draft === null ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className={cn(
              "w-full flex-1 min-h-0 resize-none p-4 rounded-lg",
              "bg-muted/40 border border-border",
              "font-mono text-[13.5px] leading-[1.65] text-foreground/90",
              "outline-none focus:border-primary",
              "selection:bg-primary/25 caret-primary",
            )}
            placeholder="# Project memory…"
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
          {dirty ? "Save template" : "Saved"}
        </button>
      </div>
    </div>
  )
}
