"use client"

/**
 * PromptsModeView — the "Prompts" pipeline stage.
 *
 *   ┌── Project ──┬── Screenplay (editable, blocks) ──┬── Prompts (filtered to selected block) ──┬── Chat ──┐
 *
 * Selection-driven coupling:
 *   - The screenplay is divided into BLOCKS — each block is a paragraph
 *     in the Fountain document (scene heading, an action passage, a
 *     dialogue exchange, a section header, …).
 *   - Clicking a block makes it the ACTIVE block. The right pane shows
 *     only prompts attached to that block.
 *   - Click "All scene prompts" in the right header to clear the filter
 *     and see everything.
 *   - Each block is editable inline — type freely, the agent edits the
 *     same block via Edit/Write tools.
 *
 * Granularity is up to the user:
 *   - One prompt for the whole scene → attach to the scene-heading block.
 *   - Many prompts for many beats → attach each to its beat block.
 *   - Workflow / utility prompts → no block anchor (always visible).
 */

import { useAtomValue } from "jotai"
import {
  Image as ImageIcon,
  Layers,
  Link as LinkIcon,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react"
import { useMemo, useState } from "react"
import { cn } from "../../lib/utils"
import { activeEntityAtom } from "./atoms"

// ────────────────────────────────────────────────────────────────────────
// Block parser — Fountain-aware paragraph splitter.
// ────────────────────────────────────────────────────────────────────────

type BlockKind =
  | "section"       // # heading
  | "scene-heading" // INT./EXT.
  | "character"     // ALL CAPS character cue
  | "dialogue"      // dialogue paragraph
  | "action"        // action paragraph (default)

interface ScreenplayBlock {
  id: string
  kind: BlockKind
  /** Single-line summary for the right-pane "Prompts for: …" label. */
  label: string
  text: string
  /** Index in the original split, for stable id even after edits. */
  index: number
}

const SCENE_PREFIX = /^(INT\.\/EXT\.|I\/E\.|INT\.|EXT\.|EST\.)/i
const SECTION_PREFIX = /^(#{1,3})\s+/

function parseBlocks(text: string): ScreenplayBlock[] {
  // Split on blank lines but keep ordering. Treat 2+ newlines as a separator.
  const chunks = text.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean)
  return chunks.map((chunk, index) => {
    const firstLine = chunk.split("\n")[0]?.trim() ?? ""
    let kind: BlockKind = "action"
    if (SECTION_PREFIX.test(firstLine)) kind = "section"
    else if (SCENE_PREFIX.test(firstLine)) kind = "scene-heading"
    else if (
      /^[A-Z][A-Z0-9 ()'\-.]+$/.test(firstLine) &&
      chunk.split("\n").length > 1
    )
      kind = "character"
    else kind = "action"
    // For "character" cues we treat the whole chunk (cue + parentheticals + dialogue) as one block.
    const label = firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine
    // Stable-ish id — derived from kind + first line slug + index. Survives
    // typing in unrelated blocks; collapses if you rewrite the first line.
    const slug = firstLine
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 24) || `b${index}`
    const id = `${index.toString().padStart(2, "0")}-${slug}`
    return { id, kind, label, text: chunk, index }
  })
}

function joinBlocks(blocks: ScreenplayBlock[]): string {
  return blocks.map((b) => b.text).join("\n\n") + "\n"
}

// ────────────────────────────────────────────────────────────────────────
// Mock data — replaced by real entities.read in E1.4 + E1.9
// ────────────────────────────────────────────────────────────────────────

const MOCK_SCREENPLAY = `EXT. DESERT MOUNTAIN PASS - SUNSET

Two cars idle at a starting line painted across asphalt. Beyond them, the road snakes into foothills. The sky burns amber and rust.

A REFEREE in a dark jacket stands between the vehicles, arm raised.

INT. CAR 1 - CONTINUOUS

ALEX (late 20s, focused, hands tight on the wheel) stares ahead. Jaw clenched.

ALEX
We're not safe here.
But there's no going back now.

INT. CAR 2 - CONTINUOUS

JORDAN (same age, confident but tense) grips their own wheel. They don't look sideways. Both engines rumble low.

The REFEREE drops their arm.

Both cars LAUNCH forward. Tires scream. Dust kicks up.`

type PromptType = "keyframe" | "multi-shot" | "start-end-frame" | "workflow"
type PromptStatus = "draft" | "generated" | "approved" | "archived"

interface MockPrompt {
  id: string
  /** Block id this prompt supports — null = scene-wide / workflow. */
  blockId: string | null
  type: PromptType
  status: PromptStatus
  parent: string | null
  body: string
  hasGeneration: boolean
}

// Block ids must match the parser's slugify: index padded + slug of first line.
const MOCK_PROMPTS: MockPrompt[] = [
  {
    id: "v1-wide-establishing",
    blockId: "00-ext-desert-mountain-pass-su",
    type: "keyframe",
    status: "approved",
    parent: null,
    body: `A wide establishing shot of an empty forest road at dawn. Warm amber light grazes the asphalt, mist hugs the treeline, anamorphic flare on the horizon. 35mm film stock feel, slight grain.`,
    hasGeneration: true,
  },
  {
    id: "v2-warmer-light",
    blockId: "00-ext-desert-mountain-pass-su",
    type: "keyframe",
    status: "generated",
    parent: "v1-wide-establishing",
    body: `Same composition as v1 but with the camera dropped almost to ground level — asphalt detail dominates the foreground. Push the warmth: golden hour at peak.`,
    hasGeneration: true,
  },
  {
    id: "v1-two-cars-idle",
    blockId: "01-two-cars-idle-at-a-starting",
    type: "keyframe",
    status: "draft",
    parent: null,
    body: `Tight medium-wide on the two cars, painted line dividing them. Engines audibly rumbling. Dust motes hang in amber light. Both cars symmetrical in frame.`,
    hasGeneration: false,
  },
  {
    id: "v1-referee",
    blockId: "02-a-referee-in-a-dark-jacket",
    type: "keyframe",
    status: "draft",
    parent: null,
    body: `Low-angle silhouette of the referee, arm raised against the sunset. Their figure dwarfed by the cars on either side.`,
    hasGeneration: false,
  },
  {
    id: "v1-alex-cu",
    blockId: "04-alex-late-20s-focused-hands",
    type: "keyframe",
    status: "generated",
    parent: null,
    body: `Tight close-up on Alex's eyes in the rearview / windshield reflection. Jaw clenched, breath caught. Warm light spills across one half of their face.`,
    hasGeneration: true,
  },
  {
    id: "v1-multi-launch",
    blockId: null, // scene-wide multi-shot
    type: "multi-shot",
    status: "generated",
    parent: null,
    body: `Three-shot launch sequence.\nShot 1 (2s): static wide on the line.\nShot 2 (3s): low push-in as referee drops arm.\nShot 3 (2s): cars launch, tires scream, dust clouds.`,
    hasGeneration: true,
  },
  {
    id: "v1-workflow-grade",
    blockId: null, // workflow
    type: "workflow",
    status: "approved",
    parent: null,
    body: `Color-grade transfer template. Extract LUT from reference still, apply to generated frame at 0.7 strength, pull selective skin chroma.`,
    hasGeneration: false,
  },
]

const STATUS_DOT: Record<PromptStatus, string> = {
  draft: "bg-muted-foreground/40",
  generated: "bg-amber-500",
  approved: "bg-emerald-500",
  archived: "bg-muted-foreground/20",
}

const KIND_LABEL: Record<BlockKind, string> = {
  section: "Section",
  "scene-heading": "Scene",
  character: "Dialogue",
  dialogue: "Dialogue",
  action: "Action",
}

// ────────────────────────────────────────────────────────────────────────
// View
// ────────────────────────────────────────────────────────────────────────

export function PromptsModeView() {
  const active = useAtomValue(activeEntityAtom)
  const [text, setText] = useState(MOCK_SCREENPLAY)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)

  const blocks = useMemo(() => parseBlocks(text), [text])
  const blocksById = useMemo(() => {
    const m = new Map<string, ScreenplayBlock>()
    for (const b of blocks) m.set(b.id, b)
    return m
  }, [blocks])

  // Count prompts per block for the inline "↔ N" badges.
  const promptCountByBlock = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of MOCK_PROMPTS) {
      if (!p.blockId) continue
      m.set(p.blockId, (m.get(p.blockId) ?? 0) + 1)
    }
    return m
  }, [])

  // Filter: when a block is selected, show its prompts AND null-block
  // prompts (workflows / scene-wide). When no block selected, show all.
  const visiblePrompts = useMemo(() => {
    if (!selectedBlockId) return MOCK_PROMPTS
    return MOCK_PROMPTS.filter(
      (p) => p.blockId === selectedBlockId || p.blockId === null,
    )
  }, [selectedBlockId])

  const updateBlockText = (blockId: string, next: string) => {
    const updated = blocks.map((b) =>
      b.id === blockId ? { ...b, text: next } : b,
    )
    setText(joinBlocks(updated))
  }

  const sceneLabel =
    active?.kind === "scene"
      ? active.label
      : active?.kind === "shot"
        ? `Scene of ${active.label}`
        : "Scene"

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* Left — editable screenplay broken into blocks */}
      <div className="w-[50%] min-w-[380px] max-w-[640px] flex flex-col border-r border-border">
        <div className="flex items-center justify-between gap-2 h-9 px-4 border-b border-border bg-card/40 select-none shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
              Screenplay
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-xs text-foreground/85 truncate">{sceneLabel}</span>
            <span className="text-[10px] tabular-nums text-muted-foreground/60 font-mono">
              {blocks.length} blocks
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-card/10">
          <div className="px-2 py-3">
            {blocks.map((b) => (
              <BlockEditor
                key={b.id}
                block={b}
                selected={b.id === selectedBlockId}
                promptCount={promptCountByBlock.get(b.id) ?? 0}
                onSelect={() => setSelectedBlockId(b.id)}
                onChange={(next) => updateBlockText(b.id, next)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right — prompts filtered to the selected block */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between gap-2 h-9 px-4 border-b border-border bg-card/40 select-none shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
              Prompts
            </span>
            {selectedBlockId ? (
              <>
                <span className="text-muted-foreground/40">·</span>
                <LinkIcon className="h-3 w-3 text-primary shrink-0" />
                <span className="text-xs text-foreground/85 truncate">
                  {blocksById.get(selectedBlockId)?.label ?? selectedBlockId}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedBlockId(null)}
                  className={cn(
                    "ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono",
                    "text-muted-foreground hover:text-foreground hover:bg-secondary",
                    "transition-colors",
                  )}
                  title="Clear filter, show all scene prompts"
                >
                  <X className="h-2.5 w-2.5" />
                  clear
                </button>
              </>
            ) : (
              <>
                <span className="text-muted-foreground/40">·</span>
                <Layers className="h-3 w-3 text-muted-foreground/70" />
                <span className="text-xs text-muted-foreground/85">
                  All scene prompts
                </span>
              </>
            )}
            <span className="text-[10px] tabular-nums text-muted-foreground/60 font-mono ml-1">
              {visiblePrompts.length}
            </span>
          </div>
          <button
            type="button"
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
              "bg-primary text-primary-foreground hover:opacity-90 transition-opacity",
            )}
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          <div className="max-w-[760px] mx-auto px-6 py-4 space-y-3">
            {visiblePrompts.length === 0 ? (
              <EmptyForBlock blockLabel={blocksById.get(selectedBlockId ?? "")?.label} />
            ) : (
              visiblePrompts.map((p) => (
                <PromptBlock key={p.id} prompt={p} />
              ))
            )}
            <button
              type="button"
              className={cn(
                "w-full flex items-center justify-center gap-2 py-3",
                "border border-dashed border-border rounded-md",
                "text-muted-foreground hover:text-primary hover:border-primary/60 hover:bg-primary/5",
                "transition-colors text-sm font-medium",
              )}
              title={
                selectedBlockId
                  ? "Add a prompt linked to this screenplay block"
                  : "Add a scene-wide prompt"
              }
            >
              <Plus className="h-4 w-4" />
              {selectedBlockId
                ? `Add prompt for "${blocksById.get(selectedBlockId)?.label ?? "block"}"`
                : "Add scene-wide prompt"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// BlockEditor — one paragraph of the screenplay. Editable. Click selects.
// ────────────────────────────────────────────────────────────────────────

interface BlockEditorProps {
  block: ScreenplayBlock
  selected: boolean
  promptCount: number
  onSelect: () => void
  onChange: (next: string) => void
}

function BlockEditor({
  block,
  selected,
  promptCount,
  onSelect,
  onChange,
}: BlockEditorProps) {
  const lines = block.text.split("\n").length
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative my-1 rounded-md transition-all cursor-text",
        "border-l-2",
        selected
          ? "border-primary bg-primary/5"
          : "border-transparent hover:bg-card/60",
      )}
    >
      <textarea
        value={block.text}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onSelect}
        rows={Math.max(1, lines)}
        spellCheck={false}
        className={cn(
          "w-full bg-transparent border-0 outline-none resize-none",
          "px-3 py-2 font-mono text-[12.5px] leading-7",
          block.kind === "scene-heading"
            ? "text-foreground font-semibold uppercase tracking-wide"
            : block.kind === "section"
              ? "text-primary font-semibold"
              : block.kind === "character" || block.kind === "dialogue"
                ? "text-foreground/90"
                : "text-foreground/85",
        )}
      />

      {/* Inline meta — kind label + prompt count */}
      <div
        className={cn(
          "absolute right-2 top-1.5 flex items-center gap-1.5",
          "text-[9px] font-mono uppercase tracking-wider",
          "text-muted-foreground/50 select-none pointer-events-none",
          "transition-opacity",
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-70",
        )}
      >
        <span>{KIND_LABEL[block.kind]}</span>
        {promptCount > 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full",
              "bg-primary/10 text-primary font-semibold",
            )}
            title={`${promptCount} prompts attached to this block`}
          >
            <LinkIcon className="h-2.5 w-2.5" />
            {promptCount}
          </span>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// PromptBlock — same minimal text-block design as before. The only
