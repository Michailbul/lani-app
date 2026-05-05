"use client"

/**
 * ScreenplayPane — Backlot's center surface.
 *
 * v1 is a polished placeholder. The real CodeMirror Fountain editor +
 * afterwriting preview lands in Phase D2/D3 (see PLAN.md). The shape
 * the placeholder demonstrates is the shape the editor will live in:
 *
 *   ┌─ Slug bar ─────────────────────────────────────────────┐
 *   │  Direction name · artifact filename                    │
 *   ├─ Toolbar ──────────────────────────────────────────────┤
 *   │  [ Editor | Preview | Split ]   pages · runtime · save │
 *   ├─ Surface ──────────────────────────────────────────────┤
 *   │                                                        │
 *   │   (Fountain editor goes here — Phase D2)               │
 *   │                                                        │
 *   ├─ Footer ───────────────────────────────────────────────┤
 *   │  word count · scene count · last saved                 │
 *   └────────────────────────────────────────────────────────┘
 */

import { FileText, Eye, Columns, Save, FileEdit } from "lucide-react"
import { useState } from "react"
import { cn } from "../../lib/utils"

type ViewMode = "editor" | "preview" | "split"

interface ScreenplayPaneProps {
  directionName?: string | null
  artifactPath?: string | null
}

const VIEW_TABS: { id: ViewMode; label: string; icon: typeof FileText }[] = [
  { id: "editor", label: "Editor", icon: FileEdit },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "split", label: "Split", icon: Columns },
]

export function ScreenplayPane({ directionName, artifactPath }: ScreenplayPaneProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("editor")

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      {/* Slug bar */}
      <div className="flex items-center justify-between h-9 px-4 border-b border-border bg-card/40 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground/80 truncate">
            {directionName ?? "No direction"}
          </span>
          {artifactPath && (
            <>
              <span className="text-muted-foreground/50 text-xs">·</span>
              <span className="text-xs text-muted-foreground truncate font-mono">
                {artifactPath}
              </span>
            </>
          )}
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
          <span>0 pages</span>
          <span className="text-muted-foreground/40">·</span>
          <span>~0 min</span>
          <button
            disabled
            className={cn(
              "ml-2 flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium",
              "bg-secondary text-muted-foreground/50 cursor-not-allowed",
            )}
          >
            <Save className="h-3 w-3" />
            Save
          </button>
        </div>
      </div>

      {/* Surface */}
      <div className="flex-1 min-h-0 overflow-auto">
        {viewMode === "editor" && <EditorEmptyState />}
        {viewMode === "preview" && <PreviewEmptyState />}
        {viewMode === "split" && (
          <div className="grid grid-cols-2 h-full">
            <div className="border-r border-border">
              <EditorEmptyState />
            </div>
            <PreviewEmptyState />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between h-7 px-4 border-t border-border bg-card/40 select-none">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70 font-mono tabular-nums uppercase tracking-wider">
          <span>0 words</span>
          <span className="text-muted-foreground/40">·</span>
          <span>0 scenes</span>
        </div>
        <div className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider">
          Fountain
        </div>
      </div>
    </div>
  )
}

function EditorEmptyState() {
  return (
    <div className="h-full flex items-center justify-center px-8">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-secondary/60 border border-border/60 flex items-center justify-center">
          <FileEdit className="h-5 w-5 text-muted-foreground" />
        </div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          The page is yours.
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The screenplay editor lands next. Start a new direction in the
          sidebar, or ask the assistant on the right to draft a scene — it
          will edit this page in place once the Fountain pipeline is wired.
        </p>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50 font-mono pt-2">
          Phase&nbsp;D · CodeMirror&nbsp;6 + Fountain
        </div>
      </div>
    </div>
  )
}

function PreviewEmptyState() {
  return (
    <div className="h-full flex items-center justify-center px-8 bg-secondary/20">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-secondary/60 border border-border/60 flex items-center justify-center">
          <Eye className="h-5 w-5 text-muted-foreground" />
        </div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Preview waiting on a script.
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Live screenplay rendering — formatted scene headings, action,
          character lines, dialogue — appears here as soon as the editor
          has content. Renderer: <code className="text-xs font-mono">afterwriting-labs</code>.
        </p>
      </div>
    </div>
  )
}
