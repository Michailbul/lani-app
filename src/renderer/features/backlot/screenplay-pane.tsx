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

import { FileText, Eye, Columns, Save, FileEdit, FileQuestion } from "lucide-react"
import { useMemo, useState } from "react"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"

type ViewMode = "editor" | "preview" | "split"

interface ScreenplayPaneProps {
  chatId?: string | null
  directionName?: string | null
}

const VIEW_TABS: { id: ViewMode; label: string; icon: typeof FileText }[] = [
  { id: "editor", label: "Editor", icon: FileEdit },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "split", label: "Split", icon: Columns },
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

  const content = artifact.data?.content ?? null
  const exists = artifact.data?.exists ?? false
  const relativePath = artifact.data?.relativePath ?? "screenplay.fountain"

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

      {/* Surface */}
      <div className="flex-1 min-h-0 overflow-auto">
        {!chatId ? (
          <NoChatState />
        ) : !exists ? (
          <NoArtifactState
            onEnsure={() => chatId && ensure.mutate({ chatId })}
            isEnsuring={ensure.isPending}
          />
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

