"use client"

/**
 * ShotPromptsSurface — the per-shot prompts view, rendered inside the
 * screenplay center pane when `activeEntity.kind === "shot"`.
 *
 * Two layouts toggle in the header:
 *   - LIST   — dense table-style rows, text-forward, generation a tiny ✓
 *   - CARDS  — compact tiles, 3 per row, no hero thumb (a 32×32 corner
 *              indicator only when a generation exists)
 *
 * Selection opens a side detail drawer inside this surface (does NOT
 * push the chat rail or anything else around). The drawer holds the
 * full prompt editor — title, type, status, body, refs, tiny
 * generation, iterate/compose/generate buttons.
 *
 * V1 uses MOCK_PROMPTS so we can iterate on the UI without a backend.
 * E1.9 wires this to real `<shot>/prompts/v*.md` files.
 */

import { useState } from "react"
import {
  ArrowLeftRight,
  Check,
  ChevronRight,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Plus,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react"
import { cn } from "../../lib/utils"

// ────────────────────────────────────────────────────────────────────────
// Mock data — replaced by real `entities.read` calls in E1.9
// ────────────────────────────────────────────────────────────────────────

type PromptType = "keyframe" | "multi-shot" | "start-end-frame" | "workflow"
type PromptStatus = "draft" | "generated" | "approved" | "archived"

interface MockPrompt {
  id: string
  title: string
  type: PromptType
  status: PromptStatus
  parent: string | null
  body: string
  hasGeneration: boolean
  references: number
  iterations: number
}

const MOCK_PROMPTS: MockPrompt[] = [
  {
    id: "v1-wide-establishing",
    title: "Wide establishing — warm dawn",
    type: "keyframe",
    status: "approved",
    parent: null,
    body:
      "A wide establishing shot of an empty forest road at dawn. Warm amber light grazes the asphalt, mist hugs the treeline, anamorphic flare on the horizon. 35mm film stock feel, slight grain.",
    hasGeneration: true,
    references: 3,
    iterations: 2,
  },
  {
    id: "v2-warmer-light",
    title: "Wide — warmer light, lower angle",
    type: "keyframe",
    status: "generated",
    parent: "v1-wide-establishing",
    body:
      "Same composition, lower camera angle (almost ground level). Push the warmth — golden hour at peak. The road stretches into a vanishing point lit gold.",
    hasGeneration: true,
    references: 2,
    iterations: 1,
  },
  {
    id: "v3-medium-pushed-in",
    title: "Medium — pushed-in version",
    type: "keyframe",
    status: "draft",
    parent: "v2-warmer-light",
    body:
      "Medium shot. Tighter framing, asphalt textured detail in foreground, treeline blurred. Cooler grade — feels uncertain rather than romantic.",
    hasGeneration: false,
    references: 1,
    iterations: 0,
  },
  {
    id: "v1-dolly-tracking",
    title: "Multi-shot — dolly tracking through the road",
    type: "multi-shot",
    status: "generated",
    parent: null,
    body:
      "Shot 1 (3s): static wide. Shot 2 (4s): dolly forward, cars enter frame. Shot 3 (3s): cars pass camera, mist disturbed. Continuity: amber light constant.",
    hasGeneration: true,
    references: 4,
    iterations: 0,
  },
  {
    id: "v2-handheld-energy",
    title: "Multi-shot — handheld, more kinetic",
    type: "multi-shot",
    status: "draft",
    parent: "v1-dolly-tracking",
    body:
      "Same beats but handheld. Slight breathing in the camera. Less precious, more documentary feel. Cars enter on a frame disrupt.",
    hasGeneration: false,
    references: 2,
    iterations: 0,
  },
  {
    id: "v1-color-grade",
    title: "Workflow — color grade transfer template",
    type: "workflow",
    status: "approved",
    parent: null,
    body:
      "Reusable template: extract LUT from reference still, apply to shot. Use this whenever a generated frame needs grade-matching to a reference.",
    hasGeneration: false,
    references: 0,
    iterations: 3,
  },
]

// ────────────────────────────────────────────────────────────────────────
// Tokens
// ────────────────────────────────────────────────────────────────────────

const TYPE_ABBR: Record<PromptType, string> = {
  keyframe: "KEY",
  "multi-shot": "MULTI",
  "start-end-frame": "S/E",
  workflow: "WF",
}

const TYPE_COLORS: Record<PromptType, string> = {
  keyframe: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  "multi-shot": "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  "start-end-frame": "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  workflow: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
}

const STATUS_DOT: Record<PromptStatus, string> = {
  draft: "bg-muted-foreground/40",
  generated: "bg-amber-500",
  approved: "bg-emerald-500",
  archived: "bg-muted-foreground/20",
}

// ────────────────────────────────────────────────────────────────────────
// Surface
// ────────────────────────────────────────────────────────────────────────

export interface ShotPromptsSurfaceProps {
  shotLabel: string
  shotPath: string
  /** When true, renders the demo banner — temporary while real prompt files don't exist yet. */
  isDemoMode?: boolean
}

export function ShotPromptsSurface({
  shotLabel,
  shotPath,
  isDemoMode = false,
}: ShotPromptsSurfaceProps) {
  const [layout, setLayout] = useState<"list" | "cards">("list")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = selectedId
    ? MOCK_PROMPTS.find((p) => p.id === selectedId) ?? null
    : null

  return (
    <div className="flex h-full">
      {/* Main browsable area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <Header
          shotLabel={shotLabel}
          shotPath={shotPath}
          layout={layout}
          onLayoutChange={setLayout}
          isDemoMode={isDemoMode}
        />
        <div className="flex-1 min-h-0 overflow-auto">
          {layout === "list" ? (
            <ListLayout
              prompts={MOCK_PROMPTS}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <CardsLayout
              prompts={MOCK_PROMPTS}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>
      </div>

      {/* Detail drawer */}
      {selected && (
        <PromptDetailDrawer
          prompt={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Header
// ────────────────────────────────────────────────────────────────────────

interface HeaderProps {
  shotLabel: string
  shotPath: string
  layout: "list" | "cards"
  onLayoutChange: (next: "list" | "cards") => void
  isDemoMode: boolean
}

function Header({
  shotLabel,
  shotPath,
  layout,
  onLayoutChange,
  isDemoMode,
}: HeaderProps) {
  return (
    <>
      {/* Slug + actions */}
      <div className="flex items-center justify-between gap-3 h-11 px-4 border-b border-border bg-card/40 select-none shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
            Prompts
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-sm font-medium text-foreground truncate">
            {shotLabel}
          </span>
          <span className="text-[10px] text-muted-foreground/50 font-mono truncate">
            {shotPath}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Layout toggle */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-secondary/60 border border-border/50">
            <button
              type="button"
              onClick={() => onLayoutChange("list")}
              className={cn(
                "press flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-[color,background-color,box-shadow] duration-200 [transition-timing-function:var(--ease-natural)]",
                layout === "list"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground/80",
              )}
            >
              <List className="h-3 w-3" />
              List
            </button>
            <button
              type="button"
              onClick={() => onLayoutChange("cards")}
              className={cn(
                "press flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-[color,background-color,box-shadow] duration-200 [transition-timing-function:var(--ease-natural)]",
                layout === "cards"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground/80",
              )}
            >
              <LayoutGrid className="h-3 w-3" />
              Cards
            </button>
          </div>
          <button
            type="button"
            className={cn(
              "press flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium",
              "bg-primary text-primary-foreground",
              "shadow-[0_1px_2px_-1px_rgba(0,0,0,0.15)] hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.18)]",
              "transition-[box-shadow] duration-150 [transition-timing-function:var(--ease-out)]",
            )}
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>
      </div>

      {/* Demo banner */}
      {isDemoMode && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-amber-500/10 text-[11px] text-foreground/80">
          <Sparkles className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          <span>
            <strong className="font-medium">Demo mode</strong> — these
            prompts are mock data so you can compare layouts. Real prompts
            come from <code className="font-mono">scenes/&lt;id&gt;/shots/&lt;shot&gt;/prompts/*.md</code>
            once E1.9 wires the file backend.
          </span>
        </div>
      )}
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────
// List layout — dense rows, text-forward
// ────────────────────────────────────────────────────────────────────────

interface ListLayoutProps {
  prompts: MockPrompt[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function ListLayout({ prompts, selectedId, onSelect }: ListLayoutProps) {
  return (
    <div className="divide-y divide-border">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-1.5 bg-card/30 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70 font-mono sticky top-0 z-10">
        <div className="w-12 shrink-0">Type</div>
        <div className="flex-1 min-w-0">Title · body</div>
        <div className="w-24 shrink-0">Lineage</div>
        <div className="w-20 shrink-0">Status</div>
        <div className="w-12 shrink-0 text-center">Gen</div>
      </div>

      {prompts.map((p) => {
        const isSelected = p.id === selectedId
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className={cn(
              "press w-full flex items-center gap-3 px-4 py-2 text-left group",
              "transition-[background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
              isSelected
                ? "bg-primary/10"
                : "hover:bg-secondary/40",
            )}
          >
            {/* Type */}
            <div className="w-12 shrink-0">
              <span
                className={cn(
                  "inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold tracking-wider",
                  TYPE_COLORS[p.type],
                )}
              >
                {TYPE_ABBR[p.type]}
              </span>
            </div>

            {/* Title + body preview on second line */}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-foreground truncate">
                {p.title}
              </div>
              <div className="text-[11px] text-muted-foreground/80 font-mono truncate">
                {p.body}
              </div>
            </div>

            {/* Parent / lineage */}
            <div className="w-24 shrink-0 text-[10px] font-mono text-muted-foreground/70 truncate">
              {p.parent ? (
                <span title={`Iteration of ${p.parent}`}>↳ {p.parent.replace(/^v\d+-/, "")}</span>
              ) : (
                <span className="text-muted-foreground/40">root</span>
              )}
            </div>

            {/* Status pill */}
            <div className="w-20 shrink-0">
              <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span
                  className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[p.status])}
                />
                {p.status}
              </span>
            </div>

            {/* Tiny generation indicator (the small bit, not a hero thumb) */}
            <div className="w-12 shrink-0 flex justify-center">
              {p.hasGeneration ? (
                <span
                  className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-mono"
                  title="Generation available"
                >
                  <ImageIcon className="h-3 w-3" />
                  <Check className="h-2.5 w-2.5" />
                </span>
              ) : (
                <span className="text-muted-foreground/30 text-[10px] font-mono">—</span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Cards layout — compact, NO big thumbnail. Tiny corner indicator only.
// ────────────────────────────────────────────────────────────────────────

interface CardsLayoutProps {
  prompts: MockPrompt[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function CardsLayout({ prompts, selectedId, onSelect }: CardsLayoutProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
      {prompts.map((p) => {
        const isSelected = p.id === selectedId
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className={cn(
              "press relative flex flex-col gap-2 p-3 text-left rounded-md",
              // Specify exact properties — `transition-all` is a footgun:
              // it animates everything, including layout-affecting things.
              "transition-[border-color,box-shadow] duration-200 [transition-timing-function:var(--ease-out)]",
              "border bg-card",
              isSelected
                ? "border-primary shadow-sm ring-1 ring-primary/20"
                : "border-border hover:border-foreground/40 hover:shadow-md",
            )}
          >
            {/* Top row: type + status */}
            <div className="flex items-center gap-1.5 justify-between">
              <span
                className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold tracking-wider",
                  TYPE_COLORS[p.type],
                )}
              >
                {TYPE_ABBR[p.type]}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[p.status])} />
                {p.status}
              </span>
            </div>

            {/* Title */}
            <div className="text-[13px] font-medium text-foreground leading-snug line-clamp-2">
              {p.title}
            </div>

            {/* Body preview */}
            <div className="text-[11px] text-muted-foreground/85 font-mono leading-relaxed line-clamp-3">
              {p.body}
            </div>

            {/* Bottom row: parent + tiny indicators */}
            <div className="flex items-center gap-2 mt-auto pt-1.5 border-t border-border/60 text-[10px] text-muted-foreground/70 font-mono">
              {p.parent ? (
                <span className="truncate flex-1" title={`Iteration of ${p.parent}`}>
                  ↳ {p.parent.replace(/^v\d+-/, "")}
                </span>
              ) : (
                <span className="flex-1 text-muted-foreground/40">root</span>
              )}

              {/* Tiny generation indicator — that's the small hint */}
              {p.hasGeneration && (
                <span
                  className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 shrink-0"
                  title="Generation available"
                >
                  <ImageIcon className="h-2.5 w-2.5" />
                  <Check className="h-2.5 w-2.5" />
                </span>
              )}
              {p.references > 0 && (
                <span className="text-muted-foreground/60 shrink-0" title={`${p.references} references`}>
                  ▢{p.references}
                </span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Detail drawer — slides in from the right when a prompt is selected.
// Not a modal — it lives inside the surface and you can browse the list/
// cards to its left while seeing the editor on the right.
// ────────────────────────────────────────────────────────────────────────

interface PromptDetailDrawerProps {
  prompt: MockPrompt
  onClose: () => void
}

function PromptDetailDrawer({ prompt, onClose }: PromptDetailDrawerProps) {
  return (
    <aside
      className="w-[420px] shrink-0 border-l border-border bg-background flex flex-col overflow-hidden"
      style={{ minWidth: 380 }}
    >
      {/* Drawer header */}
      <div className="flex items-center justify-between gap-2 h-11 px-4 border-b border-border bg-card/40 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono shrink-0">
            Prompt
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-xs font-mono text-foreground/90 truncate">
            {prompt.id}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="press text-muted-foreground hover:text-foreground transition-[color] duration-150 [transition-timing-function:var(--ease-natural)] p-1 rounded"
          aria-label="Close prompt detail"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="p-4 space-y-4">
          {/* Title */}
          <div>
            <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
              Title
            </label>
            <input
              type="text"
              defaultValue={prompt.title}
              className={cn(
                "mt-1 w-full px-2 py-1.5 rounded border border-border bg-card",
                "text-sm font-medium text-foreground",
                "focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary",
              )}
            />
          </div>

          {/* Type + status pickers, side-by-side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
                Type
              </label>
              <select
                defaultValue={prompt.type}
                className="mt-1 w-full px-2 py-1.5 rounded border border-border bg-card text-xs"
              >
                <option value="keyframe">keyframe</option>
                <option value="multi-shot">multi-shot</option>
                <option value="start-end-frame">start-end-frame</option>
                <option value="workflow">workflow</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
                Status
              </label>
              <select
                defaultValue={prompt.status}
                className="mt-1 w-full px-2 py-1.5 rounded border border-border bg-card text-xs"
              >
                <option value="draft">draft</option>
                <option value="generated">generated</option>
                <option value="approved">approved</option>
                <option value="archived">archived</option>
              </select>
            </div>
          </div>

          {/* Body editor */}
          <div>
            <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
              Prompt body
            </label>
            <textarea
              defaultValue={prompt.body}
              rows={9}
              className={cn(
                "mt-1 w-full px-3 py-2 rounded border border-border bg-card",
                "font-mono text-[12px] leading-relaxed text-foreground",
                "focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary",
                "resize-y",
              )}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
                  "border border-border bg-background hover:bg-secondary",
                )}
                title="Compose with character + location + world locks injected"
              >
                <Wand2 className="h-3 w-3" />
                Compose with locks
              </button>
              <button
                type="button"
                className={cn(
                  "press flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
                  "border border-border bg-background hover:bg-secondary",
                  "transition-[background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
                )}
              >
                <RotateCcw className="h-3 w-3" />
                Iterate
              </button>
              <button
                type="button"
                className={cn(
                  "press flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
                  "bg-primary text-primary-foreground",
                  "shadow-[0_1px_2px_-1px_rgba(0,0,0,0.15)] hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.18)]",
                  "transition-[box-shadow] duration-150 [transition-timing-function:var(--ease-out)]",
                )}
              >
                <Sparkles className="h-3 w-3" />
                {prompt.hasGeneration ? "Re-generate" : "Generate"}
              </button>
            </div>
          </div>

          {/* References — small thumbnails */}
          <div>
            <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
              References ({prompt.references})
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Array.from({ length: prompt.references }).map((_, i) => (
                <div
                  key={i}
                  className="w-12 h-12 rounded bg-muted flex items-center justify-center text-muted-foreground/60"
                  title="Reference image"
                >
                  <ImageIcon className="h-4 w-4" />
                </div>
              ))}
              <button
                type="button"
                className={cn(
                  "press w-12 h-12 rounded border border-dashed border-border",
                  "flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/60",
                  "transition-[color,border-color] duration-150 [transition-timing-function:var(--ease-natural)]",
                )}
                title="Drop or paste a reference image"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Generation — TINY thumbnail, not a hero */}
          {prompt.hasGeneration && (
            <div>
              <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
                Latest generation
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <div
                  className="w-20 h-12 rounded shrink-0"
                  style={{
                    background:
                      "linear-gradient(135deg, #FFB87A 0%, #FF8C42 50%, #B45309 100%)",
                  }}
                />
                <div className="text-[11px] text-muted-foreground font-mono leading-tight">
                  <div>nano-banana-pro</div>
                  <div className="text-muted-foreground/60">2 hours ago</div>
                </div>
              </div>
            </div>
          )}

          {/* Iteration tree */}
          <div>
            <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
              Iteration tree
            </label>
            <div className="mt-1.5 text-[11px] font-mono text-muted-foreground leading-6">
              <div className="flex items-center gap-1">
                <ArrowLeftRight className="h-3 w-3 text-muted-foreground/40" />
                <span className="text-foreground/85">v1-wide-establishing</span>
              </div>
              <div className="pl-4 flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                <span className={prompt.id === "v2-warmer-light" ? "text-primary font-medium" : ""}>
                  v2-warmer-light
                </span>
              </div>
              <div className="pl-8 flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                <span className={prompt.id === "v3-medium-pushed-in" ? "text-primary font-medium" : ""}>
                  v3-medium-pushed-in
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