// metadata visible by default: tiny corner badge with v-id + status dot.
// ────────────────────────────────────────────────────────────────────────

function PromptBlock({ prompt }: { prompt: MockPrompt }) {
  const [text, setText] = useState(prompt.body)
  const [focused, setFocused] = useState(false)
  return (
    <div
      className={cn(
        "group relative rounded-md transition-all bg-card border",
        focused
          ? "border-primary shadow-sm ring-1 ring-primary/15"
          : "border-border hover:border-foreground/30",
      )}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={Math.max(3, text.split("\n").length)}
        className={cn(
          "w-full px-4 py-3 bg-transparent",
          "font-mono text-[13px] leading-relaxed text-foreground",
          "border-0 outline-none resize-none",
          "placeholder:text-muted-foreground/50",
        )}
      />
      <div className="absolute top-2 right-2 flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/50 select-none pointer-events-none">
        {prompt.parent && (
          <span title={`Iteration of ${prompt.parent}`}>
            ↳ {prompt.parent.replace(/^v\d+-/, "")}
          </span>
        )}
        <span>{prompt.id.split("-")[0]}</span>
        <span
          className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[prompt.status])}
          title={prompt.status}
        />
      </div>
      {prompt.hasGeneration && (
        <div className="px-4 pb-3 flex items-center gap-2">
          <div
            className="w-24 h-14 rounded shrink-0"
            style={{
              background:
                "linear-gradient(135deg, #FFB87A 0%, #FF8C42 50%, #B45309 100%)",
            }}
            title="Latest generation"
          />
          <div className="text-[10px] text-muted-foreground/70 font-mono leading-tight">
            <div>nano-banana-pro</div>
            <div className="text-muted-foreground/50">2h ago</div>
          </div>
        </div>
      )}
      <div
        className={cn(
          "flex items-center justify-end gap-1 px-3 pb-2 pt-0",
          "transition-opacity",
          focused ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <ActionButton icon={Wand2} label="Compose" title="Compose with character + location + world locks" />
        <ActionButton icon={RotateCcw} label="Iterate" title="Ask the agent for a variation of this prompt" />
        <ActionButton
          icon={Sparkles}
          label={prompt.hasGeneration ? "Re-generate" : "Generate"}
          primary
          title={prompt.hasGeneration ? "Run the model again" : "Run the model with this prompt"}
        />
        <button
          type="button"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
          title="More"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  title,
  primary,
}: {
  icon: typeof Wand2
  label: string
  title: string
  primary?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
        "transition-colors",
        primary
          ? "bg-primary text-primary-foreground hover:opacity-90"
          : "border border-border bg-background hover:bg-secondary",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  )
}

function EmptyForBlock({ blockLabel }: { blockLabel: string | undefined }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
      <Sparkles className="h-6 w-6 text-muted-foreground/50" />
      <div className="text-sm text-foreground/80 font-medium">
        No prompts for this block yet.
      </div>
      <div className="text-xs text-muted-foreground/70 max-w-[40ch]">
        {blockLabel ? (
          <>
            Click <strong>Add prompt</strong> below to start one for{" "}
            <em>"{blockLabel}"</em>, or ask the agent in chat.
          </>
        ) : (
          <>Click <strong>Add prompt</strong> below.</>
        )}
      </div>
    </div>
  )
}

// Reference suppress
const _ImageIcon = ImageIcon
void _ImageIcon
